import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getAgentSmartAccountAddress } from '../services/agentSmartAccountService.js';
import { runAgentPass, isAgentConfigured, isAgentKeeperRunning, findEligibleDelegatedVaults } from '../services/vaultAgentService.js';
import logger from '../config/logger.js';

const router = express.Router();

// Keeper status + eligible-vault visibility, useful for confirming the agent will actually pick
// up a delegated vault before waiting on the cron tick.
router.get('/status', asyncHandler(async (req, res) => {
  const configured = isAgentConfigured();
  const eligible = configured ? await findEligibleDelegatedVaults().catch(() => []) : [];
  res.json({
    configured,
    keeperRunning: isAgentKeeperRunning(),
    eligibleVaultCount: eligible.length,
    eligibleVaultIds: eligible.map((v) => v.vaultId),
  });
}));

// Manually trigger one agent pass immediately, instead of waiting for the next cron tick.
// Intended for testing/demo, not something a normal user should be able to hit - it doesn't take
// any vault-specific input, it just runs the same pass the keeper runs on its own schedule.
router.post('/run', asyncHandler(async (req, res) => {
  try {
    const results = await runAgentPass();
    res.json({ results });
  } catch (err) {
    logger.error('Error running manual agent pass', { error: err.message });
    res.status(500).json({ error: { message: 'Failed to run agent pass' } });
  }
}));

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
