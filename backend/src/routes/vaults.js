import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { pool } from '../config/database.js';
import { vaultService } from '../services/vaultService.js';
import { bridgeService } from '../services/bridgeService.js';
import { arcSettlementService } from '../services/arcSettlementService.js';
import { cctpRelayService } from '../services/cctpRelayService.js';
import { gasEstimationService } from '../services/gasEstimationService.js';
import logger from '../config/logger.js';
import { contractAddresses } from '../config/contracts.js';

const router = express.Router();
const ARC_CHAIN_ID = 5042002;
const MIN_TEST_DURATION_MS = 5 * 60 * 1000;
const MAX_DURATION_MS = 31536000000;
const CREATE_VAULT_RESPONSE_WAIT_MS = Number(process.env.CREATE_VAULT_RESPONSE_WAIT_MS || 25000);
const createVaultLocks = new Map();

function parseBridgeMetadata(attestationData) {
  if (!attestationData) {
    return {};
  }

  try {
    return JSON.parse(attestationData);
  } catch {
    return {};
  }
}

function buildOutboundBridgeStatus(transaction) {
  const metadata = parseBridgeMetadata(transaction?.attestation_data);
  const state =
    metadata.relayState ||
    (transaction?.status === 'COMPLETE' ? 'COMPLETE' : 'PENDING_ATTESTATION');

  return {
    state,
    estimatedTime: state === 'COMPLETE' ? '0' : '2-5 minutes',
    destinationTxHash: metadata.destinationTxHash || metadata.destinationMintTxHash || null,
  };
}

function buildRecipientMismatchMetadata(existingMetadata, error) {
  return {
    ...existingMetadata,
    relayState: 'RECIPIENT_MISMATCH',
    expectedMintRecipient: error.expectedRecipient || contractAddresses.timeLockVault || null,
    actualMintRecipient: error.actualRecipient || null,
  };
}

function buildMintRecipientPendingMetadata(existingMetadata, error = {}) {
  return {
    ...existingMetadata,
    relayState: 'MINT_RECIPIENT_UNAVAILABLE',
    mintRecipient: contractAddresses.timeLockVault,
    expectedMintRecipient: error.expectedRecipient || contractAddresses.timeLockVault || null,
    actualMintRecipient: null,
  };
}

function hasConfirmedRecipientMismatch(metadata) {
  return metadata?.relayState === 'RECIPIENT_MISMATCH' && Boolean(metadata.actualMintRecipient);
}

function isRetryableRecipientDecodeFailure(metadata) {
  return metadata?.relayState === 'RECIPIENT_MISMATCH' && !metadata.actualMintRecipient;
}

function isRelayComplete(transaction, metadata) {
  return transaction.status === 'COMPLETE' && metadata?.relayState === 'COMPLETE';
}

function getExpectedCctpAmount(transaction) {
  const metadata = parseBridgeMetadata(transaction.attestation_data);
  return metadata.cctpBurnAmount || transaction.amount;
}

function getCreateLockKey(sourceTxHash) {
  return String(sourceTxHash || '').toLowerCase();
}

function buildCreateProcessingResponse(sourceTxHash, startedAt = Date.now()) {
  return {
    status: 'PROCESSING',
    sourceTxHash,
    bridgeStatus: {
      state: 'ARC_SETTLEMENT_PROCESSING',
      estimatedTime: 'Arc settlement is still confirming; retry recovery shortly if the vault does not appear',
      startedAt,
    },
    message: 'This burn transaction is being settled into an Arc vault.',
  };
}

async function waitForCreateJob(job, timeoutMs = CREATE_VAULT_RESPONSE_WAIT_MS) {
  return Promise.race([
    job.promise,
    new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          ok: true,
          statusCode: 202,
          body: buildCreateProcessingResponse(job.sourceTxHash, job.startedAt),
        });
      }, timeoutMs);
    }),
  ]);
}

function serializeCreateError(err) {
  return {
    message:
      err.shortMessage ||
      err.reason ||
      err.info?.error?.message ||
      err.message ||
      'Failed to create vault',
    stack: err.stack,
  };
}

function startCreateVaultJob(sourceLockKey, params) {
  const startedAt = Date.now();
  const promise = (async () => {
    try {
      const body = await runCreateVaultSettlement(params);
      return {
        ok: true,
        statusCode: 201,
        body,
      };
    } catch (err) {
      const error = serializeCreateError(err);
      logger.error('Error creating vault', {
        error: error.message,
        stack: error.stack,
        sourceTxHash: params.sourceTxHash,
        userAddress: params.userAddress,
      });

      return {
        ok: false,
        statusCode: 500,
        body: {
          error: {
            message: process.env.NODE_ENV === 'production'
              ? 'Failed to create vault'
              : error.message,
          },
        },
      };
    } finally {
      createVaultLocks.delete(sourceLockKey);
    }
  })();

  const job = {
    promise,
    sourceTxHash: params.sourceTxHash,
    startedAt,
  };

  createVaultLocks.set(sourceLockKey, job);
  return job;
}

