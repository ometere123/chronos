'use client';

// Unified wallet + auth hook, backed by Privy. Replaces the old split between
// useInjectedWallet.ts (raw window.ethereum) and useEmailWallet.ts (Circle User-Controlled
// Wallets) - Privy's modal handles BOTH external wallet connection (MetaMask, Rabby, Coinbase,
// etc.) and embedded email/social-login wallets through one login() call, so there's only ever
// one path from here on. Exposes the same interface shape useInjectedWallet did (address, token,
// isConnected, isLoading, isReady, error, provider, connect, disconnect, switchChain) so existing
// consumers only need an import/rename change, not a rewrite.
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePrivy, useWallets, useLogin, getAccessToken } from '@privy-io/react-auth';
import apiClient from '@/services/api';
import { CHAINS } from '@/config/chains';
import { useAuthStore } from '@/store/authStore';

const TOKEN_KEY = 'chronos_auth_token';
const ADDRESS_KEY = 'chronos_wallet_address';

function normalizeAddress(address: string) {
  return address.toLowerCase();
}

export function useWallet() {
  const {
    user: authUser,
    token,
    isConnected,
    isLoading,
    error,
    setUser,
    setToken,
    setIsLoading,
    setError,
    logout: clearAuthStore,
  } = useAuthStore();

  const { ready: privyReady, authenticated, logout: privyLogout } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const [isReady, setIsReady] = useState(false);
  const exchangingRef = useRef(false);

  const address = authUser?.address ?? null;

  const disconnect = useCallback(async () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ADDRESS_KEY);
    clearAuthStore();
    try {
      await privyLogout();
    } catch {
      // Already logged out client-side is fine.
    }
  }, [clearAuthStore, privyLogout]);

  // Restore a previous CHRONOS session from localStorage on first load.
  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    const storedAddress = localStorage.getItem(ADDRESS_KEY);

    if (storedToken && storedAddress) {
      const normalizedAddress = normalizeAddress(storedAddress);
      setToken(storedToken);
      setUser({
        address: normalizedAddress,
        authId: `privy:${normalizedAddress}`,
        createdAt: '',
      });
    }

    setIsReady(true);
  }, [setToken, setUser]);

  // Exchanges a completed Privy login for a CHRONOS session JWT. Runs whenever Privy reports
  // authenticated + a wallet is available, but only once per session (exchangingRef guard) and
  // only if we don't already have a matching CHRONOS session.
  useEffect(() => {
    if (!privyReady || !walletsReady || !authenticated) return;
    if (exchangingRef.current) return;

    const wallet = wallets[0];
    if (!wallet?.address) return;

    const walletAddress = normalizeAddress(wallet.address);
    if (address === walletAddress && token) return; // already exchanged

    exchangingRef.current = true;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const accessToken = await getAccessToken();
        if (!accessToken) {
          throw new Error('No Privy access token available');
        }

        const { data } = await apiClient.post('/auth/privy-session', { accessToken });
        const sessionToken = data.token as string;
        const sessionAddress = normalizeAddress(data.address ?? walletAddress);

        localStorage.setItem(TOKEN_KEY, sessionToken);
        localStorage.setItem(ADDRESS_KEY, sessionAddress);

        setToken(sessionToken);
        setUser({
          address: sessionAddress,
          authId: `privy:${sessionAddress}`,
          createdAt: '',
        });
      } catch (err: any) {
        const message = err?.response?.data?.error?.message ?? err?.message ?? 'Session exchange failed.';
        setError(message);
      } finally {
        setIsLoading(false);
        exchangingRef.current = false;
      }
    })();
  }, [privyReady, walletsReady, authenticated, wallets, address, token, setToken, setUser, setIsLoading, setError]);

  const { login } = useLogin({
    onError: (loginError) => {
      setError(String(loginError) || 'Login failed.');
    },
  });

  const connect = useCallback(async () => {
    setError(null);
    login();
  }, [login, setError]);

  /// Returns an EIP-1193 provider for the currently connected wallet - works identically for
  /// external wallets (MetaMask etc.) and Privy's embedded wallets, unlike the old
  /// window.ethereum-only approach.
  const getProvider = useCallback(async () => {
    const wallet = wallets[0];
    if (!wallet) return undefined;
    return wallet.getEthereumProvider();
  }, [wallets]);

  const switchChain = useCallback(async (chainId: number) => {
    const wallet = wallets[0];
    if (!wallet) {
      throw new Error('No wallet connected.');
    }
    if (!CHAINS[chainId]) {
      throw new Error(`Unsupported chain: ${chainId}`);
    }
    await wallet.switchChain(chainId);
  }, [wallets]);

  return {
    address,
    token,
    user: authUser,
    isConnected,
    isLoading,
    isReady: isReady && privyReady,
    error,
    getProvider,
    connect,
    disconnect,
    switchChain,
  };
}
