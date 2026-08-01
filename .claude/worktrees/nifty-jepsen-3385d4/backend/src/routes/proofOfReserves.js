import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { proofOfReservesService } from '../services/proofOfReservesService.js';
import logger from '../config/logger.js';

const router = express.Router();

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