async function runCreateVaultSettlement({
  amount,
  customDuration,
  sourceChain,
  destinationChain,
  bridgeProtocol,
  tokenAddress,
  vaultType,
  userAddress,
  sourceTxHash,
  cctpBurnAmount,
  cctpMaxFeeAmount,
  cctpFinalityThreshold,
  authId,
  email,
}) {
  const now = Math.floor(Date.now() / 1000);
  const unlockAt = now + Math.floor(customDuration / 1000);

  await pool.query(
    `INSERT INTO users (address, auth_subject, email, last_login)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (address)
     DO UPDATE SET
       auth_subject = EXCLUDED.auth_subject,
       email = COALESCE(EXCLUDED.email, users.email),
       last_login = NOW()`,
    [userAddress, authId, email]
  );

  const settlement = await arcSettlementService.settleVault({
    amount,
    sourceChain,
    destinationChain,
    owner: userAddress,
    unlockAt: new Date(unlockAt * 1000),
    vaultType,
  });

  const vaultId = settlement.onChainVaultId;
  const relayResult = { state: 'PENDING_ATTESTATION' };

  await vaultService.createVault(
    vaultId,
    userAddress,
    amount,
    new Date(),
    new Date(unlockAt * 1000),
    sourceChain,
    destinationChain,
    bridgeProtocol,
    tokenAddress,
    vaultType,
    settlement.settlementTxHash
  );

  const bridgeTransaction = await bridgeService.createBridgeTransaction(
    sourceTxHash,
    vaultId,
    'INBOUND',
    sourceChain,
    ARC_CHAIN_ID,
    amount,
    bridgeProtocol,
    tokenAddress,
    relayResult.state === 'COMPLETE' ? 'COMPLETE' : 'PENDING',
    JSON.stringify({
      settlementTxHash: settlement.settlementTxHash,
      relayerAddress: settlement.relayerAddress,
      destinationChain: destinationChain || ARC_CHAIN_ID,
      relayState: relayResult.state,
      destinationMintTxHash: relayResult.destinationTxHash || null,
      mintRecipient: contractAddresses.timeLockVault,
      lockAmount: amount,
      cctpBurnAmount: cctpBurnAmount || amount,
      cctpMaxFeeAmount: cctpMaxFeeAmount || '0',
      cctpFinalityThreshold: cctpFinalityThreshold || null,
      attestation: relayResult.attestation || null,
      message: relayResult.message || null,
    }),
    relayResult.state === 'COMPLETE' ? new Date() : null
  );
  scheduleInboundCctpRelay(bridgeTransaction);

  logger.info('Vault created on-chain', {
    vaultId,
    userAddress,
    amount,
    settlementTxHash: settlement.settlementTxHash,
  });

  return {
    vaultId,
    status: 'ACTIVE',
    unlockAt: unlockAt * 1000,
    bridgeTxHash: sourceTxHash,
    destinationTxHash: settlement.settlementTxHash,
    bridgeStatus: {
      state: relayResult.state,
      estimatedTime: 'usually under 1 minute with fast CCTP, longer if Circle attestation is delayed',
      destinationMintTxHash: null,
    },
  };
}

async function buildExistingCreateResponse(sourceTxHash, userAddress) {
  const existingBridgeTx = await bridgeService.getBridgeTransaction(sourceTxHash);
  if (!existingBridgeTx) {
    return null;
  }

  const existingVault = await vaultService.getVault(existingBridgeTx.vault_id);
  if (!existingVault) {
    return null;
  }

  if (existingVault.owner_address !== userAddress) {
    return {
      statusCode: 409,
      body: {
        error: {
          message: 'This source burn transaction is already linked to another wallet.',
        },
      },
    };
  }

  const metadata = parseBridgeMetadata(existingBridgeTx.attestation_data);

  return {
    statusCode: 200,
    body: {
      vaultId: existingVault.vault_id,
      status: existingVault.status,
      unlockAt: new Date(existingVault.unlock_at).getTime(),
      bridgeTxHash: existingBridgeTx.tx_hash,
      destinationTxHash: metadata.settlementTxHash || existingVault.created_on_chain_tx || null,
      bridgeStatus: {
        state: metadata.relayState || (existingBridgeTx.status === 'COMPLETE' ? 'COMPLETE' : 'PENDING_ATTESTATION'),
        estimatedTime: existingBridgeTx.status === 'COMPLETE'
          ? '0'
          : 'usually under 1 minute with fast CCTP, longer if Circle attestation is delayed',
        destinationMintTxHash: metadata.destinationMintTxHash || null,
      },
    },
  };
}

async function finalizeInboundCctpToArc({ burnTxHash, sourceChain, amount, waitForAttestationMs = 20000 }) {
  if (!contractAddresses.timeLockVault) {
    throw new Error('Arc TimeLockVault address is missing from backend configuration.');
  }

  return cctpRelayService.finalizeBurnAndMint({
    burnTxHash,
    sourceChain,
    destinationChain: ARC_CHAIN_ID,
    expectedRecipient: contractAddresses.timeLockVault,
    expectedAmount: amount,
    waitForAttestationMs,
  });
}

