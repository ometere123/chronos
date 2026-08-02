'use client';

import { ReactNode, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import { useWallet } from '@/hooks/useWallet';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { isConnected, isReady } = useWallet();
  const router = useRouter();

  useEffect(() => {
    if (isReady && !isConnected) {
      router.replace('/');
    }
  }, [isConnected, isReady, router]);

  if (!isReady) {
    return null;
  }

  if (!isConnected) {
    return null;
  }

  return (
    <>
      <Header />
      <div className="flex min-h-screen bg-dark">
        {/* Sidebar */}
        <aside className="hidden lg:block w-64 border-r border-primary/10 bg-dark/50">
          <nav className="p-6 space-y-2 sticky top-16">
            <Link
              href="/dashboard"
              className="block px-4 py-3 rounded-lg text-light hover:bg-primary/10 transition-colors"
            >
              My Vaults
            </Link>
            <Link
              href="/dashboard/create-vault"
              className="block px-4 py-3 rounded-lg text-primary bg-primary/10 font-semibold transition-colors"
            >
              Create Vault
            </Link>
            <Link
              href="/dashboard/proof-of-reserves"
              className="block px-4 py-3 rounded-lg text-light hover:bg-primary/10 transition-colors"
            >
              Proof of Reserves
            </Link>
            <Link
              href="/dashboard/treasury-payments"
              className="block px-4 py-3 rounded-lg text-light hover:bg-primary/10 transition-colors"
            >
              Treasury Payments
            </Link>
            <Link
              href="/dashboard/lend"
              className="block px-4 py-3 rounded-lg text-light hover:bg-primary/10 transition-colors"
            >
              Lend USDC
            </Link>
            <Link
              href="/dashboard/activity"
              className="block px-4 py-3 rounded-lg text-light hover:bg-primary/10 transition-colors"
            >
              Activity
            </Link>
            <Link
              href="/dashboard/settings"
              className="block px-4 py-3 rounded-lg text-light hover:bg-primary/10 transition-colors"
            >
              Settings
            </Link>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto p-6">
            {children}
          </div>
        </main>
      </div>
    </>
  );
}
