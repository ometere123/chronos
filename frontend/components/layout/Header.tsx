'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useWallet } from '@/hooks/useWallet';

export default function Header() {
  const { address, isConnected, isLoading, connect, disconnect } = useWallet();
  const router = useRouter();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const handleLogout = async () => {
    await disconnect();
    router.push('/');
  };

  const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '';

  return (
    <header className="sticky top-0 z-50 bg-dark/95 backdrop-blur-sm border-b border-primary/10">
      <div className="max-w-7xl mx-auto px-4">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center h-16">
          <Link href="/" className="flex items-center gap-2 font-bold text-xl text-primary">
            <Image
              src="/chronos-logo.png"
              alt="CHRONOS"
              width={72}
              height={72}
              className="h-[72px] w-[72px] object-contain"
              priority
            />
            <span>CHRONOS</span>
          </Link>

          <nav className="hidden md:flex items-center justify-center gap-8">
            <Link href="/features" className="text-light/70 hover:text-primary transition-colors">
              Features
            </Link>
            <Link href="/docs" className="text-light/70 hover:text-primary transition-colors">
              Docs
            </Link>
            {isConnected && (
              <>
                <Link href="/dashboard" className="text-light/70 hover:text-primary transition-colors">
                  Dashboard
                </Link>
                <Link href="/dashboard/proof-of-reserves" className="text-light/70 hover:text-primary transition-colors">
                  Reserves
                </Link>
                <Link href="/dashboard/activity" className="text-light/70 hover:text-primary transition-colors">
                  Activity
                </Link>
              </>
            )}
          </nav>

          <div className="flex items-center justify-end gap-4">
            {isConnected ? (
              <div className="flex items-center gap-4">
                <div className="hidden sm:block text-sm">
                  <div className="text-primary font-mono">{shortAddress}</div>
                </div>
                <div className="relative group">
                  <button className="w-10 h-10 rounded-full bg-primary/20 border border-primary flex items-center justify-center text-primary font-bold hover:bg-primary/30 transition-colors">
                    {address?.[2] || 'U'}
                  </button>
                  <div className="absolute right-0 mt-2 w-48 bg-dark border border-primary/20 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all py-2">
                    <Link
                      href="/dashboard/settings"
                      className="block px-4 py-2 hover:bg-primary/10 transition-colors"
                    >
                      Settings
                    </Link>
                    <button
                      onClick={handleLogout}
                      className="block w-full text-left px-4 py-2 hover:bg-primary/10 transition-colors text-red-400"
                    >
                      Logout
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                onClick={() => connect()}
                disabled={isLoading}
                className="px-6 py-2 bg-primary text-dark font-semibold rounded-lg hover:bg-primary/90 transition-colors"
              >
                {isLoading ? 'Connecting...' : 'Connect'}
              </button>
            )}

            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="md:hidden flex flex-col gap-1.5 w-6 h-6 justify-center"
            >
              <div className={`h-0.5 w-6 bg-primary transition-transform ${isMenuOpen ? 'rotate-45 translate-y-2' : ''}`} />
              <div className={`h-0.5 w-6 bg-primary transition-opacity ${isMenuOpen ? 'opacity-0' : ''}`} />
              <div className={`h-0.5 w-6 bg-primary transition-transform ${isMenuOpen ? '-rotate-45 -translate-y-2' : ''}`} />
            </button>
          </div>
        </div>

        {isMenuOpen && (
          <nav className="md:hidden border-t border-primary/10 py-4 space-y-3">
            <Link
              href="/features"
              className="block text-light/70 hover:text-primary transition-colors"
              onClick={() => setIsMenuOpen(false)}
            >
              Features
            </Link>
            <Link
              href="/docs"
              className="block text-light/70 hover:text-primary transition-colors"
              onClick={() => setIsMenuOpen(false)}
            >
              Docs
            </Link>
            {isConnected && (
              <>
                <Link
                  href="/dashboard"
                  className="block text-light/70 hover:text-primary transition-colors"
                  onClick={() => setIsMenuOpen(false)}
                >
                  Dashboard
                </Link>
                <Link
                  href="/dashboard/proof-of-reserves"
                  className="block text-light/70 hover:text-primary transition-colors"
                  onClick={() => setIsMenuOpen(false)}
                >
                  Reserves
                </Link>
                <Link
                  href="/dashboard/activity"
                  className="block text-light/70 hover:text-primary transition-colors"
                  onClick={() => setIsMenuOpen(false)}
                >
                  Activity
                </Link>
              </>
            )}
          </nav>
        )}
      </div>
    </header>
  );
}
