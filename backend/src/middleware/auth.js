import jwt from 'jsonwebtoken';
import logger from '../config/logger.js';

const JWT_SECRET =
  process.env.JWT_SECRET ||
  process.env.AUTH_JWT_SECRET ||
  'chronos-local-dev-secret-change-me';

export const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.slice(7);

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      logger.error('Token verification failed', { error: err.message });
      return res.status(401).json({ error: 'Invalid token' });
    }

    if (!decoded || !decoded.sub || !decoded.address) {
      return res.status(401).json({ error: 'Invalid token structure' });
    }

    const walletAddressHeader = req.headers['x-wallet-address'];
    const walletAddress = typeof walletAddressHeader === 'string'
      ? walletAddressHeader.toLowerCase()
      : null;
    const tokenAddress = decoded.address.toLowerCase();

    if (walletAddress && walletAddress !== tokenAddress) {
      return res.status(401).json({ error: 'Wallet address does not match session token' });
    }

    req.user = {
      authId: decoded.sub,
      address: tokenAddress,
      email: null
    };

    next();
  } catch (err) {
    logger.error('Auth middleware error', { error: err.message });
    res.status(401).json({ error: 'Authentication failed' });
  }
};

export const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const decoded = jwt.verify(token, JWT_SECRET);
      const walletAddressHeader = req.headers['x-wallet-address'];
      const walletAddress = typeof walletAddressHeader === 'string'
        ? walletAddressHeader.toLowerCase()
        : null;
      if (decoded && decoded.sub && decoded.address) {
        const tokenAddress = decoded.address.toLowerCase();
        req.user = {
          authId: decoded.sub,
          address: walletAddress && walletAddress !== tokenAddress ? null : tokenAddress,
          email: null
        };
      }
    }
    next();
  } catch (err) {
    next();
  }
};
