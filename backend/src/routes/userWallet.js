// Email-OTP wallet onboarding via Circle User-Controlled Wallets (SCA on Arc Testnet).
// This is an ADDITIONAL sign-up path alongside the existing injected-wallet flow in auth.js -
// it does not replace it. See backend/src/services/userWalletService.js for the custody model
// and why this isn't bridged into the agent's ERC-4337/Pimlico setup.
import express from 'express';
import jwt from 'jsonwebtoken';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  createCircleUser,
  createUserToken,
  createEmailOtpChallenge,
  createUserWallet,
  listUserWallets,
  isUserWalletsConfigured,
} from '../services/userWalletService.js';
import logger from '../config/logger.js';

const router = express.Router();

const JWT_SECRET =
  process.env.JWT_SECRET ||
  process.env.AUTH_JWT_SECRET ||
  'chronos-local-dev-secret-change-me';

router.get('/status', (req, res) => {
  res.json({ configured: isUserWalletsConfigured() });
});

// Step 1: frontend calls this with a locally-generated userId (e.g. crypto.randomUUID()) once
// per new signup. Returns a Circle userToken/encryptionKey the Web SDK needs to initialize.
router.post('/signup', asyncHandler(async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: { message: 'userId is required' } });
  }

  try {
    await createCircleUser(userId);
  } catch (err) {
    // Circle returns a conflict if the user already exists - fine, continue to token issuance.
    if (err.response?.status !== 409) {
      logger.error('Error creating Circle user', { error: err.message });
      return res.status(502).json({ error: { message: 'Failed to create user' } });
    }
  }

  try {
    const token = await createUserToken(userId);
    res.json(token);
  } catch (err) {
    logger.error('Error creating Circle user token', { error: err.message });
    res.status(502).json({ error: { message: 'Failed to create user token' } });
  }
}));

// Step 2: frontend has already initialized the Web SDK with the userToken above and called
// sdk.getDeviceId() client-side. Relays the OTP challenge request server-side with our API key.
router.post('/email-otp', asyncHandler(async (req, res) => {
  const { deviceId, email } = req.body;
  if (!deviceId || !email) {
    return res.status(400).json({ error: { message: 'deviceId and email are required' } });
  }

  try {
    const result = await createEmailOtpChallenge({ deviceId, email });
    res.json(result);
  } catch (err) {
    logger.error('Error creating email OTP challenge', { error: err.message });
    res.status(502).json({ error: { message: 'Failed to send OTP - check SMTP relay configuration in Circle Console', detail: err.response?.data || err.message } });
  }
}));

// Step 3: after the user completes Circle's hosted OTP-verification UI (which yields a fresh
// userToken), request wallet creation (SCA, Arc Testnet) alongside PIN setup. Circle's Web SDK
// then renders the hosted PIN-creation UI to complete the challenge this call initiates.
router.post('/create-wallet', asyncHandler(async (req, res) => {
  const { userToken } = req.body;
  if (!userToken) {
    return res.status(400).json({ error: { message: 'userToken is required' } });
  }

  try {
    const result = await createUserWallet({ userToken });
    res.json(result);
  } catch (err) {
    logger.error('Error creating user wallet', { error: err.message });
    res.status(502).json({ error: { message: 'Failed to create wallet', detail: err.response?.data || err.message } });
  }
}));

// Step 4: once the wallet exists, mint a CHRONOS session JWT the same shape as the
// injected-wallet flow issues, so downstream API routes don't need to know which auth path
// a user came through.
router.post('/session', asyncHandler(async (req, res) => {
  const { userToken, userId } = req.body;
  if (!userToken || !userId) {
    return res.status(400).json({ error: { message: 'userToken and userId are required' } });
  }

  try {
    const wallets = await listUserWallets(userToken);
    const wallet = wallets?.[0];
    if (!wallet) {
      return res.status(404).json({ error: { message: 'No wallet found for this user' } });
    }

    const sessionToken = jwt.sign(
      { address: wallet.address.toLowerCase(), walletId: wallet.id, authMethod: 'email-otp' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token: sessionToken, address: wallet.address, walletId: wallet.id });
  } catch (err) {
    logger.error('Error issuing session for email-OTP user', { error: err.message });
    res.status(502).json({ error: { message: 'Failed to issue session' } });
  }
}));

export default router;
