'use client';

// Email OTP wallet onboarding via Circle User-Controlled Wallets. An ADDITIONAL sign-up path
// alongside useInjectedWallet.ts - not a replacement. Writes to the same localStorage keys/auth
// store, so once a session exists, the rest of the app doesn't need to know which path a user
// came through.
//
// Setup dependency: NEXT_PUBLIC_CIRCLE_APP_ID must be set (from Circle's Console, User-Controlled
// Wallets section) for the Web SDK to initialize. Without it, this hook's `configured` flag is
// false and the UI should fall back to injected-wallet-only.
import { useCallback, useRef, useState } from 'react';
import { W3SSdk } from '@circle-fin/w3s-pw-web-sdk';
import apiClient from '@/services/api';
import { useAuthStore } from '@/store/authStore';

// @circle-fin/w3s-pw-web-sdk only exports the W3SSdk class from its package root - result/error
// types live in an internal, non-exported module. Minimal local shape for what the SDK's
// onLoginComplete callback actually hands back (userToken/encryptionKey), per its type defs.
interface EmailLoginResult {
  userToken: string;
  encryptionKey: string;
  refreshToken: string;
}

const TOKEN_KEY = 'chronos_auth_token';
const ADDRESS_KEY = 'chronos_wallet_address';

type Step = 'idle' | 'awaiting-otp' | 'awaiting-pin' | 'done';

export function useEmailWallet() {
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const sdkRef = useRef<W3SSdk | null>(null);
  const userIdRef = useRef<string | null>(null);

  const { setToken, setIsConnected, setIsLoading } = useAuthStore();

  const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID;
  const configured = Boolean(appId);

  /// Step 2: once the OTP modal completes, the SDK calls this with a fresh userToken/
  /// encryptionKey. Reuses the SAME sdk instance from step 1 (per Circle's docs pattern -
  /// constructing a new W3SSdk here instead of calling setAuthentication() on the existing one
  /// caused "Invalid credentials" during execute(), confirmed live), sets the fresh auth on it,
  /// requests wallet creation (SCA, Arc Testnet), then runs Circle's hosted PIN-creation UI.
  const finishSession = useCallback(async (userToken: string) => {
    const { data: session } = await apiClient.post('/user-wallet/session', {
      userToken,
      userId: userIdRef.current,
    });

    localStorage.setItem(TOKEN_KEY, session.token);
    localStorage.setItem(ADDRESS_KEY, session.address.toLowerCase());
    setToken(session.token);
    setIsConnected(true);
    setAddress(session.address);
    setStep('done');
  }, [setToken, setIsConnected]);

  const createWallet = useCallback(async (userToken: string, encryptionKey: string) => {
    setError(null);
    setIsLoading(true);
    try {
      const sdk = sdkRef.current;
      if (!sdk) {
        throw new Error('SDK session lost - please restart sign-up');
      }
      console.log('[CHRONOS email wallet] setAuthentication with userToken', userToken?.slice(0, 20));
      sdk.setAuthentication({ userToken, encryptionKey });

      console.log('[CHRONOS email wallet] requesting wallet creation challenge');
      const { data: challenge } = await apiClient.post('/user-wallet/create-wallet', { userToken });
      console.log('[CHRONOS email wallet] got challenge', challenge);

      // Re-running signup against an email that already has a Circle wallet (e.g. from an
      // earlier attempt) skips the PIN challenge entirely - the wallet already exists.
      if (challenge.alreadyInitialized) {
        await finishSession(userToken);
        return;
      }

      setStep('awaiting-pin');
      sdk.execute(challenge.challengeId, async (err) => {
        console.log('[CHRONOS email wallet] execute() completed', { err });
        if (err) {
          setError(err.message || JSON.stringify(err) || 'Wallet creation failed');
          return;
        }
        await finishSession(userToken);
      });
    } catch (err: any) {
      console.error('[CHRONOS email wallet] createWallet failed', err);
      setError(
        err?.response?.data?.error?.message ||
        err?.response?.data?.error?.detail ||
        err?.message ||
        JSON.stringify(err) ||
        'Failed to create wallet'
      );
    } finally {
      setIsLoading(false);
    }
  }, [setIsLoading, finishSession]);

  /// Step 1: user submits their email. Pre-creates a Circle user (our own userId), initializes
  /// the SDK with an onLoginComplete callback that proceeds to wallet creation once the OTP
  /// modal succeeds, requests the OTP email, then configures the SDK's loginConfigs with the
  /// deviceToken/deviceEncryptionKey/otpToken the OTP request returned - NOT a userToken. The
  /// SDK's verifyOtp() step authenticates via those login-config tokens, not the general-purpose
  /// userToken (which only becomes valid/relevant after OTP verification succeeds).
  const startEmailSignup = useCallback(async (email: string) => {
    setError(null);
    setIsLoading(true);
    try {
      if (!appId) {
        throw new Error('NEXT_PUBLIC_CIRCLE_APP_ID is not configured');
      }

      const userId = crypto.randomUUID();
      userIdRef.current = userId;

      await apiClient.post('/user-wallet/signup', { userId });

      const sdk = new W3SSdk({ appSettings: { appId } }, (loginErr, result) => {
        console.log('[CHRONOS email wallet] onLoginComplete', { loginErr, result });
        if (loginErr || !result) {
          setError(loginErr?.message || JSON.stringify(loginErr) || 'Email verification failed');
          return;
        }
        const emailResult = result as EmailLoginResult;
        void createWallet(emailResult.userToken, emailResult.encryptionKey);
      });
      sdkRef.current = sdk;

      console.log('[CHRONOS email wallet] requesting device id');
      const deviceId = await sdk.getDeviceId();
      console.log('[CHRONOS email wallet] got device id', deviceId);
      const { data: otpData } = await apiClient.post('/user-wallet/email-otp', { deviceId, email });
      console.log('[CHRONOS email wallet] got otp challenge data', otpData);

      sdk.updateConfigs({
        appSettings: { appId },
        loginConfigs: {
          deviceToken: otpData.deviceToken,
          deviceEncryptionKey: otpData.deviceEncryptionKey,
          otpToken: otpData.otpToken,
        },
      });

      setStep('awaiting-otp');
      sdk.verifyOtp(); // renders Circle's hosted OTP-entry modal
    } catch (err: any) {
      console.error('[CHRONOS email wallet] startEmailSignup failed', err);
      setError(
        err?.response?.data?.error?.message ||
        err?.message ||
        JSON.stringify(err) ||
        'Failed to start signup'
      );
    } finally {
      setIsLoading(false);
    }
  }, [appId, createWallet, setIsLoading]);

  return { step, error, address, configured, startEmailSignup, sdk: sdkRef.current };
}
