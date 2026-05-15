import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { vaultService } from '../services/vaultService.js';
import { bridgeService } from '../services/bridgeService.js';
import logger from '../config/logger.js';

const router = express.Router();

// Get user's vaults and transactions
router.get('/:userAddress', asyncHandler(async (req, res) => {
  const userAddress = req.params.userAddress.toLowerCase();

  try {
    // Get all user vaults
    const vaults = await vaultService.getUserVaults(userAddress);

    // Get bridge transactions for all vaults
    const allTransactions = [];
    for (const vault of vaults) {
      const transactions = await bridgeService.getVaultBridgeTransactions(vault.vault_id);
      allTransactions.push(...transactions);
    }

    // Calculate stats
    const stats = await vaultService.getVaultStats();

    res.json({
      userAddress,
      vaults,
      transactions: allTransactions,
      vaultCount: vaults.length,
      transactionCount: allTransactions.length,
      stats: {
        totalVaults: stats.total_vaults,
        totalUsers: stats.total_users,
        activeAmount: stats.active_amount,
        claimedAmount: stats.claimed_amount
      }
    });
  } catch (err) {
    logger.error('Error fetching user data', { error: err.message });
    res.status(500).json({ error: { message: 'Failed to fetch user data' } });
  }
}));

export default router;
