import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { ethers } from 'ethers';
import { asyncHandler } from '../middleware/errorHandler.js';
import { verifyPrivyTokenAndGetWallet } from '../services/privyService.js';
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

// Privy session: verifies the access token Privy's client SDK issued after a successful login
// (external wallet connect OR embedded email/social login - Privy handles both, unlike the old
// separate injected-wallet + Circle-email-OTP paths), then issues our own CHRONOS session JWT
// in the same shape /auth/verify does, so downstream routes don't care which login path a user
// came through.
router.post('/privy-session', asyncHandler(async (req, res) => {
  const { accessToken } = req.body;
  if (!accessToken) {
    return res.status(400).json({ error: { message: 'accessToken is required' } });
  }

  try {
    const { address, privyUserId } = await verifyPrivyTokenAndGetWallet(accessToken);

    const token = jwt.sign(
      {
        sub: `privy:${privyUserId}`,
        address,
        authProvider: 'privy',
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, address, authProvider: 'privy' });
  } catch (err) {
    logger.error('Privy session verification failed', { error: err.message });
    res.status(401).json({ error: { message: 'Invalid Privy session' } });
  }
}));

export default router;
