'use client';

import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrivyProvider } from '@privy-io/react-auth';
import ThemeProvider from './ThemeProvider';
import NotificationCenter from './ui/NotificationCenter';
import { arcTestnetViemChain, privySupportedChains } from '@/config/privyChains';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 10,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

type ProvidersProps = {
  children: ReactNode;
};

export default function Providers({ children }: ProvidersProps) {
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  const app = (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {children}
        <NotificationCenter />
      </ThemeProvider>
    </QueryClientProvider>
  );

  if (!privyAppId) {
    return app;
  }

  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        loginMethods: ['wallet', 'email'],
        appearance: {
          theme: 'dark',
          walletChainType: 'ethereum-only',
        },
        embeddedWallets: {
          ethereum: { createOnLogin: 'users-without-wallets' },
          // The whole point of the embedded-wallet path is removing the multi-signature-popup
          // friction external wallets always have (MetaMask's confirmation UI is outside our
          // control either way). CHRONOS's own review screen (the multi-step create-vault
          // wizard) already gets explicit user confirmation before any transaction is built, so
          // Privy's per-tx popup on top of that is redundant, not an extra safety check - it was
          // undoing the exact friction email onboarding was meant to remove. External wallets are
          // unaffected by this setting; only embedded (email/social) wallets go silent.
          showWalletUIs: false,
        },
        defaultChain: arcTestnetViemChain,
        supportedChains: privySupportedChains,
      }}
    >
      {app}
    </PrivyProvider>
  );
}
