import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getAgentSmartAccountAddress } from '../services/agentSmartAccountService.js';
import logger from '../config/logger.js';

const router = express.Router();

// The address vault owners should pass to TimeLockVault.setVaultDelegate() to authorize the
// autonomous vault-maintenance agent (Items 14-16) to claim on their behalf. This is the
// agent's ERC-4337 smart account (gas-sponsored claim path), not the Circle Developer-Controlled
// Wallet - see backend/src/services/vaultAgentService.js for why the two identities are kept
// separate.
router.get('/address', asyncHandler(async (req, res) => {
  try {
    const address = await getAgentSmartAccountAddress();
    res.json({ address });
  } catch (err) {
    logger.error('Error resolving agent smart account address', { error: err.message });
    res.status(503).json({
      error: {
        message: process.env.NODE_ENV === 'production'
          ? 'Agent address is not available'
          : `Agent address is not available: ${err.message}`,
      },
    });
  }
}));

export default router;