async function refreshInboundVaultFunding(bridgeTransactions = [], options = {}) {
  const waitForAttestationMs = options.waitForAttestationMs ?? 5000;
  const inboundTransactions = bridgeTransactions.filter((tx) => {
    if (tx.bridge_protocol !== 'CCTP') return false;
    if (tx.direction !== 'INBOUND') return false;

    const metadata = parseBridgeMetadata(tx.attestation_data);
    if (isRelayComplete(tx, metadata)) return false;
    if (tx.status === 'FAILED' && !isRetryableRecipientDecodeFailure(metadata)) return false;
    if (hasConfirmedRecipientMismatch(metadata)) return false;

    return !metadata.destinationMintTxHash;
  });

  for (const transaction of inboundTransactions) {
    try {
      const relayResult = await finalizeInboundCctpToArc({
        burnTxHash: transaction.tx_hash,
        sourceChain: transaction.from_chain,
        amount: getExpectedCctpAmount(transaction),
        waitForAttestationMs,
      });

      const metadata = parseBridgeMetadata(transaction.attestation_data);

      if (relayResult.state === 'COMPLETE') {
        await bridgeService.updateBridgeStatus(
          transaction.tx_hash,
          'COMPLETE',
          JSON.stringify({
            ...metadata,
            relayState: relayResult.state,
            destinationMintTxHash: relayResult.destinationTxHash,
            attestation: relayResult.attestation,
            message: relayResult.message,
            mintRecipient: contractAddresses.timeLockVault,
          }),
          new Date()
        );
      } else {
        await bridgeService.updateBridgeStatus(
          transaction.tx_hash,
          'PENDING',
          JSON.stringify({
            ...metadata,
            relayState: relayResult.state,
            mintRecipient: contractAddresses.timeLockVault,
          }),
          null
        );
      }
    } catch (err) {
      const metadata = parseBridgeMetadata(transaction.attestation_data);

      if (err.code === 'MINT_RECIPIENT_UNAVAILABLE') {
        await bridgeService.updateBridgeStatus(
          transaction.tx_hash,
          'PENDING',
          JSON.stringify(buildMintRecipientPendingMetadata(metadata, err)),
          null
        );
      } else if (err.code === 'RECIPIENT_MISMATCH') {
        await bridgeService.updateBridgeStatus(
          transaction.tx_hash,
          'FAILED',
          JSON.stringify(buildRecipientMismatchMetadata(metadata, err)),
          new Date()
        );
      }

      logger.warn('Inbound CCTP mint reconciliation failed', {
        txHash: transaction.tx_hash,
        error: err.message,
        expectedRecipient: err.expectedRecipient,
        actualRecipient: err.actualRecipient,
      });
    }
  }
}

async function ensureReserveCoverageForClaims(requiredAmount) {
  try {
    if (Number(requiredAmount) <= 0) {
      return;
    }

    const reserveResult = await arcSettlementService.ensureTimeLockVaultReserve(requiredAmount);
    if (reserveResult.toppedUp) {
      logger.warn('TimeLockVault reserve top-up completed', reserveResult);
    }
  } catch (err) {
    logger.warn('TimeLockVault reserve coverage check failed', {
      error: err.message,
    });
  }
}

function scheduleInboundCctpRelay(transaction, waitForAttestationMs = 60000) {
  setTimeout(() => {
    refreshInboundVaultFunding([transaction], { waitForAttestationMs }).catch((err) => {
      logger.warn('Scheduled inbound CCTP relay failed', {
        txHash: transaction?.tx_hash,
        error: err.message,
      });
    });
  }, 1000);
}

router.get('/preflight', asyncHandler(async (req, res) => {
  const settlement = await arcSettlementService.getStatus();

  res.json({
    arcSettlement: settlement,
  });
}));

// Create vault
router.post('/create', authMiddleware, asyncHandler(async (req, res) => {
  const {
    amount,
    customDuration,
    sourceChain,
    destinationChain,
    bridgeProtocol,
    tokenAddress,
    vaultType,
    ownerAddress,
    sourceTxHash,
    cctpBurnAmount,
    cctpMaxFeeAmount,
    cctpFinalityThreshold,
  } = req.body;
  const userAddress = (req.user.address || '').toLowerCase();

  if (!userAddress) {
    return res.status(400).json({
      error: {
        message: 'No wallet address found in your wallet session. Please reconnect your wallet and try again.'
      }
    });
  }

  if (ownerAddress && ownerAddress.toLowerCase() !== userAddress) {
    return res.status(403).json({
      error: {
        message: 'Owner address does not match connected wallet.'
      }
    });
  }

  // Validation
  if (!amount || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: { message: 'Amount must be > 0' } });
  }
  if (!customDuration || customDuration < MIN_TEST_DURATION_MS || customDuration > MAX_DURATION_MS) {
    return res.status(400).json({ error: { message: 'Invalid duration (5 mins to 12 months)' } });
  }
  if (!['FIXED', 'FLEXIBLE'].includes(vaultType)) {
    return res.status(400).json({ error: { message: 'Invalid vault type' } });
  }
  if (bridgeProtocol !== 'CCTP') {
    return res.status(400).json({
      error: {
        message: 'On-chain destination settlement is currently implemented for CCTP only.'
      }
    });
  }

  if (typeof sourceTxHash !== 'string' || !sourceTxHash.startsWith('0x')) {
    return res.status(400).json({
      error: {
        message: 'Missing source transaction hash. Please retry after the source-chain transfer is confirmed.'
      }
    });
  }

  try {
    const existingCreate = await buildExistingCreateResponse(sourceTxHash, userAddress);
    if (existingCreate) {
      return res.status(existingCreate.statusCode).json(existingCreate.body);
    }

    const sourceLockKey = getCreateLockKey(sourceTxHash);
    let createJob = createVaultLocks.get(sourceLockKey);

    if (!createJob) {
      createJob = startCreateVaultJob(sourceLockKey, {
        amount,
        customDuration,
        sourceChain,
        destinationChain,
        bridgeProtocol,
        tokenAddress,
        vaultType,
        userAddress,
        sourceTxHash,
        cctpBurnAmount,
        cctpMaxFeeAmount,
        cctpFinalityThreshold,
        authId: req.user.authId,
        email: req.user.email,
      });
    }

    const jobResult = await waitForCreateJob(createJob);
    return res.status(jobResult.statusCode).json(jobResult.body);
  } catch (err) {
    const error = serializeCreateError(err);
    logger.error('Error creating vault request', {
      error: error.message,
      stack: error.stack,
      sourceTxHash,
      userAddress,
    });

    return res.status(500).json({
      error: {
        message: process.env.NODE_ENV === 'production'
          ? 'Failed to create vault'
          : error.message,
      },
    });
  }
}));

