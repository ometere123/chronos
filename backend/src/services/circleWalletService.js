// Wraps Circle's Developer-Controlled Wallets SDK for CHRONOS's vault-maintenance agent
// (Items 14-16). The agent wallet itself is real and live on Arc testnet - created via
// client.createWalletSet()/createWallets() against Circle's sandbox API, address recorded
// in .env.local as CIRCLE_AGENT_WALLET_ADDRESS. Verified working 2026-08-01.
//
// Scope note: this module provides the wallet primitives (balance, USDC transfer, contract
// execution) the agent needs. It does NOT yet include the on-chain delegate-authorization
// mechanism that would let the agent call TimeLockVault.claimVault() on a user's behalf -
// that requires a TimeLockVault.sol change (a per-vault delegate address a user opts into)
// which is a separate, not-yet-built piece. Treat autonomous claim/re-lock/self-pay as
// "wallet infrastructure ready, on-chain authorization pending" rather than fully wired.
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import logger from '../config/logger.js';

let client = null;

function getClient() {
  if (client) return client;

  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

  if (!apiKey || !entitySecret) {
    throw new Error('CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET not configured');
  }

  client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  return client;
}

export const AGENT_WALLET_ID = process.env.CIRCLE_AGENT_WALLET_ID || '';
export const AGENT_WALLET_ADDRESS = process.env.CIRCLE_AGENT_WALLET_ADDRESS || '';

export async function getAgentWalletBalance() {
  const c = getClient();
  const resp = await c.getWalletTokenBalance({ id: AGENT_WALLET_ID });
  return resp.data.tokenBalances;
}

/// Sends a USDC transfer from the agent wallet - used for the agent's self-payment
/// micro-fee flow (Item 15). Amount is a decimal string, e.g. "0.05".
export async function sendUsdcFromAgentWallet({ destinationAddress, amount }) {
  const c = getClient();
  const usdcTokenId = process.env.CIRCLE_USDC_TOKEN_ID;

  if (!usdcTokenId) {
    throw new Error('CIRCLE_USDC_TOKEN_ID not configured');
  }

  logger.info('Agent wallet sending USDC', { destinationAddress, amount });

  const resp = await c.createTransfer({
    walletId: AGENT_WALLET_ID,
    tokenId: usdcTokenId,
    destinationAddress,
    amount: [amount],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });

  return resp.data;
}

export async function getAgentWalletInfo() {
  const c = getClient();
  const resp = await c.getWallet({ id: AGENT_WALLET_ID });
  return resp.data.wallet;
}
