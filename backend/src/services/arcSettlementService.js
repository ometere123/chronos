import { ethers } from 'ethers';
import logger from '../config/logger.js';
import { ARC_CHAIN_ID, contractAddresses } from '../config/contracts.js';

const BRIDGE_ORCHESTRATOR_ABI = [
  'function usdcToken() view returns (address)',
  'function cctpTokenMessenger() view returns (address)',
  'function cctpMessageTransmitter() view returns (address)',
  'function configureCCTP(address messenger, address transmitter) external',
  'function receiveBridgedUSDC_CCTP(uint256 amount, uint32 sourceChain, address owner, uint256 unlockAt, uint32 destinationChain, uint256 customDuration, uint8 vaultType) external returns (bytes32)',
  'function receiveAdditionalBridgedUSDC_CCTP(bytes32 vaultId, uint256 amount, uint32 sourceChain, address owner) external returns (bytes32)',
  'event BridgeCompleted(bytes32 indexed vaultId, uint256 amount)',
];

const TIMELOCK_VAULT_ABI = [
  'function getVault(bytes32 vaultId) view returns ((bytes32 vaultId,address owner,uint256 totalAmount,uint256 createdAt,uint256 unlockAt,uint32 sourceChain,uint8 bridgeProtocol,address tokenAddress,uint8 vaultType,uint8 status,bytes32 bridgeTxHash))',
  'event VaultClaimed(bytes32 indexed vaultId, address indexed owner, uint256 amount, uint32 destinationChain)',
  'event FlexibleWithdrawal(bytes32 indexed vaultId, address indexed owner, uint256 amount, uint256 penalty)',
];

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

const SUPPORTED_SETTLEMENT_CHAIN_IDS = new Set([
  84532,     // Base Sepolia
  421614,    // Arbitrum Sepolia
  11155111,  // Ethereum Sepolia
  11155420,  // OP Sepolia
  ARC_CHAIN_ID,
]);

const VAULT_TYPE_CODES = {
  FIXED: 0,
  FLEXIBLE: 1,
};

const VAULT_STATUS_CODES = {
  0: 'ACTIVE',
  1: 'MATURE',
  2: 'CLAIMED',
  3: 'FAILED',
};

const ARC_TX_PROPAGATION_WAIT_MS = Number(process.env.ARC_TX_PROPAGATION_WAIT_MS || 15000);
const ARC_TX_RECEIPT_WAIT_MS = Number(process.env.ARC_TX_RECEIPT_WAIT_MS || 180000);
const ARC_TX_RECEIPT_POLL_MS = Number(process.env.ARC_TX_RECEIPT_POLL_MS || 3000);

function toContractChainId(chainId) {
  const numericChainId = Number(chainId);

  if (!SUPPORTED_SETTLEMENT_CHAIN_IDS.has(numericChainId)) {
    throw new Error(`Unsupported chain ID for on-chain settlement: ${chainId}`);
  }

  return numericChainId;
}

function toUnlockTimestamp(unlockAt) {
  if (unlockAt instanceof Date) {
    return Math.floor(unlockAt.getTime() / 1000);
  }

  const numericUnlockAt = Number(unlockAt);
  if (!Number.isFinite(numericUnlockAt) || numericUnlockAt <= 0) {
    throw new Error('Invalid unlock timestamp');
  }

  return numericUnlockAt > 10_000_000_000
    ? Math.floor(numericUnlockAt / 1000)
    : Math.floor(numericUnlockAt);
}

function isVersionMismatchError(err) {
  return (
    err?.code === 'CALL_EXCEPTION' ||
    err?.code === 'BAD_DATA' ||
    /missing revert data/i.test(err?.message || '')
  );
}

function isRetryableRpcSendError(err) {
  const message = err?.shortMessage || err?.reason || err?.message || '';

  return (
    isNonceDriftError(err) ||
    /txpool is full/i.test(message) ||
    /replacement transaction underpriced/i.test(message) ||
    /already known/i.test(message) ||
    /could not coalesce error/i.test(message)
  );
}