// Get vault details
router.get('/:vaultId', asyncHandler(async (req, res) => {
  const { vaultId } = req.params;

  try {
    const vault = await vaultService.getVault(vaultId);
    if (!vault) {
      return res.status(404).json({ error: { message: 'Vault not found' } });
    }

    const deposits = await vaultService.getVaultDeposits(vaultId);
    let bridgeTransactions = await bridgeService.getVaultBridgeTransactions(vaultId);
    await refreshInboundVaultFunding(bridgeTransactions, { waitForAttestationMs: 1000 });
    await ensureReserveCoverageForClaims(vault.total_amount);
    bridgeTransactions = await bridgeService.getVaultBridgeTransactions(vaultId);

    res.json({
      ...vault,
      deposits,
      bridgeTransactions
    });
  } catch (err) {
    logger.error('Error fetching vault', { error: err.message });
    res.status(500).json({ error: { message: 'Failed to fetch vault' } });
  }
}));

// Get user's vaults
router.get('/user/:userAddress', asyncHandler(async (req, res) => {
  const { userAddress } = req.params;

  try {
    const vaults = await vaultService.getUserVaults(userAddress);
    const transactions = [];

    for (const vault of vaults) {
      const vaultTxs = await bridgeService.getVaultBridgeTransactions(vault.vault_id);
      transactions.push(...vaultTxs);
    }

    res.json({
      vaults,
      transactions,
      count: vaults.length
    });
  } catch (err) {
    logger.error('Error fetching user vaults', { error: err.message });
    res.status(500).json({ error: { message: 'Failed to fetch vaults' } });
  }
}));

// Add to vault
router.post('/:vaultId/add', authMiddleware, asyncHandler(async (req, res) => {
  const { vaultId } = req.params;
  const {
    amount,
    ownerAddress,
    sourceTxHash,
    cctpBurnAmount,
    cctpMaxFeeAmount,
    cctpFinalityThreshold,
  } = req.body;
  const userAddress = req.user.address ? req.user.address.toLowerCase() : null;

  if (!userAddress) {
    return res.status(400).json({
      error: {
        message: 'No wallet address found in your wallet session. Please reconnect your wallet and try again.'
      }
    });
  }

  if (!amount || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: { message: 'Amount must be > 0' } });
  }

  if (ownerAddress && ownerAddress.toLowerCase() !== userAddress) {
    return res.status(403).json({
      error: {
        message: 'Owner address does not match connected wallet.'
      }
    });
  }

  if (typeof sourceTxHash !== 'string' || !sourceTxHash.startsWith('0x')) {
    return res.status(400).json({
      error: {
        message: 'Missing source transaction hash. Please retry after the source-chain transfer is confirmed.'
      }
    });
  }

  try {
    const vault = await vaultService.getVault(vaultId);
    if (!vault) {
      return res.status(404).json({ error: { message: 'Vault not found' } });
    }
    if (vault.owner_address !== userAddress) {
      return res.status(403).json({ error: { message: 'Not vault owner' } });
    }
    if (vault.status !== 'ACTIVE') {
      return res.status(400).json({ error: { message: 'Vault not active' } });
    }
    if (Date.now() >= new Date(vault.unlock_at).getTime()) {
      return res.status(400).json({
        error: {
          message: 'Vault is already mature and cannot accept additional deposits.'
        }
      });
    }
    if (vault.bridge_protocol !== 'CCTP') {
      return res.status(400).json({
        error: {
          message: 'Additional deposits are currently wired for CCTP USDC vaults only.'
        }
      });
    }

    const existingBridgeTx = await bridgeService.getBridgeTransaction(sourceTxHash);
    if (existingBridgeTx) {
      return res.status(409).json({
        error: {
          message: 'This source transaction hash has already been used.'
        }
      });
    }

    const settlement = await arcSettlementService.settleAdditionalDeposit({
      vaultId,
      amount,
      sourceChain: vault.source_chain,
      owner: userAddress,
    });

    const relayResult = { state: 'PENDING_ATTESTATION' };

    await vaultService.addDeposit(
      vaultId,
      amount,
      vault.source_chain,
      vault.bridge_protocol,
      sourceTxHash
    );

    await vaultService.syncVaultState(
      vaultId,
      settlement.onChainVault.totalAmount,
      settlement.onChainVault.status
    );

    const bridgeTransaction = await bridgeService.createBridgeTransaction(
      sourceTxHash,
      vaultId,
      'INBOUND',
      vault.source_chain,
      ARC_CHAIN_ID,
      amount,
      vault.bridge_protocol,
      vault.token_address,
      relayResult.state === 'COMPLETE' ? 'COMPLETE' : 'PENDING',
      JSON.stringify({
        settlementTxHash: settlement.settlementTxHash,
        relayerAddress: settlement.relayerAddress,
        type: 'ADD_TO_VAULT',
        relayState: relayResult.state,
        destinationMintTxHash: relayResult.destinationTxHash || null,
        mintRecipient: contractAddresses.timeLockVault,
        lockAmount: amount,
        cctpBurnAmount: cctpBurnAmount || amount,
        cctpMaxFeeAmount: cctpMaxFeeAmount || '0',
        cctpFinalityThreshold: cctpFinalityThreshold || null,
        attestation: relayResult.attestation || null,
        message: relayResult.message || null,
      }),
      relayResult.state === 'COMPLETE' ? new Date() : null
    );
    scheduleInboundCctpRelay(bridgeTransaction);

    logger.info('Vault topped up on-chain', {
      vaultId,
      userAddress,
      amount,
      sourceTxHash,
      settlementTxHash: settlement.settlementTxHash,
    });

    return res.status(201).json({
      vaultId,
      addedAmount: amount,
      newTotal: settlement.onChainVault.totalAmount,
      bridgeTxHash: sourceTxHash,
      destinationTxHash: settlement.settlementTxHash,
      bridgeStatus: {
        state: relayResult.state,
        estimatedTime: 'usually under 1 minute with fast CCTP, longer if Circle attestation is delayed',
        destinationMintTxHash: null,
      }
    });
  } catch (err) {
    const message =
      err.shortMessage ||
      err.reason ||
      err.info?.error?.message ||
      err.message ||
      'Failed to add to vault';

    logger.error('Error adding to vault', {
      error: message,
      stack: err.stack,
      vaultId,
      userAddress,
    });
    res.status(500).json({
      error: {
        message: process.env.NODE_ENV === 'production' ? 'Failed to add to vault' : message,
      }
    });
  }
}));

