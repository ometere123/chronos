import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { scheduledPaymentService } from '../services/scheduledPaymentService.js';
import logger from '../config/logger.js';

const router = express.Router();

// ScheduledPayment.createSchedule() is onlyOwner on-chain (see contracts/arc/ScheduledPayment.sol)
// - the contract owner is this backend's relayer wallet (PRIVATE_KEY), NOT anything a connected
// user wallet can call. There is no user-wallet-authorized path to create a schedule, so
// creation here is gated behind a separate admin API key rather than the normal user JWT
// (authMiddleware), which would otherwise let any logged-in user spend the backend's on-chain
// authority. Set SCHEDULED_PAYMENTS_ADMIN_KEY to enable creation/cancellation from this route;
// without it, those endpoints are disabled and only the read-only list/detail views work.
function requireAdminKey(req, res, next) {
  const configuredKey = process.env.SCHEDULED_PAYMENTS_ADMIN_KEY;
  if (!configuredKey) {
    return res.status(503).json({
      error: {
        message: 'Schedule creation is not enabled on this backend. Set SCHEDULED_PAYMENTS_ADMIN_KEY to allow admin-triggered schedule creation.',
      },
    });
  }

  const providedKey = req.headers['x-admin-key'];
  if (providedKey !== configuredKey) {
    return res.status(403).json({ error: { message: 'Invalid or missing admin key.' } });
  }

  next();
}

// List all payment schedules with per-slot execution/due status
router.get('/', asyncHandler(async (req, res) => {
  try {
    const schedules = await scheduledPaymentService.listSchedules();
    res.json({
      schedules,
      keeperRunning: scheduledPaymentService.isRunning,
      count: schedules.length,
    });
  } catch (err) {
    logger.error('Error listing scheduled payments', { error: err.message });
    res.status(500).json({ error: { message: 'Failed to list scheduled payments' } });
  }
}));

// Get a single schedule by ID
router.get('/:scheduleId', asyncHandler(async (req, res) => {
  const { scheduleId } = req.params;

  try {
    const schedules = await scheduledPaymentService.listSchedules();
    const schedule = schedules.find((s) => String(s.scheduleId) === String(scheduleId));

    if (!schedule) {
      return res.status(404).json({ error: { message: 'Schedule not found' } });
    }

    res.json(schedule);
  } catch (err) {
    logger.error('Error fetching scheduled payment', { error: err.message, scheduleId });
    res.status(500).json({ error: { message: 'Failed to fetch scheduled payment' } });
  }
}));

// Create a new payment schedule. Admin-only (see requireAdminKey comment above) - not reachable
// from a normal connected user wallet, since ScheduledPayment.createSchedule() is onlyOwner
// on-chain and the owner is the backend's relayer key, not any user's wallet.
router.post('/', requireAdminKey, asyncHandler(async (req, res) => {
  const { recipient, amount, minTreasuryBalanceAfter, releaseTimestamps } = req.body;

  if (typeof recipient !== 'string' || !recipient.startsWith('0x')) {
    return res.status(400).json({ error: { message: 'Invalid recipient address' } });
  }
  if (!amount || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: { message: 'Amount must be > 0' } });
  }
  if (!Array.isArray(releaseTimestamps) || releaseTimestamps.length === 0) {
    return res.status(400).json({ error: { message: 'Need at least one release timestamp (unix seconds)' } });
  }

  try {
    const result = await scheduledPaymentService.createSchedule({
      recipient,
      amount,
      minTreasuryBalanceAfter: minTreasuryBalanceAfter || 0,
      releaseTimestamps,
    });

    logger.info('Scheduled payment created via admin route', { ...result, recipient });
    res.status(201).json(result);
  } catch (err) {
    logger.error('Error creating scheduled payment', { error: err.message });
    res.status(500).json({
      error: { message: process.env.NODE_ENV === 'production' ? 'Failed to create schedule' : err.message },
    });
  }
}));

export default router;
