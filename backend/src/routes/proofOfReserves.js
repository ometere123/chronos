import express from 'express';
import { ethers } from 'ethers';
import { asyncHandler } from '../middleware/errorHandler.js';
import { proofOfReservesService } from '../services/proofOfReservesService.js';
import { contractAddresses } from '../config/contracts.js';
import logger from '../config/logger.js';

const router = express.Router();

const PROOF_OF_RESERVES_LIVE_ABI = [
  'function verifyLiveReserves() view returns (uint256 usdcBalance, uint256 activeLocked, uint256 activeVaultCount, bool fullyReserved)',
];

const USDC_DECIMALS = 6;

// Live, fully on-chain proof-of-reserves check - bypasses the database and any cached/aggregated
// stats entirely. Calls ProofOfReserves.verifyLiveReserves() directly, which itself recomputes the
// sum of active vault balances straight from TimeLockVault storage (not VaultFactory counters).
// Intended to be safe to call live against real chain state during a demo.
router.get('/verify', asyncHandler(async (req, res) => {
  const { arcRpcUrl, proofOfReserves, timeLockVault, usdc } = contractAddresses;

  if (!arcRpcUrl || !proofOfReserves || !timeLockVault || !usdc) {
    return res.status(503).json({
      error: {
        message: 'On-chain proof-of-reserves is not configured (missing RPC URL or contract addresses).',
      },
    });
  }

  try {
    const provider = new ethers.JsonRpcProvider(arcRpcUrl);
    const contract = new ethers.Contract(proofOfReserves, PROOF_OF_RESERVES_LIVE_ABI, provider);

    const [usdcBalance, activeLocked, activeVaultCount, fullyReserved] =
      await contract.verifyLiveReserves();

    res.json({
      source: 'on-chain-live',
      contracts: {
        proofOfReserves,
        timeLockVault,
        usdc,
      },
      usdcBalanceRaw: usdcBalance.toString(),
      activeLockedRaw: activeLocked.toString(),
      usdcBalance: ethers.formatUnits(usdcBalance, USDC_DECIMALS),
      activeLocked: ethers.formatUnits(activeLocked, USDC_DECIMALS),
      activeVaultCount: Number(activeVaultCount),
      fullyReserved,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Error verifying live on-chain proof of reserves', { error: err.message });
    res.status(502).json({ error: { message: 'Failed to verify live on-chain reserves', detail: err.message } });
  }
}));

// Get current proof of reserves
router.get('/', asyncHandler(async (req, res) => {
  try {
    const proofOfReserves = await proofOfReservesService.getProofOfReserves();

    // Save to history
    await proofOfReservesService.saveProofOfReserves(proofOfReserves);

    logger.info('Proof of reserves generated', {
      totalLocked: proofOfReserves.totalLocked,
      totalVaults: proofOfReserves.totalVaults
    });

    res.json(proofOfReserves);
  } catch (err) {
    logger.error('Error generating proof of reserves', { error: err.message });
    res.status(500).json({ error: { message: 'Failed to generate proof of reserves' } });
  }
}));

// Get proof of reserves history
router.get('/history/:limit?', asyncHandler(async (req, res) => {
  const limit = parseInt(req.params.limit) || 100;

  try {
    const history = await proofOfReservesService.getProofOfReservesHistory(limit);

    res.json({
      count: history.length,
      history
    });
  } catch (err) {
    logger.error('Error fetching proof of reserves history', { error: err.message });
    res.status(500).json({ error: { message: 'Failed to fetch history' } });
  }
}));

export default router;
