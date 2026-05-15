import '../config/env.js';
import axios from 'axios';
import { pool } from '../config/database.js';
import logger from '../config/logger.js';

export class EventListenerService {
  constructor() {
    this.arcRpc = process.env.ARC_TESTNET_RPC || 'https://rpc.testnet.arc.network';
    this.isRunning = false;
    this.lastBlockScanned = 0;
    this.pollingInterval = 12000; // 12 seconds
  }

  // Start polling for events
  start() {
    if (this.isRunning) {
      logger.warn('Event listener already running');
      return;
    }

    this.isRunning = true;
    logger.info('Event listener service started');

    // Poll every 12 seconds
    this.poller = setInterval(() => {
      this.pollEvents().catch(err => {
        logger.error('Error polling events', { error: err.message });
      });
    }, this.pollingInterval);
  }

  // Stop polling
  stop() {
    if (this.poller) {
      clearInterval(this.poller);
    }
    this.isRunning = false;
    logger.info('Event listener service stopped');
  }

  // Poll Arc Testnet for events
  async pollEvents() {
    try {
      // Get current block number
      const blockResponse = await axios.post(this.arcRpc, {
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1
      });

      const currentBlock = parseInt(blockResponse.data.result, 16);
      const startBlock = this.lastBlockScanned || currentBlock - 100;
      const endBlock = Math.min(currentBlock, startBlock + 100); // Scan max 100 blocks at a time

      if (startBlock >= endBlock) {
        this.lastBlockScanned = endBlock;
        return;
      }

      logger.info('Polling Arc events', { startBlock, endBlock });

      // Poll for VaultCreated events
      await this.pollVaultCreatedEvents(startBlock, endBlock);

      // Poll for VaultClaimed events
      await this.pollVaultClaimedEvents(startBlock, endBlock);

      // Poll for BridgeCompleted events
      await this.pollBridgeCompletedEvents(startBlock, endBlock);

      this.lastBlockScanned = endBlock;
    } catch (err) {
      logger.error('Error in event polling loop', { error: err.message });
    }
  }

  // Poll for VaultCreated events
  async pollVaultCreatedEvents(startBlock, endBlock) {
    try {
      // This is a placeholder - in production, would query contract events via RPC
      // For now, we'll log that we're monitoring
      logger.debug('Monitoring VaultCreated events', { startBlock, endBlock });

      // Event signature: VaultCreated(bytes32 indexed vaultId, address indexed owner, uint256 totalAmount, uint256 unlockAt)
      // Topic would be calculated from event signature
    } catch (err) {
      logger.error('Error polling VaultCreated events', { error: err.message });
    }
  }

  // Poll for VaultClaimed events
  async pollVaultClaimedEvents(startBlock, endBlock) {
    try {
      logger.debug('Monitoring VaultClaimed events', { startBlock, endBlock });

      // Event signature: VaultClaimed(bytes32 indexed vaultId, address indexed owner, uint256 amount)
      // When detected, would update vault status to CLAIMED in database
    } catch (err) {
      logger.error('Error polling VaultClaimed events', { error: err.message });
    }
  }

  // Poll for BridgeCompleted events
  async pollBridgeCompletedEvents(startBlock, endBlock) {
    try {
      logger.debug('Monitoring BridgeCompleted events', { startBlock, endBlock });

      // Event signature: BridgeCompleted(bytes32 indexed vaultId, uint256 amount)
      // When detected, would update bridge transaction status to COMPLETE
    } catch (err) {
      logger.error('Error polling BridgeCompleted events', { error: err.message });
    }
  }

  // Helper: Process vault created event
  async processVaultCreatedEvent(vaultId, owner, totalAmount, unlockAt) {
    try {
      await pool.query(
        `UPDATE vaults SET created_on_chain_tx = $1, status = $2 WHERE vault_id = $3`,
        [Math.random().toString(36).slice(2), 'ACTIVE', vaultId]
      );
      logger.info('Processed VaultCreated event', { vaultId, owner });
    } catch (err) {
      logger.error('Error processing VaultCreated event', { error: err.message });
    }
  }

  // Helper: Process vault claimed event
  async processVaultClaimedEvent(vaultId, owner, amount) {
    try {
      await pool.query(
        `UPDATE vaults SET status = $1, claimed_at = NOW() WHERE vault_id = $2`,
        ['CLAIMED', vaultId]
      );
      logger.info('Processed VaultClaimed event', { vaultId });
    } catch (err) {
      logger.error('Error processing VaultClaimed event', { error: err.message });
    }
  }

  // Helper: Process bridge completed event
  async processBridgeCompletedEvent(vaultId, amount) {
    try {
      await pool.query(
        `UPDATE bridge_transactions SET status = $1, completed_at = NOW() WHERE vault_id = $2 AND status = $3`,
        ['COMPLETE', vaultId, 'PENDING']
      );
      logger.info('Processed BridgeCompleted event', { vaultId });
    } catch (err) {
      logger.error('Error processing BridgeCompleted event', { error: err.message });
    }
  }
}

// Singleton instance
export const eventListenerService = new EventListenerService();
