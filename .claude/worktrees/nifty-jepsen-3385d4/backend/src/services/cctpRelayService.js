import '../config/env.js';
import axios from 'axios';
import { ethers } from 'ethers';
import logger from '../config/logger.js';
import { ARC_CHAIN_ID, contractAddresses } from '../config/contracts.js';

const IRIS_SANDBOX_BASE_URL = 'https://iris-api-sandbox.circle.com';
const CCTP_V2_MESSAGE_TRANSMITTER =
  process.env.CCTP_MESSAGE_TRANSMITTER ||
  process.env.ARC_CCTP_MESSAGE_TRANSMITTER ||
  contractAddresses.cctpMessageTransmitter;

const MESSAGE_TRANSMITTER_ABI = [
  'function receiveMessage(bytes message, bytes attestation) external',
];

const CHAIN_CONFIGS = {
  [ARC_CHAIN_ID]: {
    chainId: ARC_CHAIN_ID,
    name: 'Arc Testnet',
    rpcUrl: process.env.ARC_TESTNET_RPC || contractAddresses.arcRpcUrl,
    domain: Number(process.env.ARC_CCTP_DOMAIN || 26),
    messageTransmitter: CCTP_V2_MESSAGE_TRANSMITTER,
  },
  84532: {
    chainId: 84532,
    name: 'Base Sepolia',
    rpcUrl: process.env.BASE_SEPOLIA_RPC,
    domain: Number(process.env.BASE_SEPOLIA_CCTP_DOMAIN || 6),
    messageTransmitter: CCTP_V2_MESSAGE_TRANSMITTER,
  },
  421614: {
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC,
    domain: Number(process.env.ARBITRUM_SEPOLIA_CCTP_DOMAIN || 3),
    messageTransmitter: CCTP_V2_MESSAGE_TRANSMITTER,
  },
  11155111: {
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    rpcUrl: process.env.ETHEREUM_SEPOLIA_RPC,
    domain: Number(process.env.ETHEREUM_SEPOLIA_CCTP_DOMAIN || 0),
    messageTransmitter: CCTP_V2_MESSAGE_TRANSMITTER,
  },
  11155420: {
    chainId: 11155420,
    name: 'OP Sepolia',
    rpcUrl: process.env.OP_SEPOLIA_RPC,
    domain: Number(process.env.OP_SEPOLIA_CCTP_DOMAIN || 2),
    messageTransmitter: CCTP_V2_MESSAGE_TRANSMITTER,
  },
};

function normalizeHex(value) {
  return typeof value === 'string' && value.startsWith('0x') ? value : null;
}

function normalizeRecipientAddress(value) {
  const hexValue = normalizeHex(value);
  if (!hexValue) {
    return null;
  }

  try {
    if (hexValue.length === 66) {
      return ethers.getAddress(`0x${hexValue.slice(-40)}`);
    }

    return ethers.getAddress(hexValue);
  } catch {
    return null;
  }
}

function getMessageBody(message, encodedMessage) {
  const body =
    normalizeHex(message?.decodedMessage?.messageBody) ||
    normalizeHex(message?.messageBody);

  if (body && body.length > 2) {
    return body;
  }

  const encoded = normalizeHex(encodedMessage);
  if (!encoded) {
    return null;
  }

  // CCTP V2 header is 148 bytes. Everything after that is the app-specific body.
  const bodyOffset = 2 + (148 * 2);
  if (encoded.length <= bodyOffset) {
    return null;
  }

  return `0x${encoded.slice(bodyOffset)}`;
}

function parseBurnMessageBody(message, encodedMessage) {
  const decodedBody =
    message?.decodedMessage?.decodedMessageBody ||
    message?.decodedMessageBody ||
    {};

  const result = {
    burnToken: decodedBody.burnToken || null,
    mintRecipient: decodedBody.mintRecipient || null,
    amount: decodedBody.amount || null,
    messageSender: decodedBody.messageSender || null,
  };

  const body = getMessageBody(message, encodedMessage);
  if (!body) {
    return result;
  }

  const hex = body.slice(2);
  const readWord = (byteOffset) => {
    const start = byteOffset * 2;
    const end = start + 64;
    return hex.length >= end ? `0x${hex.slice(start, end)}` : null;
  };

  const rawAmount = readWord(68);

  result.burnToken ||= readWord(4);
  result.mintRecipient ||= readWord(36);
  result.amount ||= rawAmount ? BigInt(rawAmount).toString() : null;
  result.messageSender ||= readWord(100);

  return result;
}

