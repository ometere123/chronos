// Privy auth verification. Replaces the Circle User-Controlled Wallets email-OTP path (see
// docs/ARCHITECTURE.md) - Privy handles BOTH external wallet connection and embedded
// email/social wallets through one client-side SDK, so there's no separate injected-wallet
// vs email-wallet code path anymore, just one Privy-issued session verified here.
import { PrivyClient } from '@privy-io/server-auth';
import logger from '../config/logger.js';

let client = null;
function getClient() {
  if (client) return client;
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error('NEXT_PUBLIC_PRIVY_APP_ID / PRIVY_APP_SECRET not configured');
  }
  client = new PrivyClient(appId, appSecret);
  return client;
}

/// Verifies a Privy access token (sent by the frontend after login) and returns the
/// authoritative wallet address for that user, fetched directly from Privy rather than
/// trusting a client-supplied address.
export async function verifyPrivyTokenAndGetWallet(accessToken) {
  const c = getClient();
  const claims = await c.verifyAuthToken(accessToken);
  const user = await c.getUser(claims.userId);

  const address = user.wallet?.address;
  if (!address) {
    throw new Error('Privy user has no linked wallet');
  }

  return { address: address.toLowerCase(), privyUserId: claims.userId };
}

export function isPrivyConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID && process.env.PRIVY_APP_SECRET);
}
