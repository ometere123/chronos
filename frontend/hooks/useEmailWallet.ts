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
  /// encryptionKey. Re-initializes the SDK with that fresh auth, requests wallet creation
  /// (SCA, Arc Testnet), then runs Circle's hosted PIN-creation UI to complete it.
  const createWallet = useCallback(async (userToken: string, encryptionKey: string) => {
    setError(null);
    setIsLoading(true);
    try {
      const sdk = new W3SSdk({ appSettings: { appId: appId! }, authentication: { userToken, encryptionKey } });
      sdkRef.current = sdk;

      const { data: challenge } = await apiClient.post('/user-wallet/create-wallet', { userToken });

      setStep('awaiting-pin');
      sdk.execute(challenge.challengeId, async (err) => {
        if (err) {
          setError(err.message || 'Wallet creation failed');
          return;
        }

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
      });
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || err.message || 'Failed to create wallet');
    } finally {
      setIsLoading(false);
    }
  }, [appId, setIsLoading, setToken, setIsConnected]);

  /// Step 1: user submits their email. Creates a Circle user + token, initializes the SDK with
  /// an onLoginComplete callback that automatically proceeds to wallet creation once the OTP
  /// modal succeeds, then requests the OTP email and opens Circle's hosted OTP-entry UI.
  const startEmailSignup = useCallback(async (email: string) => {
    setError(null);
    setIsLoading(true);
    try {
      if (!appId) {
        throw new Error('NEXT_PUBLIC_CIRCLE_APP_ID is not configured');
      }

      const userId = crypto.randomUUID();
      userIdRef.current = userId;

      const { data: tokenData } = await apiClient.post('/user-wallet/signup', { userId });

      const sdk = new W3SSdk(
        { appSettings: { appId }, authentication: { userToken: tokenData.userToken, encryptionKey: tokenData.encryptionKey } },
        (loginErr, result) => {
          if (loginErr || !result) {
            setError(loginErr?.message || 'Email verification failed');
            return;
          }
          const emailResult = result as EmailLoginResult;
          void createWallet(emailResult.userToken, emailResult.encryptionKey);
        }
      );
      sdkRef.current = sdk;

      const deviceId = await sdk.getDeviceId();
      await apiClient.post('/user-wallet/email-otp', { deviceId, email });

      setStep('awaiting-otp');
      sdk.verifyOtp(); // renders Circle's hosted OTP-entry modal
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || err.message || 'Failed to start signup');
    } finally {
      setIsLoading(false);
    }
  }, [appId, createWallet, setIsLoading]);

  return { step, error, address, configured, startEmailSignup, sdk: sdkRef.current };
}
