// Circle User-Controlled Wallets: email OTP for LOGIN, on a smart contract account (SCA) on Arc
// Testnet. This is the "sign up with just an email" path, alongside (not replacing) the existing
// injected-wallet flow in useInjectedWallet.ts.
//
// Important, confirmed limitation: Circle's current SDK always requires a PIN + security
// questions to authorize wallet CREATION/SIGNING, even when login itself uses email OTP.
// Email OTP replaces how you log in; it does not replace how you authorize a wallet action -
// that's PIN-based in every case today, per Circle's own "Build a Wallet App" tutorial (the
// execute() challenge step shows a PIN+security-question setup UI regardless of auth method).
// There is currently no way to fully eliminate the PIN step with this product. createWallet()
// (no PIN) was tried and confirmed NOT to bypass this - its response is still just a
// challengeId, same as createUserPinWithWallets. Using createUserPinWithWallets here since it's
// the documented, correct call.
//
// Key custody is Circle's 2-of-2 MPC (Circle + the authenticated user) - there is no exportable
// private key, so this is NOT bridged into the ERC-4337/Pimlico smart-account setup built for
// the agent (agentSmartAccountService.js). Instead, users get Circle's own SCA wallet type,
// intended to pair with Circle's Gas Station (confirmed to support Arc Testnet) for sponsorship -
// a separate mechanism from Pimlico, matching that this is a different identity.
//
// Setup requirements not yet configured (see README known limitations):
//   - CIRCLE_USER_WALLETS_APP_ID: created in Circle's Console (Web3 Services > User-Controlled
//     Wallets), distinct from the developer-controlled-wallets setup already done.
//   - SMTP relay configured in Circle Console - Circle does not deliver OTP emails itself.
import { initiateUserControlledWalletsClient, Blockchain } from '@circle-fin/user-controlled-wallets';
import logger from '../config/logger.js';

let client = null;
function getClient() {
  if (client) return client;
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) throw new Error('CIRCLE_API_KEY not configured');
  client = initiateUserControlledWalletsClient({ apiKey });
  return client;
}

/// Step 1: create (or reuse) a Circle user for this app-local user ID. Call once per user,
/// typically at first signup - userId should be your own stable identifier (e.g. a UUID you
/// generate), not the email itself.
export async function createCircleUser(userId) {
  const c = getClient();
  const resp = await c.createUser({ userId });
  return resp.data;
}

/// Step 2: request an email OTP device token. `deviceId` comes from Circle's Web SDK running
/// client-side (sdk.getDeviceId()) - the frontend must fetch it and pass it to our backend,
/// which relays this call server-side using our API key. The frontend then hands the returned
/// deviceToken/otpToken back to the SDK, which renders Circle's own hosted OTP-entry UI - we
/// don't build that form ourselves.
export async function createEmailOtpChallenge({ deviceId, email }) {
  const c = getClient();
  const resp = await c.createDeviceTokenForEmailLogin({ deviceId, email });
  return resp.data;
}

/// Step 0 (before step 2): mint a fresh userToken/encryptionKey pair for a given Circle userId.
/// The frontend SDK needs these to initialize.
export async function createUserToken(userId) {
  const c = getClient();
  const resp = await c.createUserToken({ userId });
  return resp.data;
}

/// Step 3: after OTP verification, request wallet creation (SCA, Arc Testnet). Returns a
/// challengeId - Circle's Web SDK renders the hosted PIN+security-question setup UI to complete
/// it (unavoidable with this product, see file header comment), then the wallet is provisioned.
export async function createUserWallet({ userToken, accountType = 'SCA' }) {
  const c = getClient();
  const resp = await c.createUserPinWithWallets({
    userToken,
    blockchains: [Blockchain.ArcTestnet],
    accountType,
  });
  // createUserPinWithWallets has an extra nesting level other methods here don't: its return
  // type is Pin { data: PinData { challengeId } }, so resp.data is { data: { challengeId } },
  // not { challengeId } directly. Confirmed live - without unwrapping this, the frontend's
  // challenge.challengeId was undefined, sdk.execute(undefined, cb) silently invoked the
  // callback with no error and no UI, and wallet creation never actually happened.
  return resp.data.data;
}

export async function listUserWallets(userToken) {
  const c = getClient();
  const resp = await c.listWallets({ userToken });
  return resp.data.wallets;
}

export async function getUserWalletBalance(userToken, walletId) {
  const c = getClient();
  const resp = await c.getWalletTokenBalance({ userToken, id: walletId });
  return resp.data.tokenBalances;
}

/// Backend calls (createUser/createUserToken/createDeviceTokenForEmailLogin/
/// createUserPinWithWallets) only ever need CIRCLE_API_KEY - confirmed by testing each one
/// directly. The App ID is a frontend-only requirement (Web SDK's appSettings.appId), and SMTP
/// is a Circle Console setting, not something read from this backend's env - neither is
/// checkable from here, so this only reflects what the backend itself actually needs.
export function isUserWalletsConfigured() {
  return Boolean(process.env.CIRCLE_API_KEY);
}
