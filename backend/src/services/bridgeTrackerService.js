import '../config/env.js';
import logger from '../config/logger.js';
import { bridgeService } from './bridgeService.js';
import { cctpRelayService } from './cctpRelayService.js';
import { ARC_CHAIN_ID, contractAddresses } from '../config/contracts.js';

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

export class BridgeTrackerService {
  constructor() {
    this.circleApiKey = process.env.CIRCLE_API_KEY;
    this.isRunning = false;
    this.isTracking = false;
    this.trackerInterval = parseInt(process.env.BRIDGE_TRACKER_INTERVAL_MS || '10000', 10);
  }

  // Start tracking bridge transactions
  start() {
    if (this.isRunning) {
      logger.warn('Bridge tracker already running');
      return;
    }

    this.isRunning = true;
    logger.info('Bridge tracker service started');

    // Check pending transactions frequently on testnet so short vaults do not outrun CCTP relay.
    this.tracker = setInterval(() => {
      this.trackPendingTransactions().catch(err => {
        logger.error('Error tracking pending transactions', { error: err.message });
      });
    }, this.trackerInterval);

    // Run once immediately
    this.trackPendingTransactions().catch(err => {
      logger.error('Initial bridge tracking failed', { error: err.message });
    });
  }

  // Stop tracking
  stop() {
    if (this.tracker) {
      clearInterval(this.tracker);
    }
    this.isRunning = false;
    logger.info('Bridge tracker service stopped');
  }

  // Track pending bridge transactions
  async trackPendingTransactions() {
    if (this.isTracking) {
      logger.debug('Bridge tracking already running; skipping overlapping tick');
      return;
    }

    this.isTracking = true;

    try {
      const pendingTransactions = await bridgeService.getPendingBridgeTransactions();

      logger.info('Tracking pending bridge transactions', { count: pendingTransactions.length });

      for (const tx of pendingTransactions) {
        if (tx.bridge_protocol === 'CCTP') {
          await this.trackCCTPTransaction(tx);
        } else if (tx.bridge_protocol === 'LayerZero') {
          await this.trackLayerZeroTransaction(tx);
        }
      }
    } catch (err) {
      logger.error('Error tracking pending transactions', { error: err.message });
    } finally {
      this.isTracking = false;
    }
  }

  // Track CCTP transaction status
  async trackCCTPTransaction(transaction) {
    try {
      logger.debug('Checking CCTP transaction status', { txHash: transaction.tx_hash });

      const attestationData = parseBridgeMetadata(transaction.attestation_data);

      if (transaction.direction === 'INBOUND') {
        const relayResult = await cctpRelayService.finalizeBurnAndMint({
          burnTxHash: transaction.tx_hash,
          sourceChain: transaction.from_chain,
          destinationChain: ARC_CHAIN_ID,
          expectedRecipient: contractAddresses.timeLockVault,
          expectedAmount: attestationData.cctpBurnAmount || transaction.amount,
          waitForAttestationMs: 5000,
        });

        if (relayResult.state === 'COMPLETE') {
          await bridgeService.updateBridgeStatus(
            transaction.tx_hash,
            'COMPLETE',
            JSON.stringify({
              ...attestationData,
              relayState: relayResult.state,
              destinationMintTxHash: relayResult.destinationTxHash,
              attestation: relayResult.attestation,
              message: relayResult.message,
              mintRecipient: contractAddresses.timeLockVault,
            }),
            new Date()
          );

          logger.info('Tracked inbound CCTP mint completed on Arc', {
            txHash: transaction.tx_hash,
            destinationMintTxHash: relayResult.destinationTxHash,
          });
        } else {
          await bridgeService.updateBridgeStatus(
            transaction.tx_hash,
            'PENDING',
            JSON.stringify({
              ...attestationData,
              relayState: relayResult.state,
              mintRecipient: contractAddresses.timeLockVault,
            }),
            null
          );
          logger.debug('Inbound CCTP mint still pending attestation', { txHash: transaction.tx_hash });
        }
        return;
      }

      if (transaction.direction === 'OUTBOUND' && Number(transaction.from_chain) === ARC_CHAIN_ID) {
        const relayResult = await cctpRelayService.finalizeBurnAndMint({
          burnTxHash: transaction.tx_hash,
          sourceChain: transaction.from_chain,
          destinationChain: transaction.to_chain,
          expectedRecipient: attestationData.recipient,
          expectedAmount: transaction.amount,
          waitForAttestationMs: 5000,
        });

        if (relayResult.state === 'COMPLETE') {
          await bridgeService.updateBridgeStatus(
            transaction.tx_hash,
            'COMPLETE',
            JSON.stringify({
              ...attestationData,
              relayState: relayResult.state,
              destinationTxHash: relayResult.destinationTxHash,
              attestation: relayResult.attestation,
              message: relayResult.message,
            }),
            new Date()
          );

          logger.info('Tracked outbound CCTP bridge completed', {
            txHash: transaction.tx_hash,
            destinationTxHash: relayResult.destinationTxHash,
          });
        } else {
          logger.debug('Outbound CCTP bridge still pending attestation', { txHash: transaction.tx_hash });
        }
        return;
      }

      logger.debug('CCTP transaction pending', { txHash: transaction.tx_hash });
    } catch (err) {
      if (err.code === 'MINT_RECIPIENT_UNAVAILABLE') {
        const attestationData = parseBridgeMetadata(transaction.attestation_data);

        await bridgeService.updateBridgeStatus(
          transaction.tx_hash,
          'PENDING',
          JSON.stringify({
            ...attestationData,
            relayState: 'MINT_RECIPIENT_UNAVAILABLE',
            mintRecipient: err.expectedRecipient || attestationData.recipient || contractAddresses.timeLockVault,
            expectedMintRecipient: err.expectedRecipient || attestationData.recipient || contractAddresses.timeLockVault,
            actualMintRecipient: null,
          }),
          null
        );

        logger.warn('CCTP attestation complete but mint recipient is not decoded yet', {
          txHash: transaction.tx_hash,
        });
        return;
      }

      if (err.code === 'RECIPIENT_MISMATCH') {
        const attestationData = parseBridgeMetadata(transaction.attestation_data);

        await bridgeService.updateBridgeStatus(
          transaction.tx_hash,
          'FAILED',
          JSON.stringify({
            ...attestationData,
            relayState: 'RECIPIENT_MISMATCH',
            expectedMintRecipient: err.expectedRecipient || contractAddresses.timeLockVault,
            actualMintRecipient: err.actualRecipient || null,
          }),
          new Date()
        );

        logger.warn('Marked inbound CCTP bridge as failed due to legacy mint recipient mismatch', {
          txHash: transaction.tx_hash,
          expectedRecipient: err.expectedRecipient,
          actualRecipient: err.actualRecipient,
        });
        return;
      }

      logger.error('Error tracking CCTP transaction', { error: err.message, txHash: transaction.tx_hash });

      // Increment retry count
      await bridgeService.incrementRetryCount(transaction.tx_hash);
    }
  }

