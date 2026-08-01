import { pool } from '../config/database.js';
import logger from '../config/logger.js';

export const vaultService = {
  // Create new vault
  async createVault(
    vaultId,
    owner,
    totalAmount,
    createdAt,
    unlockAt,
    sourceChain,
    destinationChain,
    bridgeProtocol,
    tokenAddress,
    vaultType,
    createdOnChainTx = null
  ) {
    try {
      const result = await pool.query(
        `INSERT INTO vaults (vault_id, owner_address, total_amount, created_at, unlock_at, source_chain, destination_chain, bridge_protocol, token_address, vault_type, status, created_on_chain_tx)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [vaultId, owner, totalAmount, createdAt, unlockAt, sourceChain, destinationChain, bridgeProtocol, tokenAddress, vaultType, 'ACTIVE', createdOnChainTx]
      );
      return result.rows[0];
    } catch (err) {
      logger.error('Error creating vault', { error: err.message, vaultId });
      throw err;
    }
  },

  // Create a new "smart" split vault (savings/yield/reserve sub-balances on one vault record)
  async createSplitVault(
    vaultId,
    owner,
    totalAmount,
    createdAt,
    unlockAt,
    sourceChain,
    destinationChain,
    bridgeProtocol,
    tokenAddress,
    vaultType,
    splitConfig,
    createdOnChainTx = null
  ) {
    const { savingsBps, yieldBps, reserveBps } = splitConfig || {};
    if ((savingsBps || 0) + (yieldBps || 0) + (reserveBps || 0) !== 10000) {
      throw new Error('Split bps must sum to 10000');
    }

    try {
      const result = await pool.query(
        `INSERT INTO vaults (
           vault_id, owner_address, total_amount, created_at, unlock_at, source_chain,
           destination_chain, bridge_protocol, token_address, vault_type, status,
           created_on_chain_tx, is_split, savings_bps, yield_bps, reserve_bps
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, TRUE, $13, $14, $15)
         RETURNING *`,
        [
          vaultId, owner, totalAmount, createdAt, unlockAt, sourceChain, destinationChain,
          bridgeProtocol, tokenAddress, vaultType, 'ACTIVE', createdOnChainTx,
          savingsBps, yieldBps, reserveBps,
        ]
      );
      return result.rows[0];
    } catch (err) {
      logger.error('Error creating split vault', { error: err.message, vaultId });
      throw err;
    }
  },

  // Mark one bucket (savings|yield|reserve) of a split vault as claimed
  async markBucketClaimed(vaultId, bucket) {
    const columnByBucket = {
      savings: 'savings_claimed',
      yield: 'yield_claimed',
      reserve: 'reserve_claimed',
    };
    const column = columnByBucket[bucket];
    if (!column) {
      throw new Error(`Invalid bucket: ${bucket}`);
    }

    try {
      const result = await pool.query(
        `UPDATE vaults SET ${column} = TRUE WHERE vault_id = $1 RETURNING *`,
        [vaultId]
      );
      const vault = result.rows[0];

      if (vault && vault.savings_claimed && vault.yield_claimed && vault.reserve_claimed) {
        await pool.query(
          `UPDATE vaults SET status = 'CLAIMED', claimed_at = COALESCE(claimed_at, NOW()) WHERE vault_id = $1`,
          [vaultId]
        );
      }

      return vault;
    } catch (err) {
      logger.error('Error marking bucket claimed', { error: err.message, vaultId, bucket });
      throw err;
    }
  },

  // Get split config + bucket amounts/claim status for a vault
  getSplitAllocation(vault, usdcDecimalsAmount = null) {
    if (!vault || !vault.is_split) {
      return null;
    }

    const total = usdcDecimalsAmount !== null ? usdcDecimalsAmount : parseFloat(vault.total_amount);
    const savingsAmount = (total * vault.savings_bps) / 10000;
    const yieldAmount = (total * vault.yield_bps) / 10000;
    const reserveAmount = total - savingsAmount - yieldAmount;

    return {
      savingsBps: vault.savings_bps,
      yieldBps: vault.yield_bps,
      reserveBps: vault.reserve_bps,
      buckets: {
        savings: { amount: savingsAmount, claimed: vault.savings_claimed },
        yield: { amount: yieldAmount, claimed: vault.yield_claimed },
        reserve: { amount: reserveAmount, claimed: vault.reserve_claimed },
      },
    };
  },

  // Get vault by ID
  async getVault(vaultId) {
    try {
      const result = await pool.query('SELECT * FROM vaults WHERE vault_id = $1', [vaultId]);
      return result.rows[0] || null;
    } catch (err) {
      logger.error('Error fetching vault', { error: err.message, vaultId });
      throw err;
    }
  },

  // Get user's vaults
  async getUserVaults(userAddress) {
    try {
      const result = await pool.query(
        'SELECT * FROM vaults WHERE owner_address = $1 ORDER BY created_at DESC',
        [userAddress]
      );
      return result.rows;
    } catch (err) {
      logger.error('Error fetching user vaults', { error: err.message, userAddress });
      throw err;
    }
  },

  // Get deposits for vault
  async getVaultDeposits(vaultId) {
    try {
      const result = await pool.query(
        'SELECT * FROM vault_deposits WHERE vault_id = $1 ORDER BY deposited_at DESC',
        [vaultId]
      );
      return result.rows;
    } catch (err) {
      logger.error('Error fetching vault deposits', { error: err.message, vaultId });
      throw err;
    }
  },

  // Add deposit to vault
  async addDeposit(vaultId, amount, sourceChain, bridgeProtocol, bridgeTxHash) {
    try {
      // Add deposit record
      const depositResult = await pool.query(
        `INSERT INTO vault_deposits (vault_id, amount, deposited_at, source_chain, bridge_protocol, bridge_tx_hash)
         VALUES ($1, $2, NOW(), $3, $4, $5)
         RETURNING *`,
        [vaultId, amount, sourceChain, bridgeProtocol, bridgeTxHash]
      );

      // Update vault total amount
      await pool.query(
        'UPDATE vaults SET total_amount = total_amount + $1 WHERE vault_id = $2',
        [amount, vaultId]
      );

      return depositResult.rows[0];
    } catch (err) {
      logger.error('Error adding deposit to vault', { error: err.message, vaultId });
      throw err;
    }
  },

  async syncVaultState(vaultId, totalAmount, status = null) {
    try {
      const result = await pool.query(
        `UPDATE vaults
         SET total_amount = $1,
             status = COALESCE($2, status),
             claimed_at = CASE WHEN COALESCE($2, status) = 'CLAIMED' THEN COALESCE(claimed_at, NOW()) ELSE claimed_at END
         WHERE vault_id = $3
         RETURNING *`,
        [totalAmount, status, vaultId]
      );
      return result.rows[0];
    } catch (err) {
      logger.error('Error syncing vault state', { error: err.message, vaultId, totalAmount, status });
      throw err;
    }
  },

  // Update vault status
  async updateVaultStatus(vaultId, status, claimedTxHash = null) {
    try {
      const query = claimedTxHash
        ? 'UPDATE vaults SET status = $1, claimed_tx_hash = $2, claimed_at = NOW() WHERE vault_id = $3 RETURNING *'
        : 'UPDATE vaults SET status = $1 WHERE vault_id = $2 RETURNING *';

      const params = claimedTxHash ? [status, claimedTxHash, vaultId] : [status, vaultId];
      const result = await pool.query(query, params);
      return result.rows[0];
    } catch (err) {
      logger.error('Error updating vault status', { error: err.message, vaultId, status });
      throw err;
    }
  },

  // Get total locked
  async getTotalLocked() {
    try {
      const result = await pool.query(
        "SELECT COALESCE(SUM(total_amount), 0) as total FROM vaults WHERE status IN ('ACTIVE', 'MATURE')"
      );
      return parseFloat(result.rows[0].total);
    } catch (err) {
      logger.error('Error calculating total locked', { error: err.message });
      throw err;
    }
  },

  // Get locked by chain
  async getLockedByChain(chainId) {
    try {
      const result = await pool.query(
        "SELECT COALESCE(SUM(total_amount), 0) as total FROM vaults WHERE source_chain = $1 AND status IN ('ACTIVE', 'MATURE')",
        [chainId]
      );
      return parseFloat(result.rows[0].total);
    } catch (err) {
      logger.error('Error calculating locked by chain', { error: err.message, chainId });
      throw err;
    }
  },

  // Get locked by token
  async getLockedByToken(tokenAddress) {
    try {
      const result = await pool.query(
        "SELECT COALESCE(SUM(total_amount), 0) as total FROM vaults WHERE token_address = $1 AND status IN ('ACTIVE', 'MATURE')",
        [tokenAddress]
      );
      return parseFloat(result.rows[0].total);
    } catch (err) {
      logger.error('Error calculating locked by token', { error: err.message, tokenAddress });
      throw err;
    }
  },

  // Get vault statistics
  async getVaultStats() {
    try {
      const result = await pool.query(`
        SELECT
          COUNT(*) as total_vaults,
          COUNT(DISTINCT owner_address) as total_users,
          COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN total_amount ELSE 0 END), 0) as active_amount,
          COALESCE(SUM(CASE WHEN status = 'CLAIMED' THEN total_amount ELSE 0 END), 0) as claimed_amount
        FROM vaults
      `);
      return result.rows[0];
    } catch (err) {
      logger.error('Error fetching vault stats', { error: err.message });
      throw err;
    }
  },

  // Withdraw from flexible vault
  async withdrawFlexible(vaultId, amount) {
    try {
      const result = await pool.query(
        'UPDATE vaults SET total_amount = total_amount - $1 WHERE vault_id = $2 RETURNING *',
        [amount, vaultId]
      );
      return result.rows[0];
    } catch (err) {
      logger.error('Error withdrawing from vault', { error: err.message, vaultId });
      throw err;
    }
  }
};
