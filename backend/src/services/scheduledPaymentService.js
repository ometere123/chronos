import '../config/env.js';
import cron from 'node-cron';
import { ethers } from 'ethers';
import logger from '../config/logger.js';
import { contractAddresses } from '../config/contracts.js';

// ---------------------------------------------------------------------------
// CENTRALIZED KEEPER - HACKATHON TIMELINE TRADEOFF
// ---------------------------------------------------------------------------
// Arc Testnet does not yet have a live on-chain keeper/automation network, so
// ScheduledPayment.sol's due payment slots do not self-execute. This service is
// a simple cron-driven off-chain keeper: on an interval it asks each active
// schedule's slots whether they are due (ScheduledPayment.isSlotDue), and if so
// submits executePayment(). This is a deliberate centralization tradeoff made to
// ship on the hackathon timeline - the single relayer wallet configured via
// PRIVATE_KEY is trusted to call the keeper function promptly and honestly.
//
// All of the actual payment logic (due-timestamp check, replay/double-execution
// guard, and the treasury-balance threshold guard) is enforced ON-CHAIN inside
// ScheduledPayment.executePayment(), so a malicious or malfunctioning keeper can
// at worst delay a payment, never steal funds, double-pay, or bypass the balance
// guard.
//
// To decentralize later: replace this cron loop with Chainlink Automation (or an
// equivalent decentralized keeper network) once available on Arc. Point its
// upkeep at ScheduledPayment.executePayment(scheduleId, slotIndex) using the same
// isSlotDue() check as the "checkUpkeep" condition - no contract changes required,
// only who is allowed/incentivized to call the function changes.
// ---------------------------------------------------------------------------

const SCHEDULED_PAYMENT_ABI = [
  'function nextScheduleId() view returns (uint256)',
  'function getSchedule(uint256 scheduleId) view returns (address recipient, uint256 amount, uint256 minTreasuryBalanceAfter, uint256[] releaseTimestamps, bool active)',
  'function isSlotDue(uint256 scheduleId, uint256 slotIndex) view returns (bool due, string reason)',
  'function slotExecuted(uint256 scheduleId, uint256 slotIndex) view returns (bool)',
  'function executePayment(uint256 scheduleId, uint256 slotIndex) external',
  'event PaymentExecuted(uint256 indexed scheduleId, uint256 indexed slotIndex, address indexed recipient, uint256 amount)',
];

const DEFAULT_CRON_EXPRESSION = process.env.SCHEDULED_PAYMENT_CRON || '*/1 * * * *'; // every minute

export class ScheduledPaymentService {
  constructor() {
    this.rpcUrl = contractAddresses.arcRpcUrl;
    this.privateKey = process.env.PRIVATE_KEY;
    this.contractAddress = contractAddresses.scheduledPayment;
    this.task = null;
    this.isRunning = false;
    this.isChecking = false;

    this.initializeClients();
  }

  initializeClients() {
    this.provider = this.rpcUrl ? new ethers.JsonRpcProvider(this.rpcUrl) : null;
    this.wallet = this.privateKey && this.provider
      ? new ethers.Wallet(this.privateKey, this.provider)
      : null;
    this.contract = this.wallet && this.contractAddress
      ? new ethers.Contract(this.contractAddress, SCHEDULED_PAYMENT_ABI, this.wallet)
      : null;
  }

  isConfigured() {
    return Boolean(this.contract && this.wallet);
  }

  start(cronExpression = DEFAULT_CRON_EXPRESSION) {
    if (this.isRunning) {
      logger.warn('Scheduled payment keeper already running');
      return;
    }

    if (!this.isConfigured()) {
      logger.warn('Scheduled payment keeper not started: missing ARC RPC, PRIVATE_KEY, or ARC_SCHEDULED_PAYMENT address');
      return;
    }

    this.task = cron.schedule(cronExpression, () => {
      this.checkAndExecuteDuePayments().catch((err) => {
        logger.error('Scheduled payment keeper tick failed', { error: err.message });
      });
    });

    this.isRunning = true;
    logger.info('Scheduled payment keeper started (centralized cron keeper - see comment in scheduledPaymentService.js)', {
      cronExpression,
    });
  }

  stop() {
    if (this.task) {
      this.task.stop();
    }
    this.isRunning = false;
    logger.info('Scheduled payment keeper stopped');
  }

  /// Walk every schedule and every not-yet-executed slot, execute whichever are due.
  async checkAndExecuteDuePayments() {
    if (this.isChecking) {
      return;
    }
    this.isChecking = true;

    try {
      const scheduleCount = Number(await this.contract.nextScheduleId());

      for (let scheduleId = 0; scheduleId < scheduleCount; scheduleId++) {
        const schedule = await this.contract.getSchedule(scheduleId);
        if (!schedule.active) {
          continue;
        }

        for (let slotIndex = 0; slotIndex < schedule.releaseTimestamps.length; slotIndex++) {
          const alreadyExecuted = await this.contract.slotExecuted(scheduleId, slotIndex);
          if (alreadyExecuted) {
            continue;
          }

          const [due, reason] = await this.contract.isSlotDue(scheduleId, slotIndex);
          if (!due) {
            continue;
          }

          await this.executeSlot(scheduleId, slotIndex, reason);
        }
      }
    } catch (err) {
      logger.error('Error checking due scheduled payments', { error: err.message });
    } finally {
      this.isChecking = false;
    }
  }

  async executeSlot(scheduleId, slotIndex) {
    try {
      logger.info('Executing due scheduled payment', { scheduleId, slotIndex });
      const tx = await this.contract.executePayment(scheduleId, slotIndex);
      const receipt = await tx.wait();

      if (!receipt || receipt.status !== 1) {
        throw new Error('executePayment transaction reverted');
      }

      logger.info('Scheduled payment executed', { scheduleId, slotIndex, txHash: tx.hash });
      return { scheduleId, slotIndex, txHash: tx.hash };
    } catch (err) {
      logger.error('Failed to execute scheduled payment', {
        scheduleId,
        slotIndex,
        error: err.shortMessage || err.reason || err.message,
      });
      throw err;
    }
  }
}

export const scheduledPaymentService = new ScheduledPaymentService();