router.post('/:vaultId/add/recover', authMiddleware, asyncHandler(async (req, res) => {
  const { vaultId } = req.params;
  const { amount, sourceTxHash } = req.body;
  const userAddress = req.user.address ? req.user.address.toLowerCase() : null;

  if (!userAddress) {
    return res.status(400).json({
      error: {
        message: 'No wallet address found in your wallet session. Please reconnect your wallet and try again.'
      }
    });
  }

  if (!amount || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: { message: 'Amount must be > 0' } });
  }

  if (typeof sourceTxHash !== 'string' || !sourceTxHash.startsWith('0x')) {
    return res.status(400).json({
      error: {
        message: 'Missing source transaction hash for recovery.'
      }
    });
  }

  try {
    const vault = await vaultService.getVault(vaultId);
    if (!vault) {
      return res.status(404).json({ error: { message: 'Vault not found' } });
    }
    if (vault.owner_address !== userAddress) {
      return res.status(403).json({ error: { message: 'Not vault owner' } });
    }
    if (vault.status !== 'ACTIVE') {
      return res.status(400).json({ error: { message: 'Vault not active' } });
    }
    if (vault.bridge_protocol !== 'CCTP') {
      return res.status(400).json({
        error: {
          message: 'Recovery is currently wired for CCTP USDC vaults only.'
        }
      });
    }

    const existingBridgeTx = await bridgeService.getBridgeTransaction(sourceTxHash);
    if (existingBridgeTx) {
      return res.status(409).json({
        error: {
          message: 'This source transaction hash has already been recovered.'
        }
      });
    }

    const settlement = await arcSettlementService.settleAdditionalDeposit({
      vaultId,
      amount,
      sourceChain: vault.source_chain,
      owner: userAddress,
    });

    const relayResult = { state: 'PENDING_ATTESTATION' };

    await vaultService.addDeposit(
      vaultId,
      amount,
      vault.source_chain,
      vault.bridge_protocol,
      sourceTxHash
    );

    await vaultService.syncVaultState(
      vaultId,
      settlement.onChainVault.totalAmount,
      settlement.onChainVault.status
    );

    const bridgeTransaction = await bridgeService.createBridgeTransaction(
      sourceTxHash,
      vaultId,
      'INBOUND',
      vault.source_chain,
      ARC_CHAIN_ID,
      amount,
      vault.bridge_protocol,
      vault.token_address,
      relayResult.state === 'COMPLETE' ? 'COMPLETE' : 'PENDING',
      JSON.stringify({
        settlementTxHash: settlement.settlementTxHash,
        relayerAddress: settlement.relayerAddress,
        type: 'ADD_TO_VAULT_RECOVERY',
        relayState: relayResult.state,
        destinationMintTxHash: relayResult.destinationTxHash || null,
        mintRecipient: contractAddresses.timeLockVault,
        attestation: relayResult.attestation || null,
        message: relayResult.message || null,
      }),
      relayResult.state === 'COMPLETE' ? new Date() : null
    );
    scheduleInboundCctpRelay(bridgeTransaction);

    return res.status(201).json({
      vaultId,
      recoveredAmount: amount,
      newTotal: settlement.onChainVault.totalAmount,
      bridgeTxHash: sourceTxHash,
      destinationTxHash: settlement.settlementTxHash,
      bridgeStatus: {
        state: relayResult.state,
        estimatedTime: 'usually under 1 minute with fast CCTP, longer if Circle attestation is delayed',
        destinationMintTxHash: null,
      }
    });
  } catch (err) {
    const message =
      err.shortMessage ||
      err.reason ||
      err.info?.error?.message ||
      err.message ||
      'Failed to recover add-to-vault transfer';

    logger.error('Error recovering add-to-vault transfer', {
      error: message,
      stack: err.stack,
      vaultId,
      userAddress,
      sourceTxHash,
    });
    res.status(500).json({
      error: {
        message: process.env.NODE_ENV === 'production'
          ? 'Failed to recover add-to-vault transfer'
          : message,
      }
    });
  }
}));

