'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '@/services/api';
import { CHAINS } from '@/config/chains';
import { useAuthStore } from '@/store/authStore';

const TOKEN_KEY = 'chronos_auth_token';
const ADDRESS_KEY = 'chronos_wallet_address';

function normalizeAddress(address: string) {
  return address.toLowerCase();
}

function toHexChainId(chainId: number) {
  return `0x${chainId.toString(16)}`;
}

function isUnknownChainError(error: any) {
  const message = String(error?.message || error?.data?.message || error?.error?.message || '').toLowerCase();

  return (
    error?.code === 4902 ||
    error?.data?.originalError?.code === 4902 ||
    message.includes('unrecognized chain') ||
    message.includes('unknown chain') ||
    message.includes('chain has not been added') ||
    message.includes('wallet_addethereumchain')
  );
}

function getProvider() {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return window.ethereum;
}

export function useInjectedWallet() {
  const {
    user,
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

  const [isReady, setIsReady] = useState(false);
  const provider = useMemo(() => getProvider(), []);
  const address = user?.address ?? null;

  const disconnect = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ADDRESS_KEY);
    clearAuthStore();
  }, [clearAuthStore]);

  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    const storedAddress = localStorage.getItem(ADDRESS_KEY);

    if (storedToken && storedAddress) {
      const normalizedAddress = normalizeAddress(storedAddress);
      setToken(storedToken);
      setUser({
        address: normalizedAddress,
        authId: `wallet:${normalizedAddress}`,
        createdAt: '',
      });
    }

    setIsReady(true);
  }, [setToken, setUser]);

  useEffect(() => {
    if (!provider?.on) {
      return;
    }

    const handleAccountsChanged = () => {
      disconnect();
    };

    provider.on('accountsChanged', handleAccountsChanged);

    return () => {
      provider.removeListener?.('accountsChanged', handleAccountsChanged);
    };
  }, [disconnect, provider]);

  const connect = useCallback(async () => {
    const injectedProvider = getProvider();

    if (!injectedProvider) {
      const message = 'No injected wallet found. Install MetaMask, Rabby, Coinbase Wallet, or another browser wallet.';
      setError(message);
      throw new Error(message);
    }

    setIsLoading(true);
    setError(null);

    try {
      const accounts = await injectedProvider.request<string[]>({
        method: 'eth_requestAccounts',
      });
      const connectedAddress = normalizeAddress(accounts[0] ?? '');

      if (!connectedAddress) {
        throw new Error('No wallet account returned by injected provider.');
      }

      const nonceResponse = await apiClient.get(`/auth/nonce/${connectedAddress}`);
      const { message } = nonceResponse.data;

      const signature = await injectedProvider.request<string>({
        method: 'personal_sign',
        params: [message, connectedAddress],
      });

      const verifyResponse = await apiClient.post('/auth/verify', {
        address: connectedAddress,
        message,
        signature,
      });

      const sessionToken = verifyResponse.data.token as string;
      const sessionAddress = normalizeAddress(verifyResponse.data.address ?? connectedAddress);

      localStorage.setItem(TOKEN_KEY, sessionToken);
      localStorage.setItem(ADDRESS_KEY, sessionAddress);

      setToken(sessionToken);
      setUser({
        address: sessionAddress,
        authId: `wallet:${sessionAddress}`,
        createdAt: '',
      });

      return sessionAddress;
    } catch (err: any) {
      const message = err?.response?.data?.error?.message ?? err?.message ?? 'Wallet connection failed.';
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, [setError, setIsLoading, setToken, setUser]);

  const switchChain = useCallback(async (chainId: number) => {
    const injectedProvider = getProvider();

    if (!injectedProvider) {
      throw new Error('No injected wallet found.');
    }

    const chain = CHAINS[chainId];
    const chainIdHex = toHexChainId(chainId);

    const switchToConfiguredChain = () =>
      injectedProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainIdHex }],
      });

    try {
      await switchToConfiguredChain();
    } catch (err: any) {
      if (!chain || !isUnknownChainError(err)) {
        throw err;
      }

      await injectedProvider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: chainIdHex,
            chainName: chain.name,
            nativeCurrency: {
              name: chain.id === 5042002 ? 'USDC' : 'Ether',
              symbol: chain.id === 5042002 ? 'USDC' : 'ETH',
              decimals: 18,
            },
            rpcUrls: [chain.rpc],
            blockExplorerUrls: [chain.explorer],
          },
        ],
      });

      await switchToConfiguredChain();
    }
  }, []);

  return {
    address,
    token,
    user,
    isConnected,
    isLoading,
    isReady,
    error,
    provider: getProvider(),
    connect,
    disconnect,
    switchChain,
  };
}
