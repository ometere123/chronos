import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { bridgeService } from '../services/bridgeService.js';
import { bridgeTrackerService } from '../services/bridgeTrackerService.js';
import { cctpRelayService } from '../services/cctpRelayService.js';
import { getAppKitSupportedChains } from '../services/appKitBridgeService.js';
import logger from '../config/logger.js';

const router = express.Router();

// Circle App Kit's live supported-chain registry (read-only, no keys required). Confirms
// Arc Testnet's real CCTP config as returned by Circle's SDK - see appKitBridgeService.js.
router.get('/appkit/supported-chains', asyncHandler(async (req, res) => {
  try {
    const chains = await getAppKitSupportedChains();
    res.json({ chains });
  } catch (err) {
    logger.error('Error fetching App Kit supported chains', { error: err.message });
    res.status(502).json({ error: { message: 'Failed to fetch App Kit supported chains' } });
  }
}));

// Get bridge transaction status
router.get('/status/:txHash', asyncHandler(async (req, res) => {
  const { txHash } = req.params;

  try {
    const transaction = await bridgeService.getBridgeTransaction(txHash);
    if (!transaction) {
      return res.status(404).json({ error: { message: 'Transaction not found' } });
    }

    res.json(transaction);
  } catch (err) {
    logger.error('Error fetching bridge status', { error: err.message });
    res.status(500).json({ error: { message: 'Failed to fetch bridge status' } });
  }
}));

// Quote CCTP fee for fast-finality burns
router.get('/cctp-fee', asyncHandler(async (req, res) => {
  const sourceChain = Number(req.query.sourceChain);
  const destinationChain = Number(req.query.destinationChain);
  const amount = String(req.query.amount || '');
  const finalityThreshold = Number(req.query.finalityThreshold || 1000);

  if (!sourceChain || !destinationChain || !amount || Number(amount) <= 0) {
    return res.status(400).json({
      error: {
        message: 'sourceChain, destinationChain, and amount are required for CCTP fee quotes.',
      },
    });
  }

  try {
    const quote = await cctpRelayService.getTransferFee({
      sourceChain,
      destinationChain,
      amount,
      finalityThreshold,
    });

    res.json(quote);
  } catch (err) {
    logger.warn('CCTP fee quote failed; frontend can fall back to standard transfer', {
      error: err.message,
      sourceChain,
      destinationChain,
      amount,
    });
    res.status(502).json({
      error: {
        message: err.message || 'Failed to quote CCTP fee.',
      },
    });
  }
}));

// Get vault bridge transactions
router.get('/vault/:vaultId', asyncHandler(async (req, res) => {
  const { vaultId } = req.params;

  try {
    const transactions = await bridgeService.getVaultBridgeTransactions(vaultId);
    res.json(transactions);
  } catch (err) {
    logger.error('Error fetching vault bridge transactions', { error: err.message });
    res.status(500).json({ error: { message: 'Failed to fetch transactions' } });
  }
}));

// Retry failed bridge
router.post('/retry/:vaultId', authMiddleware, asyncHandler(async (req, res) => {
  const { vaultId } = req.params;

  try {
    const transaction = await bridgeTrackerService.retryFailedBridge(vaultId);

    logger.info('Bridge retry initiated', { vaultId });

    res.json({
      vaultId,
      txHash: transaction.tx_hash,
      status: 'PENDING',
      message: 'Retry initiated'
    });
  } catch (err) {
    logger.error('Error retrying bridge', { error: err.message });
    res.status(500).json({ error: { message: err.message || 'Failed to retry bridge' } });
  }
}));

// Submit CCTP attestation
router.post('/cctp-attestation', authMiddleware, asyncHandler(async (req, res) => {
  const { txHash, attestationData } = req.body;

  if (!txHash || !attestationData) {
    return res.status(400).json({ error: { message: 'Missing txHash or attestationData' } });
  }

  try {
    const result = await bridgeTrackerService.submitCCTPAttestation(txHash, attestationData);

    logger.info('CCTP attestation submitted', { txHash });

    res.json(result);
  } catch (err) {
    logger.error('Error submitting attestation', { error: err.message });
    res.status(500).json({ error: { message: err.message || 'Failed to submit attestation' } });
  }
}));

// Get pending bridges
router.get('/pending/list', asyncHandler(async (req, res) => {
  try {
    const pendingBridges = await bridgeService.getPendingBridgeTransactions();

    res.json({
      count: pendingBridges.length,
      transactions: pendingBridges
    });
  } catch (err) {
    logger.error('Error fetching pending bridges', { error: err.message });
    res.status(500).json({ error: { message: 'Failed to fetch pending bridges' } });
  }
}));

// Get failed bridges
router.get('/failed/list', asyncHandler(async (req, res) => {
  try {
    const failedBridges = await bridgeService.getFailedBridgeTransactions();

    res.json({
      count: failedBridges.length,
      transactions: failedBridges
    });
  } catch (err) {
    logger.error('Error fetching failed bridges', { error: err.message });
    res.status(500).json({ error: { message: 'Failed to fetch failed bridges' } });
  }
}));

export default router;