// Claim vault
router.post('/:vaultId/claim', authMiddleware, asyncHandler(async (req, res) => {
  const { vaultId } = req.params;
  const { destinationChain, claimTxHash, bridgeBackTxHash } = req.body;
  const userAddress = req.user.address ? req.user.address.toLowerCase() : null;

  if (!userAddress) {
    return res.status(400).json({
      error: {
        message: 'No wallet address found in your wallet session. Please reconnect your wallet and try again.'
      }
    });
  }

  try {
    const vault = await vaultService.getVault(vaultId);
    if (!vault) {
      return res.status(404).json({ error: { message: 'Vault not found' } });
    }
    if (vault.owner_address !== userAddress) {
      return res.status(403).json({ error: { message: 'Not vault owner' } });
    }

    const now = Math.floor(Date.now() / 1000);
    const unlockTime = Math.floor(vault.unlock_at.getTime() / 1000);

    if (now < unlockTime) {
      return res.status(400).json({ error: { message: 'Vault not mature yet' } });
    }

    if (typeof claimTxHash !== 'string' || !claimTxHash.startsWith('0x')) {
      return res.status(400).json({
        error: {
          message: 'Missing Arc claim transaction hash. Please retry after the wallet transaction is confirmed.'
        }
      });
    }

    const claimDestinationChain = Number(destinationChain || ARC_CHAIN_ID);

    if (vault.status === 'CLAIMED') {
      const existingBridgeTx = typeof bridgeBackTxHash === 'string'
        ? await bridgeService.getBridgeTransaction(bridgeBackTxHash)
        : null;

      if (existingBridgeTx && existingBridgeTx.vault_id === vaultId) {
        return res.json({
          vaultId,
          status: 'CLAIMED',
          amount: existingBridgeTx.amount,
          claimedTxHash: claimTxHash,
          bridgeTxHash: existingBridgeTx.tx_hash,
          destinationChain: claimDestinationChain,
          bridgeStatus: buildOutboundBridgeStatus(existingBridgeTx),
        });
      }

      return res.status(400).json({ error: { message: 'Vault already claimed' } });
    }

    const settlement = await arcSettlementService.syncClaim({
      vaultId,
      owner: userAddress,
      destinationChain: claimDestinationChain,
      claimTxHash,
    });

    await vaultService.updateVaultStatus(vaultId, 'CLAIMED', claimTxHash);
    await vaultService.syncVaultState(
      vaultId,
      settlement.claimedAmount,
      'CLAIMED'
    );

    if (claimDestinationChain === ARC_CHAIN_ID || claimDestinationChain === vault.source_chain && Number(vault.source_chain) === ARC_CHAIN_ID) {
      await bridgeService.createBridgeTransaction(
        claimTxHash,
        vaultId,
        'OUTBOUND',
        ARC_CHAIN_ID,
        ARC_CHAIN_ID,
        settlement.claimedAmount,
        vault.bridge_protocol,
        vault.token_address,
        'COMPLETE',
        JSON.stringify({
          type: 'ARC_DIRECT_CLAIM',
          destinationChain: ARC_CHAIN_ID,
        }),
        new Date()
      );

      logger.info('Vault claimed on Arc', {
        vaultId,
        userAddress,
        claimTxHash,
        claimedAmount: settlement.claimedAmount,
      });

      return res.json({
        vaultId,
        status: 'CLAIMED',
        amount: settlement.claimedAmount,
        claimedTxHash: claimTxHash,
        destinationChain: ARC_CHAIN_ID,
        bridgeStatus: {
          state: 'COMPLETE',
          estimatedTime: '0'
        }
      });
    }

    if (claimDestinationChain !== Number(vault.source_chain)) {
      return res.status(400).json({
        error: {
          message: 'Mature vaults can currently be claimed either on Arc Testnet or back to their original source chain.'
        }
      });
    }

    if (vault.bridge_protocol !== 'CCTP') {
      return res.status(400).json({
        error: {
          message: 'Claim back to source chain is currently available for CCTP USDC vaults only.'
        }
      });
    }

    if (typeof bridgeBackTxHash !== 'string' || !bridgeBackTxHash.startsWith('0x')) {
      return res.status(400).json({
        error: {
          message: 'Missing Arc bridge-back transaction hash. Please retry after the wallet bridge transaction is confirmed.'
        }
      });
    }

    const existingBridgeTx = await bridgeService.getBridgeTransaction(bridgeBackTxHash);
    if (existingBridgeTx) {
      if (existingBridgeTx.vault_id === vaultId) {
        return res.json({
          vaultId,
          status: 'CLAIMED',
          amount: existingBridgeTx.amount,
          claimedTxHash: claimTxHash,
          bridgeTxHash: existingBridgeTx.tx_hash,
          destinationChain: claimDestinationChain,
          bridgeStatus: buildOutboundBridgeStatus(existingBridgeTx),
        });
      }

      return res.status(409).json({
        error: {
          message: 'This Arc bridge-back transaction hash has already been used.'
        }
      });
    }

    const initialBridgeMetadata = {
      type: 'CCTP_RETURN_TO_SOURCE',
      claimTxHash,
      recipient: userAddress,
      destinationChain: claimDestinationChain,
    };

    await bridgeService.createBridgeTransaction(
      bridgeBackTxHash,
      vaultId,
      'OUTBOUND',
      ARC_CHAIN_ID,
      claimDestinationChain,
      settlement.claimedAmount,
      vault.bridge_protocol,
      vault.token_address,
      'PENDING',
      JSON.stringify(initialBridgeMetadata),
      null
    );

    const bridgeStatus = {
      state: 'PENDING_ATTESTATION',
      estimatedTime: '2-5 minutes',
      destinationTxHash: null,
    };

    logger.info('Vault claimed back to source chain', {
      vaultId,
      userAddress,
      claimTxHash,
      bridgeBackTxHash,
      destinationChain: claimDestinationChain,
      claimedAmount: settlement.claimedAmount,
      bridgeState: bridgeStatus.state,
    });

    res.json({
      vaultId,
      status: 'CLAIMED',
      amount: settlement.claimedAmount,
      claimedTxHash: claimTxHash,
      bridgeTxHash: bridgeBackTxHash,
      destinationChain: claimDestinationChain,
      bridgeStatus,
    });
  } catch (err) {
    const message =
      err.shortMessage ||
      err.reason ||
      err.info?.error?.message ||
      err.message ||
      'Failed to claim vault';

    logger.error('Error claiming vault', { error: message, stack: err.stack, vaultId, userAddress });
    res.status(500).json({
      error: {
        message: process.env.NODE_ENV === 'production' ? 'Failed to claim vault' : message,
      }
    });
  }
}));