function isAlreadyMintedError(error) {
  const message = error?.shortMessage || error?.reason || error?.message || '';

  if (isNonceDriftError(error) || /address .* tx: .* state:/i.test(message)) {
    return false;
  }

  return (
    /message.*already/i.test(message) ||
    /already.*message/i.test(message) ||
    /already.*processed/i.test(message) ||
    /already.*received/i.test(message) ||
    /nonce already used/i.test(message)
  );
}

function isNonceDriftError(error) {
  const message = error?.shortMessage || error?.reason || error?.message || '';
  return (
    /nonce too high/i.test(message) ||
    /nonce too low/i.test(message) ||
    /nonce has already been used/i.test(message) ||
    /invalid nonce/i.test(message) ||
    /account sequence mismatch/i.test(message)
  );
}

function isRetryableRelayError(error) {
  const message = error?.shortMessage || error?.reason || error?.message || '';
  return (
    /txpool is full/i.test(message) ||
    /could not coalesce error/i.test(message) ||
    isNonceDriftError(error)
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateBufferedFeeUnits(amount, minimumFeeBps) {
  const amountUnits = ethers.parseUnits(String(amount), 6);
  const scaledBps = BigInt(Math.ceil(Number(minimumFeeBps || 0) * 100));
  const feeUnits = (amountUnits * scaledBps) / 1_000_000n;

  return ((feeUnits * 120n) / 100n).toString();
}

export class CctpRelayService {
  constructor() {
    this.privateKey = process.env.PRIVATE_KEY;
    this.clientCache = new Map();
    this.relayLocks = new Map();
  }

  getChainConfig(chainId) {
    const config = CHAIN_CONFIGS[Number(chainId)];
    if (!config?.rpcUrl || !config?.messageTransmitter) {
      throw new Error(`CCTP chain config is missing for chain ${chainId}.`);
    }
    return config;
  }

  getWallet(chainId) {
    if (!this.privateKey) {
      throw new Error('PRIVATE_KEY is not configured for CCTP relay execution.');
    }

    const cacheKey = String(chainId);
    if (this.clientCache.has(cacheKey)) {
      return this.clientCache.get(cacheKey);
    }

    const config = this.getChainConfig(chainId);
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const wallet = new ethers.Wallet(this.privateKey, provider);
    const transmitter = new ethers.Contract(
      config.messageTransmitter,
      MESSAGE_TRANSMITTER_ABI,
      wallet
    );

    const entry = { provider, wallet, transmitter, config };
    this.clientCache.set(cacheKey, entry);
    return entry;
  }

  resetWallet(chainId) {
    logger.warn('Resetting CCTP relay signer after nonce/provider drift', {
      destinationChain: Number(chainId),
    });
    this.clientCache.delete(String(chainId));
  }

  async withRelayLock(chainId, task) {
    const cacheKey = String(chainId);
    const previous = this.relayLocks.get(cacheKey) || Promise.resolve();
    const run = previous.catch(() => {}).then(task);
    const stored = run.catch(() => {});

    this.relayLocks.set(cacheKey, stored);

    try {
      return await run;
    } finally {
      if (this.relayLocks.get(cacheKey) === stored) {
        this.relayLocks.delete(cacheKey);
      }
    }
  }

  async sendReceiveMessage(encodedMessage, attestation, destinationChain, burnTxHash) {
    let attempt = 0;
    const maxAttempts = 4;

    while (attempt < maxAttempts) {
      try {
        const destinationClient = this.getWallet(destinationChain);
        const { transmitter } = destinationClient;
        return await transmitter.receiveMessage(encodedMessage, attestation);
      } catch (error) {
        attempt += 1;

        if (isNonceDriftError(error)) {
          this.resetWallet(destinationChain);
        }

        if (!isRetryableRelayError(error) || attempt >= maxAttempts) {
          throw error;
        }

        const waitMs = attempt * 2000;
        logger.warn('Retrying destination-chain CCTP mint submission', {
          burnTxHash,
          destinationChain,
          attempt,
          maxAttempts,
          waitMs,
          error: error.message,
        });
        await sleep(waitMs);
      }
    }
  }

  async fetchMessage(sourceDomain, txHash) {
    const url = `${IRIS_SANDBOX_BASE_URL}/v2/messages/${sourceDomain}`;

    try {
      const response = await axios.get(url, {
        params: { transactionHash: txHash },
        timeout: 15000,
      });

      return response.data?.messages?.[0] || null;
    } catch (error) {
      if (error?.response?.status === 404) {
        return null;
      }

      throw error;
    }
  }

  async getTransferFee({ sourceChain, destinationChain, amount, finalityThreshold = 1000 }) {
    const sourceConfig = this.getChainConfig(sourceChain);
    const destinationConfig = this.getChainConfig(destinationChain);
    const url = `${IRIS_SANDBOX_BASE_URL}/v2/burn/USDC/fees/${sourceConfig.domain}/${destinationConfig.domain}`;

    const response = await axios.get(url, {
      timeout: 15000,
    });

    const fees = Array.isArray(response.data) ? response.data : response.data?.data;
    const fee = fees?.find((item) => Number(item.finalityThreshold) === Number(finalityThreshold)) || fees?.[0];

    if (!fee) {
      throw new Error('Circle did not return a CCTP fee quote for this route.');
    }

    return {
      sourceDomain: sourceConfig.domain,
      destinationDomain: destinationConfig.domain,
      finalityThreshold: Number(fee.finalityThreshold),
      minimumFeeBps: Number(fee.minimumFee || 0),
      maxFee: calculateBufferedFeeUnits(amount, fee.minimumFee || 0),
    };
  }

  async waitForAttestation(sourceDomain, txHash, timeoutMs = 20000, pollMs = 5000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const message = await this.fetchMessage(sourceDomain, txHash);

      if (
        message &&
        message.status === 'complete' &&
        normalizeHex(message.message) &&
        normalizeHex(message.attestation)
      ) {
        return message;
      }

      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    return null;
  }

  async finalizeBurnAndMint({
    burnTxHash,
    sourceChain,
    destinationChain,
    expectedRecipient,
    expectedAmount,
    waitForAttestationMs = 20000,
  }) {
    const sourceConfig = this.getChainConfig(sourceChain);
    const message = await this.waitForAttestation(
      sourceConfig.domain,
      burnTxHash,
      waitForAttestationMs
    );

    if (!message) {
      return {
        state: 'PENDING_ATTESTATION',
      };
    }

    const attestation = normalizeHex(message.attestation);
    const encodedMessage = normalizeHex(message.message);

    if (!attestation || !encodedMessage) {
      return {
        state: 'PENDING_ATTESTATION',
      };
    }

    const decodedBody = parseBurnMessageBody(message, encodedMessage);
    if (expectedRecipient) {
      const mintRecipient = normalizeRecipientAddress(decodedBody.mintRecipient);
      const normalizedExpectedRecipient = ethers.getAddress(expectedRecipient);

      if (!mintRecipient) {
        const pendingError = new Error('Circle attestation is complete, but the mint recipient is not decoded yet.');
        pendingError.code = 'MINT_RECIPIENT_UNAVAILABLE';
        pendingError.expectedRecipient = normalizedExpectedRecipient;
        throw pendingError;
      }

      if (mintRecipient.toLowerCase() !== normalizedExpectedRecipient.toLowerCase()) {
        const mismatchError = new Error('CCTP mint recipient does not match the expected destination address.');
        mismatchError.code = 'RECIPIENT_MISMATCH';
        mismatchError.actualRecipient = mintRecipient;
        mismatchError.expectedRecipient = normalizedExpectedRecipient;
        mismatchError.burnTxHash = burnTxHash;
        throw mismatchError;
      }
    }

    if (expectedAmount) {
      const expectedAmountUnits = ethers.parseUnits(String(expectedAmount), 6).toString();
      if (String(decodedBody.amount || '') !== expectedAmountUnits) {
        throw new Error('CCTP bridge-back amount does not match the claimed vault amount.');
      }
    }

    try {
      const { mintTx } = await this.withRelayLock(destinationChain, async () => {
        const tx = await this.sendReceiveMessage(
          encodedMessage,
          attestation,
          destinationChain,
          burnTxHash
        );
        logger.info('CCTP mint submitted on destination chain', {
          burnTxHash,
          destinationChain,
          mintTxHash: tx.hash,
        });
        const receipt = await tx.wait();

        if (!receipt || receipt.status !== 1) {
          throw new Error('Destination-chain mint transaction reverted.');
        }

        return { mintTx: tx, receipt };
      });

      logger.info('CCTP mint completed on destination chain', {
        burnTxHash,
        destinationChain,
        mintTxHash: mintTx.hash,
      });

      return {
        state: 'COMPLETE',
        destinationTxHash: mintTx.hash,
        attestation,
        message: encodedMessage,
      };
    } catch (error) {
      if (isAlreadyMintedError(error)) {
        logger.warn('CCTP mint may already be completed', {
          burnTxHash,
          destinationChain,
          error: error.message,
        });
        return {
          state: 'COMPLETE',
          destinationTxHash: message.forwardTxHash || null,
          attestation,
          message: encodedMessage,
        };
      }

      throw error;
    }
  }
}

export const cctpRelayService = new CctpRelayService();