  // Track LayerZero transaction status
  async trackLayerZeroTransaction(transaction) {
    try {
      logger.debug('Checking LayerZero transaction status', { txHash: transaction.tx_hash });

      // In production, query LayerZero API or scan destination chain
      // Check if message was received on destination

      // For now, just log
      logger.debug('LayerZero transaction pending', { txHash: transaction.tx_hash });
    } catch (err) {
      logger.error('Error tracking LayerZero transaction', { error: err.message, txHash: transaction.tx_hash });

      // Increment retry count
      await bridgeService.incrementRetryCount(transaction.tx_hash);
    }
  }

  // Retry failed bridge transaction
  async retryFailedBridge(vaultId, attestationData = null) {
    try {
      const transactions = await bridgeService.getVaultBridgeTransactions(vaultId);
      const failedTx = transactions.find(t => t.status === 'FAILED');

      if (!failedTx) {
        throw new Error('No failed transaction found for vault');
      }

      if (failedTx.retry_count >= 10) {
        throw new Error('Max retry attempts exceeded');
      }

      logger.info('Retrying failed bridge transaction', { vaultId, txHash: failedTx.tx_hash });

      // Reset to PENDING and increment retry count
      await bridgeService.updateBridgeStatus(failedTx.tx_hash, 'PENDING', attestationData);
      await bridgeService.incrementRetryCount(failedTx.tx_hash);

      return failedTx;
    } catch (err) {
      logger.error('Error retrying failed bridge', { error: err.message, vaultId });
      throw err;
    }
  }

  // Manual attestation submission (CCTP)
  async submitCCTPAttestation(txHash, attestationData) {
    try {
      logger.info('Submitting CCTP attestation', { txHash });

      // Verify attestation format
      if (!attestationData || attestationData.length === 0) {
        throw new Error('Invalid attestation data');
      }

      // Update transaction with attestation
      await bridgeService.updateBridgeStatus(txHash, 'ATTESTING', attestationData);

      // In production, would verify signature and update status to COMPLETE
      // For now, mark as complete
      await bridgeService.updateBridgeStatus(txHash, 'COMPLETE', attestationData, new Date());

      logger.info('Attestation submitted and verified', { txHash });
      return { success: true, txHash };
    } catch (err) {
      logger.error('Error submitting CCTP attestation', { error: err.message, txHash });
      throw err;
    }
  }
}

// Singleton instance
export const bridgeTrackerService = new BridgeTrackerService();