// Withdraw from FLEXIBLE vault
router.post('/:vaultId/withdraw', authMiddleware, asyncHandler(async (req, res) => {
  const { vaultId } = req.params;
  const { amount, withdrawTxHash, destinationChain, bridgeBackTxHash } = req.body;
  const userAddress = req.user.address ? req.user.address.toLowerCase() : null;

  if (!userAddress) {
    return res.status(400).json({
      error: {
        message: 'No wallet address found in your wallet session. Please reconnect your wallet and try again.'
      }
    });
  }

  if (!amount || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: { message: 'Amount must be > 0' } });
  }

  if (typeof withdrawTxHash !== 'string' || !withdrawTxHash.startsWith('0x')) {
    return res.status(400).json({
      error: {
        message: 'Missing Arc withdrawal transaction hash. Please retry after the wallet transaction is confirmed.'
      }
    });
  }

  try {
    const vault = await vaultService.getVault(vaultId);
    if (!vault) {
      return res.status(404).json({ error: { message: 'Vault not found' } });
    }
    if (vault.owner_address !== userAddress) {
      return res.status(403).json({ error: { message: 'Not vault owner' } });
    }
    if (vault.vault_type !== 'FLEXIBLE') {
      return res.status(400).json({ error: { message: 'Not a flexible vault' } });
    }
    if (vault.status !== 'ACTIVE') {
      const existingBridgeTx = typeof bridgeBackTxHash === 'string'
        ? await bridgeService.getBridgeTransaction(bridgeBackTxHash)
        : null;

      if (existingBridgeTx && existingBridgeTx.vault_id === vaultId) {
        return res.json({
          vaultId,
          withdrawnAmount: amount,
          penalty: parseBridgeMetadata(existingBridgeTx.attestation_data).penalty || '0',
          userReceives: existingBridgeTx.amount,
          remainingBalance: vault.total_amount,
          status: vault.status,
          withdrawTxHash,
          bridgeTxHash: existingBridgeTx.tx_hash,
          destinationChain: Number(destinationChain || ARC_CHAIN_ID),
          bridgeStatus: buildOutboundBridgeStatus(existingBridgeTx),
        });
      }

      return res.status(400).json({ error: { message: 'Vault not active' } });
    }
    if (parseFloat(amount) > parseFloat(vault.total_amount)) {
      return res.status(400).json({ error: { message: 'Insufficient balance' } });
    }

    const withdrawDestinationChain = Number(destinationChain || ARC_CHAIN_ID);
    if (withdrawDestinationChain !== ARC_CHAIN_ID && withdrawDestinationChain !== Number(vault.source_chain)) {
      return res.status(400).json({
        error: {
          message: 'Flexible withdrawals can currently settle either on Arc Testnet or back to the original source chain.',
        }
      });
    }

    const settlement = await arcSettlementService.syncFlexibleWithdrawal({
      vaultId,
      owner: userAddress,
      amount,
      withdrawTxHash,
    });

    if (settlement.onChainVault.status === 'CLAIMED' && Number(settlement.onChainVault.totalAmount) === 0) {
      await vaultService.updateVaultStatus(vaultId, 'CLAIMED');
    } else {
      await vaultService.syncVaultState(
        vaultId,
        settlement.onChainVault.totalAmount,
        settlement.onChainVault.status
      );
    }

    if (withdrawDestinationChain === ARC_CHAIN_ID || Number(vault.source_chain) === ARC_CHAIN_ID) {
      await bridgeService.createBridgeTransaction(
        withdrawTxHash,
        vaultId,
        'OUTBOUND',
        ARC_CHAIN_ID,
        ARC_CHAIN_ID,
        settlement.userReceives,
        vault.bridge_protocol,
        vault.token_address,
        'COMPLETE',
        JSON.stringify({
          type: 'FLEXIBLE_WITHDRAWAL',
          penalty: settlement.penaltyAmount,
          destinationChain: ARC_CHAIN_ID,
        }),
        new Date()
      );

      logger.info('Flexible withdrawal synced from Arc', {
        vaultId,
        amount,
        withdrawTxHash,
        penalty: settlement.penaltyAmount,
      });

      return res.json({
        vaultId,
        withdrawnAmount: settlement.withdrawnAmount,
        penalty: settlement.penaltyAmount,
        userReceives: settlement.userReceives,
        remainingBalance: settlement.onChainVault.totalAmount,
        status: settlement.onChainVault.status,
        withdrawTxHash,
        destinationChain: ARC_CHAIN_ID,
        bridgeStatus: {
          state: 'COMPLETE',
          estimatedTime: '0'
        }
      });
    }

    if (vault.bridge_protocol !== 'CCTP') {
      return res.status(400).json({
        error: {
          message: 'Withdraw back to source chain is currently available for CCTP USDC vaults only.'
        }
      });
    }

    if (typeof bridgeBackTxHash !== 'string' || !bridgeBackTxHash.startsWith('0x')) {
      return res.status(400).json({
        error: {
          message: 'Missing Arc bridge-back transaction hash. Please retry after the wallet bridge transaction is confirmed.'
        }
      });
    }

    const existingBridgeTx = await bridgeService.getBridgeTransaction(bridgeBackTxHash);
    if (existingBridgeTx) {
      if (existingBridgeTx.vault_id === vaultId) {
        return res.json({
          vaultId,
          withdrawnAmount: settlement.withdrawnAmount,
          penalty: settlement.penaltyAmount,
          userReceives: existingBridgeTx.amount,
          remainingBalance: settlement.onChainVault.totalAmount,
          status: settlement.onChainVault.status,
          withdrawTxHash,
          bridgeTxHash: existingBridgeTx.tx_hash,
          destinationChain: withdrawDestinationChain,
          bridgeStatus: buildOutboundBridgeStatus(existingBridgeTx),
        });
      }

      return res.status(409).json({
        error: {
          message: 'This Arc bridge-back transaction hash has already been used.'
        }
      });
    }

    const initialBridgeMetadata = {
      type: 'FLEXIBLE_WITHDRAWAL_RETURN',
      withdrawTxHash,
      penalty: settlement.penaltyAmount,
      recipient: userAddress,
      destinationChain: withdrawDestinationChain,
    };

    await bridgeService.createBridgeTransaction(
      bridgeBackTxHash,
      vaultId,
      'OUTBOUND',
      ARC_CHAIN_ID,
      withdrawDestinationChain,
      settlement.userReceives,
      vault.bridge_protocol,
      vault.token_address,
      'PENDING',
      JSON.stringify(initialBridgeMetadata),
      null
    );

    const bridgeStatus = {
      state: 'PENDING_ATTESTATION',
      estimatedTime: '2-5 minutes',
      destinationTxHash: null,
    };

    logger.info('Flexible withdrawal bridged back to source chain', {
      vaultId,
      amount,
      withdrawTxHash,
      bridgeBackTxHash,
      destinationChain: withdrawDestinationChain,
      penalty: settlement.penaltyAmount,
      bridgeState: bridgeStatus.state,
    });

    return res.json({
      vaultId,
      withdrawnAmount: settlement.withdrawnAmount,
      penalty: settlement.penaltyAmount,
      userReceives: settlement.userReceives,
      remainingBalance: settlement.onChainVault.totalAmount,
      status: settlement.onChainVault.status,
      withdrawTxHash,
      bridgeTxHash: bridgeBackTxHash,
      destinationChain: withdrawDestinationChain,
      bridgeStatus,
    });
  } catch (err) {
    const message =
      err.shortMessage ||
      err.reason ||
      err.info?.error?.message ||
      err.message ||
      'Failed to withdraw';

    logger.error('Error withdrawing from vault', {
      error: message,
      stack: err.stack,
      vaultId,
      userAddress,
    });
    res.status(500).json({
      error: {
        message: process.env.NODE_ENV === 'production' ? 'Failed to withdraw' : message,
      }
    });
  }
}));

// Get gas estimate for vault creation
router.post('/gas-estimate', asyncHandler(async (req, res) => {
  const { sourceChain, destinationChain, amount, bridgeProtocol } = req.body;

  try {
    const gasPrices = await gasEstimationService.getGasPrices(sourceChain, destinationChain);
    const bridgeFee = await gasEstimationService.estimateBridgeFee(amount, bridgeProtocol, sourceChain, destinationChain);
    const finalAmount = await gasEstimationService.calculateFinalAmount(amount, 'FIXED', false, bridgeFee.totalFee);

    res.json({
      gasPrices,
      bridgeFee,
      finalAmount
    });
  } catch (err) {
    logger.error('Error estimating gas', { error: err.message });
    res.status(500).json({ error: { message: 'Failed to estimate gas' } });
  }
}));

export default router;
