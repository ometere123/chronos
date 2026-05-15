import { pool } from '../config/database.js';
import logger from '../config/logger.js';

export const bridgeService = {
  // Create bridge transaction
  async createBridgeTransaction(
    txHash,
    vaultId,
    direction,
    fromChain,
    toChain,
    amount,
    bridgeProtocol,
    tokenAddress,
    status = 'PENDING',
    attestationData = null,
    completedAt = null
  ) {
    try {
      const result = await pool.query(
        `INSERT INTO bridge_transactions (tx_hash, vault_id, direction, from_chain, to_chain, amount, bridge_protocol, token_address, status, attestation_data, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [txHash, vaultId, direction, fromChain, toChain, amount, bridgeProtocol, tokenAddress, status, attestationData, completedAt]
      );
      return result.rows[0];
    } catch (err) {
      logger.error('Error creating bridge transaction', { error: err.message, txHash });
      throw err;
    }
  },

  // Get bridge transaction
  async getBridgeTransaction(txHash) {
    try {
      const result = await pool.query('SELECT * FROM bridge_transactions WHERE tx_hash = $1', [txHash]);
      return result.rows[0] || null;
    } catch (err) {
      logger.error('Error fetching bridge transaction', { error: err.message, txHash });
      throw err;
    }
  },

  // Get bridge transactions for vault
  async getVaultBridgeTransactions(vaultId) {
    try {
      const result = await pool.query(
        'SELECT * FROM bridge_transactions WHERE vault_id = $1 ORDER BY created_at DESC',
        [vaultId]
      );
      return result.rows;
    } catch (err) {
      logger.error('Error fetching vault bridge transactions', { error: err.message, vaultId });
      throw err;
    }
  },

  // Update bridge transaction status
  async updateBridgeStatus(txHash, status, attestationData = null, completedAt = null) {
    try {
      const result = await pool.query(
        `UPDATE bridge_transactions
         SET status = $1, attestation_data = $2, completed_at = COALESCE($3, completed_at)
         WHERE tx_hash = $4
         RETURNING *`,
        [status, attestationData, completedAt, txHash]
      );
      return result.rows[0];
    } catch (err) {
      logger.error('Error updating bridge status', { error: err.message, txHash });
      throw err;
    }
  },

  // Increment retry count
  async incrementRetryCount(txHash) {
    try {
      const result = await pool.query(
        'UPDATE bridge_transactions SET retry_count = LEAST(retry_count + 1, 10) WHERE tx_hash = $1 RETURNING *',
        [txHash]
      );
      return result.rows[0];
    } catch (err) {
      logger.error('Error incrementing retry count', { error: err.message, txHash });
      throw err;
    }
  },

  // Get pending bridge transactions
  async getPendingBridgeTransactions() {
    try {
      const result = await pool.query(
        `SELECT *
         FROM bridge_transactions
         WHERE retry_count < 10
           AND (
             status = 'PENDING'
             OR (
               bridge_protocol = 'CCTP'
               AND direction = 'INBOUND'
               AND status = 'COMPLETE'
               AND (attestation_data IS NULL OR attestation_data NOT LIKE '%"destinationMintTxHash":"0x%')
               AND (attestation_data IS NULL OR attestation_data NOT LIKE '%"relayState":"COMPLETE"%')
               AND (attestation_data IS NULL OR attestation_data NOT LIKE '%RECIPIENT_MISMATCH%')
             )
             OR (
               bridge_protocol = 'CCTP'
               AND direction = 'INBOUND'
               AND status = 'FAILED'
               AND attestation_data LIKE '%RECIPIENT_MISMATCH%'
               AND attestation_data LIKE '%"actualMintRecipient":null%'
             )
           )
         ORDER BY created_at ASC`,
        []
      );
      return result.rows;
    } catch (err) {
      logger.error('Error fetching pending bridge transactions', { error: err.message });
      throw err;
    }
  },

  // Get failed bridge transactions
  async getFailedBridgeTransactions() {
    try {
      const result = await pool.query(
        'SELECT * FROM bridge_transactions WHERE status = $1 ORDER BY created_at DESC',
        ['FAILED']
      );
      return result.rows;
    } catch (err) {
      logger.error('Error fetching failed bridge transactions', { error: err.message });
      throw err;
    }
  },

  // Check if attestation is already processed
  async hasAttestation(txHash) {
    try {
      const result = await pool.query(
        'SELECT attestation_data FROM bridge_transactions WHERE tx_hash = $1',
        [txHash]
      );
      return result.rows[0] && result.rows[0].attestation_data !== null;
    } catch (err) {
      logger.error('Error checking attestation', { error: err.message, txHash });
      throw err;
    }
  }
};
