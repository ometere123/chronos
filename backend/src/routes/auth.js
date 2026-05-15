import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { ethers } from 'ethers';
import { asyncHandler } from '../middleware/errorHandler.js';
import logger from '../config/logger.js';

const router = express.Router();
const nonces = new Map();

const JWT_SECRET =
  process.env.JWT_SECRET ||
  process.env.AUTH_JWT_SECRET ||
  'chronos-local-dev-secret-change-me';

function normalizeAddress(address) {
  return ethers.getAddress(address).toLowerCase();
}

function buildLoginMessage(address, nonce) {
  return [
    'Sign in to CHRONOS',
    '',
    'This signature proves wallet ownership. It does not move funds or grant token approvals.',
    '',
    `Wallet: ${address}`,
    `Nonce: ${nonce}`,
  ].join('\n');
}

router.get('/nonce/:address', asyncHandler(async (req, res) => {
  let address;

  try {
    address = normalizeAddress(req.params.address);
  } catch {
    return res.status(400).json({ error: { message: 'Invalid wallet address' } });
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + 5 * 60 * 1000;
  const message = buildLoginMessage(address, nonce);

  nonces.set(address, { nonce, message, expiresAt });

  res.json({
    address,
    nonce,
    message,
    expiresAt,
  });
}));

router.post('/verify', asyncHandler(async (req, res) => {
  const { address: rawAddress, message, signature } = req.body;

  if (!rawAddress || !message || !signature) {
    return res.status(400).json({ error: { message: 'Address, message, and signature are required' } });
  }

  let address;
  let recoveredAddress;

  try {
    address = normalizeAddress(rawAddress);
    recoveredAddress = normalizeAddress(ethers.verifyMessage(message, signature));
  } catch (err) {
    logger.warn('Wallet signature verification failed', { error: err.message });
    return res.status(401).json({ error: { message: 'Invalid wallet signature' } });
  }

  const challenge = nonces.get(address);

  if (!challenge || challenge.message !== message || challenge.expiresAt < Date.now()) {
    return res.status(401).json({ error: { message: 'Login challenge expired. Please reconnect your wallet.' } });
  }

  if (recoveredAddress !== address) {
    return res.status(401).json({ error: { message: 'Signature does not match wallet address' } });
  }

  nonces.delete(address);

  const token = jwt.sign(
    {
      sub: `wallet:${address}`,
      address,
      authProvider: 'injected-wallet',
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    address,
    authProvider: 'injected-wallet',
  });
}));

export default router;