function isNonceDriftError(err) {
  const message = err?.shortMessage || err?.reason || err?.message || '';

  return (
    /nonce has already been used/i.test(message) ||
    /nonce too low/i.test(message) ||
    /nonce too high/i.test(message) ||
    /invalid nonce/i.test(message) ||
    /account sequence mismatch/i.test(message)
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeArcTxError(code, message, tx, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.txHash = tx?.hash || null;
  error.nonce = typeof tx?.nonce === 'number' ? tx.nonce : null;
  Object.assign(error, extra);
  return error;
}

export class ArcSettlementService {
  constructor() {
    this.rpcUrl = contractAddresses.arcRpcUrl;
    this.privateKey = process.env.PRIVATE_KEY;
    this.orchestratorAddress = contractAddresses.bridgeOrchestrator;

    this.writeQueue = Promise.resolve();
    this.relayerReady = false;
    this.compatibilityChecked = false;
    this.initializeClients();
  }

  initializeClients() {
    this.provider = this.rpcUrl ? new ethers.JsonRpcProvider(this.rpcUrl) : null;
    this.wallet = this.privateKey && this.provider
      ? new ethers.Wallet(this.privateKey, this.provider)
      : null;
    this.contract = this.wallet && this.orchestratorAddress
      ? new ethers.Contract(this.orchestratorAddress, BRIDGE_ORCHESTRATOR_ABI, this.wallet)
      : null;
    this.timeLockVaultContract = contractAddresses.timeLockVault && this.provider
      ? new ethers.Contract(contractAddresses.timeLockVault, TIMELOCK_VAULT_ABI, this.provider)
      : null;
    this.usdcContract = contractAddresses.usdc && this.provider
      ? new ethers.Contract(contractAddresses.usdc, ERC20_ABI, this.provider)
      : null;
    this.usdcWriteContract = contractAddresses.usdc && this.wallet
      ? new ethers.Contract(contractAddresses.usdc, ERC20_ABI, this.wallet)
      : null;
  }

  resetSigningClients(reason) {
    logger.warn('Resetting Arc settlement signer after nonce/provider drift', {
      reason,
      orchestratorAddress: this.orchestratorAddress,
    });

    this.initializeClients();
  }

  async withWriteQueue(label, task) {
    const queuedTask = this.writeQueue
      .catch(() => {})
      .then(async () => {
        logger.debug('Starting queued Arc write', { label });
        return task();
      });

    this.writeQueue = queuedTask.catch(() => {});
    return queuedTask;
  }

  async sendWithRetry(sendFn, label, maxAttempts = 4) {
    let attempt = 0;
    let lastError = null;

    while (attempt < maxAttempts) {
      try {
        return await sendFn();
      } catch (err) {
        lastError = err;
        attempt += 1;
        const nonceDrift = isNonceDriftError(err);

        if (nonceDrift) {
          this.resetSigningClients(err.message);
        }

        if (!isRetryableRpcSendError(err) || attempt >= maxAttempts) {
          throw err;
        }

        const waitMs = attempt * 2000;
        logger.warn(`${label} hit a retryable Arc RPC error, retrying`, {
          attempt,
          maxAttempts,
          waitMs,
          error: err.message,
        });

        await sleep(waitMs);
      }
    }

    throw lastError;
  }

  async sendAndWaitWithRetry(sendFn, label, maxAttempts = 4) {
    return this.withWriteQueue(label, async () => {
      let attempt = 0;
      let lastError = null;

      while (attempt < maxAttempts) {
        attempt += 1;

        const tx = await this.sendWithRetry(sendFn, label, maxAttempts);
        logger.info(`${label} submitted to Arc`, {
          txHash: tx.hash,
          nonce: tx.nonce,
          attempt,
        });

        try {
          const earlyReceipt = await this.waitForTxPropagation(tx, label);
          const receipt = earlyReceipt || await this.waitForTxReceipt(tx, label);
          logger.info(`${label} confirmed on Arc`, {
            txHash: tx.hash,
            nonce: tx.nonce,
            blockNumber: receipt.blockNumber,
          });
          return { tx, receipt };
        } catch (err) {
          lastError = err;

          if (err.code === 'ARC_TX_DROPPED' && attempt < maxAttempts) {
            logger.warn(`${label} was dropped before propagation; resubmitting`, {
              txHash: tx.hash,
              nonce: tx.nonce,
              attempt,
              maxAttempts,
              latestNonce: err.latestNonce,
              pendingNonce: err.pendingNonce,
            });
            this.resetSigningClients(err.message);
            continue;
          }

          throw err;
        }
      }

      throw lastError;
    });
  }

  async waitForTxPropagation(tx, label) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < ARC_TX_PROPAGATION_WAIT_MS) {
      const [receipt, knownTx] = await Promise.all([
        this.provider.getTransactionReceipt(tx.hash).catch(() => null),
        this.provider.getTransaction(tx.hash).catch(() => null),
      ]);

      if (receipt) {
        if (receipt.status !== 1) {
          throw makeArcTxError('ARC_TX_REVERTED', `${label} transaction reverted on Arc.`, tx, { receipt });
        }
        return receipt;
      }

      if (knownTx) {
        return null;
      }

      await sleep(Math.min(3000, ARC_TX_RECEIPT_POLL_MS));
    }

    const [latestNonce, pendingNonce] = await Promise.all([
      this.provider.getTransactionCount(tx.from, 'latest').catch(() => null),
      this.provider.getTransactionCount(tx.from, 'pending').catch(() => null),
    ]);

    if (typeof latestNonce === 'number' && typeof tx.nonce === 'number' && latestNonce > tx.nonce) {
      throw makeArcTxError(
        'ARC_TX_NONCE_CONSUMED',
        `${label} transaction hash is not visible, but the Arc nonce has advanced. Manual inspection is needed before retrying.`,
        tx,
        { latestNonce, pendingNonce }
      );
    }

    throw makeArcTxError(
      'ARC_TX_DROPPED',
      `${label} transaction was not visible on Arc after broadcast.`,
      tx,
      { latestNonce, pendingNonce }
    );
  }

  async waitForTxReceipt(tx, label) {
    const startedAt = Date.now();
    let lastLogAt = 0;

    while (Date.now() - startedAt < ARC_TX_RECEIPT_WAIT_MS) {
      const receipt = await this.provider.getTransactionReceipt(tx.hash).catch(() => null);

      if (receipt) {
        if (receipt.status !== 1) {
          throw makeArcTxError('ARC_TX_REVERTED', `${label} transaction reverted on Arc.`, tx, { receipt });
        }
        return receipt;
      }

      if (Date.now() - lastLogAt > 30000) {
        lastLogAt = Date.now();
        logger.info(`${label} still waiting for Arc confirmation`, {
          txHash: tx.hash,
          nonce: tx.nonce,
          waitedMs: Date.now() - startedAt,
        });
      }

      await sleep(ARC_TX_RECEIPT_POLL_MS);
    }

    throw makeArcTxError(
      'ARC_TX_PENDING',
      `${label} transaction is still pending on Arc after ${Math.round(ARC_TX_RECEIPT_WAIT_MS / 1000)} seconds.`,
      tx
    );
  }

  async ensureReady() {
    if (!this.contract || !this.wallet) {
      throw new Error('Arc settlement is not configured. Missing RPC, wallet, or bridge orchestrator address.');
    }

    await this.ensureCompatibility();
  }

  async ensureCompatibility() {
    if (this.compatibilityChecked) {
      return;
    }

    try {
      const usdcToken = await this.contract.usdcToken();

      if (!usdcToken || usdcToken === ethers.ZeroAddress) {
        throw new Error('BridgeOrchestrator is deployed without a valid USDC token configuration.');
      }
    } catch (err) {
      if (isVersionMismatchError(err)) {
        throw new Error(
          `Arc BridgeOrchestrator at ${this.orchestratorAddress} is an older deployment and does not match the current backend contract interface. Redeploy the Arc contracts, then update ARC_TIMELOCK_VAULT, ARC_BRIDGE_ORCHESTRATOR, ARC_VAULT_FACTORY, ARC_TREASURY, and ARC_PROOF_OF_RESERVES.`
        );
      }

      throw err;
    }

    this.compatibilityChecked = true;
  }

  async getStatus() {
    if (!this.contract || !this.wallet) {
      return {
        ready: false,
        reason: 'Arc settlement is not configured. Missing RPC, wallet, or bridge orchestrator address.',
      };
    }

    try {
      await this.ensureCompatibility();
      return {
        ready: true,
        reason: null,
      };
    } catch (err) {
      return {
        ready: false,
        reason: err.message || 'Arc settlement compatibility check failed.',
      };
    }
  }

  async ensureRelayerConfigured() {
    await this.ensureReady();

    if (this.relayerReady) {
      return;
    }

    const relayerAddress = await this.wallet.getAddress();
    const currentTransmitter = await this.contract.cctpMessageTransmitter();

    if (currentTransmitter.toLowerCase() !== relayerAddress.toLowerCase()) {
      const currentMessenger = await this.contract.cctpTokenMessenger();
      logger.info('Configuring Arc bridge relayer', {
        relayerAddress,
        orchestratorAddress: this.orchestratorAddress,
      });

      const { tx: configureTx } = await this.sendAndWaitWithRetry(
        () => this.contract.configureCCTP(currentMessenger, relayerAddress),
        'Arc relayer configuration'
      );

      logger.info('Arc bridge relayer configured', {
        relayerAddress,
        txHash: configureTx.hash,
      });
    }

    this.relayerReady = true;
  }

  async settleVault({
    amount,
    sourceChain,
    destinationChain,
    owner,
    unlockAt,
    vaultType,
  }) {
    await this.ensureRelayerConfigured();

    const amountInUnits = ethers.parseUnits(String(amount), 6);
    const sourceChainId = toContractChainId(sourceChain);
    const destinationChainId = toContractChainId(destinationChain || ARC_CHAIN_ID);
    const vaultTypeCode = VAULT_TYPE_CODES[vaultType];

    if (typeof vaultTypeCode !== 'number') {
      throw new Error(`Unsupported vault type for on-chain settlement: ${vaultType}`);
    }

    const ownerAddress = ethers.getAddress(owner);
    const unlockTimestamp = toUnlockTimestamp(unlockAt);

    logger.info('Submitting Arc on-chain settlement', {
      ownerAddress,
      amount,
      sourceChain,
      destinationChain,
      unlockTimestamp,
      vaultType,
    });

    const { tx: settlementTx, receipt } = await this.sendAndWaitWithRetry(
      () => this.contract.receiveBridgedUSDC_CCTP(
        amountInUnits,
        sourceChainId,
        ownerAddress,
        unlockTimestamp,
        destinationChainId,
        0,
        vaultTypeCode
      ),
      'Arc vault settlement'
    );

    const iface = new ethers.Interface(BRIDGE_ORCHESTRATOR_ABI);
    let onChainVaultId = null;

    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'BridgeCompleted') {
          onChainVaultId = parsed.args.vaultId;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!onChainVaultId) {
      throw new Error('Arc settlement succeeded but vault ID could not be read from the receipt.');
    }

    return {
      onChainVaultId,
      settlementTxHash: settlementTx.hash,
      relayerAddress: await this.wallet.getAddress(),
    };
  }

  async settleAdditionalDeposit({
    vaultId,
    amount,
    sourceChain,
    owner,
  }) {
    await this.ensureRelayerConfigured();

    const amountInUnits = ethers.parseUnits(String(amount), 6);
    const sourceChainId = toContractChainId(sourceChain);
    const ownerAddress = ethers.getAddress(owner);

    logger.info('Submitting Arc add-to-vault settlement', {
      vaultId,
      ownerAddress,
      amount,
      sourceChain,
    });

    let settlementTx;
    try {
      const settlementResult = await this.sendAndWaitWithRetry(
        () => this.contract.receiveAdditionalBridgedUSDC_CCTP(
          vaultId,
          amountInUnits,
          sourceChainId,
          ownerAddress
        ),
        'Arc add-to-vault settlement'
      );
      settlementTx = settlementResult.tx;
    } catch (err) {
      if (isVersionMismatchError(err)) {
        throw new Error(
          `Arc BridgeOrchestrator at ${this.orchestratorAddress} does not support add-to-vault settlement yet. Redeploy the updated Arc contracts, then update ARC_TIMELOCK_VAULT, ARC_BRIDGE_ORCHESTRATOR, ARC_VAULT_FACTORY, ARC_TREASURY, and ARC_PROOF_OF_RESERVES.`
        );
      }

      throw err;
    }

    const onChainVault = await this.getOnChainVault(vaultId);

    return {
      vaultId,
      settlementTxHash: settlementTx.hash,
      relayerAddress: await this.wallet.getAddress(),
      onChainVault,
    };
  }

  async getOnChainVault(vaultId) {
    if (!this.timeLockVaultContract) {
      throw new Error('Arc TimeLockVault is not configured. Missing ARC_TIMELOCK_VAULT address or ARC RPC.');
    }

    const vault = await this.timeLockVaultContract.getVault(vaultId);
    const statusCode = Number(vault.status);

    return {
      vaultId: vault.vaultId,
      owner: vault.owner,
      totalAmount: ethers.formatUnits(vault.totalAmount, 6),
      createdAt: Number(vault.createdAt),
      unlockAt: Number(vault.unlockAt),
      sourceChain: Number(vault.sourceChain),
      bridgeProtocol: Number(vault.bridgeProtocol),
      tokenAddress: vault.tokenAddress,
      vaultType: Number(vault.vaultType),
      statusCode,
      status: VAULT_STATUS_CODES[statusCode] || 'FAILED',
      bridgeTxHash: vault.bridgeTxHash,
    };
  }

  async ensureTimeLockVaultReserve(requiredAmount) {
    if (!this.usdcContract || !this.usdcWriteContract || !contractAddresses.timeLockVault) {
      throw new Error('Arc USDC reserve top-up is not configured.');
    }

    const requiredUnits = ethers.parseUnits(String(requiredAmount), 6);
    const currentBalance = await this.usdcContract.balanceOf(contractAddresses.timeLockVault);

    if (currentBalance >= requiredUnits) {
      return {
        toppedUp: false,
        currentBalance: ethers.formatUnits(currentBalance, 6),
        requiredAmount: ethers.formatUnits(requiredUnits, 6),
        shortfall: '0.0',
      };
    }

    const shortfall = requiredUnits - currentBalance;
    const relayerAddress = await this.wallet.getAddress();
    const relayerBalance = await this.usdcContract.balanceOf(relayerAddress);

    if (relayerBalance < shortfall) {
      throw new Error(
        `TimeLockVault reserve is short by ${ethers.formatUnits(shortfall, 6)} USDC, and relayer only has ${ethers.formatUnits(relayerBalance, 6)} USDC.`
      );
    }

    logger.warn('Topping up TimeLockVault reserve to cover CCTP fee shortfall', {
      timeLockVault: contractAddresses.timeLockVault,
      currentBalance: ethers.formatUnits(currentBalance, 6),
      requiredAmount: ethers.formatUnits(requiredUnits, 6),
      shortfall: ethers.formatUnits(shortfall, 6),
    });

    const { tx: topUpTx } = await this.sendAndWaitWithRetry(
      () => this.usdcWriteContract.transfer(contractAddresses.timeLockVault, shortfall),
      'Arc reserve top-up'
    );

    return {
      toppedUp: true,
      txHash: topUpTx.hash,
      currentBalance: ethers.formatUnits(currentBalance, 6),
      requiredAmount: ethers.formatUnits(requiredUnits, 6),
      shortfall: ethers.formatUnits(shortfall, 6),
    };
  }

  async syncFlexibleWithdrawal({
    vaultId,
    owner,
    amount,
    withdrawTxHash,
  }) {
    if (!this.provider || !this.timeLockVaultContract) {
      throw new Error('Arc withdrawal verification is not configured. Missing ARC RPC or TimeLockVault address.');
    }

    const tx = await this.provider.getTransaction(withdrawTxHash);
    if (!tx) {
      throw new Error('Withdrawal transaction was not found on Arc yet. Wait for confirmation and retry.');
    }

    if ((tx.to || '').toLowerCase() !== contractAddresses.timeLockVault.toLowerCase()) {
      throw new Error('Withdrawal transaction was not sent to the configured Arc TimeLockVault contract.');
    }

    const receipt = await this.provider.getTransactionReceipt(withdrawTxHash);
    if (!receipt || receipt.status !== 1) {
      throw new Error('Withdrawal transaction did not succeed on Arc.');
    }

    const expectedAmount = ethers.parseUnits(String(amount), 6);
    const expectedOwner = ethers.getAddress(owner);
    const iface = new ethers.Interface(TIMELOCK_VAULT_ABI);
    let withdrawalEvent = null;

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== contractAddresses.timeLockVault.toLowerCase()) {
        continue;
      }

      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name !== 'FlexibleWithdrawal') {
          continue;
        }

        if (
          parsed.args.vaultId.toLowerCase() === vaultId.toLowerCase() &&
          ethers.getAddress(parsed.args.owner) === expectedOwner
        ) {
          withdrawalEvent = parsed.args;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!withdrawalEvent) {
      throw new Error('Withdrawal transaction confirmed, but no matching FlexibleWithdrawal event was found.');
    }

    if (withdrawalEvent.amount !== expectedAmount) {
      throw new Error('Withdrawal amount on-chain does not match the amount submitted in the app.');
    }

    const penaltyAmount = withdrawalEvent.penalty;
    const onChainVault = await this.getOnChainVault(vaultId);

    return {
      withdrawTxHash,
      withdrawnAmount: ethers.formatUnits(withdrawalEvent.amount, 6),
      penaltyAmount: ethers.formatUnits(penaltyAmount, 6),
      userReceives: ethers.formatUnits(withdrawalEvent.amount - penaltyAmount, 6),
      onChainVault,
    };
  }

  async syncClaim({
    vaultId,
    owner,
    destinationChain,
    claimTxHash,
  }) {
    if (!this.provider || !this.timeLockVaultContract) {
      throw new Error('Arc claim verification is not configured. Missing ARC RPC or TimeLockVault address.');
    }

    const tx = await this.provider.getTransaction(claimTxHash);
    if (!tx) {
      throw new Error('Claim transaction was not found on Arc yet. Wait for confirmation and retry.');
    }

    if ((tx.to || '').toLowerCase() !== contractAddresses.timeLockVault.toLowerCase()) {
      throw new Error('Claim transaction was not sent to the configured Arc TimeLockVault contract.');
    }

    const receipt = await this.provider.getTransactionReceipt(claimTxHash);
    if (!receipt || receipt.status !== 1) {
      throw new Error('Claim transaction did not succeed on Arc.');
    }

    const expectedOwner = ethers.getAddress(owner);
    const expectedDestinationChain = Number(destinationChain);
    const iface = new ethers.Interface(TIMELOCK_VAULT_ABI);
    let claimEvent = null;

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== contractAddresses.timeLockVault.toLowerCase()) {
        continue;
      }

      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name !== 'VaultClaimed') {
          continue;
        }

        if (
          parsed.args.vaultId.toLowerCase() === vaultId.toLowerCase() &&
          ethers.getAddress(parsed.args.owner) === expectedOwner &&
          Number(parsed.args.destinationChain) === expectedDestinationChain
        ) {
          claimEvent = parsed.args;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!claimEvent) {
      throw new Error('Claim transaction confirmed, but no matching VaultClaimed event was found.');
    }

    const onChainVault = await this.getOnChainVault(vaultId);

    return {
      claimTxHash,
      claimedAmount: ethers.formatUnits(claimEvent.amount, 6),
      onChainVault,
    };
  }
}

export const arcSettlementService = new ArcSettlementService();
