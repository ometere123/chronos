'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect } from 'react';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { useWallet } from '@/hooks/useWallet';
import {
  BridgeIcon,
  ChartIcon,
  CheckIcon,
  ClockIcon,
  LockIcon,
  PlusIcon,
  ShieldIcon,
} from '@/components/ui/Icons';

export default function Home() {
  const { isConnected, connect } = useWallet();
  const router = useRouter();

  // Privy's connect() opens a modal and returns immediately - it doesn't await full login
  // completion the way the old direct SIWE flow did. Navigate once the session actually
  // finishes (isConnected flips true), rather than right after the modal opens.
  useEffect(() => {
    if (isConnected) {
      router.push('/dashboard');
    }
  }, [isConnected, router]);

  const handleGetStarted = () => {
    if (isConnected) {
      router.push('/dashboard');
    } else {
      connect();
    }
  };

  return (
    <>
      <Header />
      <main className="min-h-screen bg-gradient-to-b from-dark via-dark to-dark/95">
        {/* Hero Section */}
        <section className="px-4 pt-20 pb-16 sm:pt-32 sm:pb-24">
          <div className="max-w-4xl mx-auto text-center">
            <div className="mb-8">
              <span className="inline-flex items-center px-4 py-2 bg-primary/10 border border-primary/20 rounded-full text-primary text-sm font-medium">
                <LockIcon className="mr-2 h-4 w-4" />
                Testnet Release
              </span>
            </div>

            <h1 className="text-5xl sm:text-7xl font-bold text-light mb-6 leading-tight">
              Lock USDC, <br />
              <span className="text-primary">Unlock Discipline</span>
            </h1>

            <p className="text-xl text-light/70 max-w-2xl mx-auto mb-12">
              Multi-token time-locked savings infrastructure on Arc Testnet.
              FIXED vaults for strict discipline. FLEXIBLE vaults for emergencies.
              Zero custody risk.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
              <button
                onClick={handleGetStarted}
                className="px-8 py-4 bg-primary text-dark font-bold rounded-lg hover:bg-primary/90 transition-all text-lg"
              >
                {isConnected ? 'Go to Dashboard' : 'Create Vault'}
              </button>
              <Link
                href="/features"
                className="px-8 py-4 border-2 border-primary text-primary font-bold rounded-lg hover:bg-primary/10 transition-all text-lg"
              >
                Learn More
              </Link>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mt-20">
              <div className="bg-dark/50 border border-primary/10 rounded-lg p-6">
                <div className="text-3xl font-bold text-primary mb-2">$0</div>
                <div className="text-light/60 text-sm">Total Locked</div>
              </div>
              <div className="bg-dark/50 border border-primary/10 rounded-lg p-6">
                <div className="text-3xl font-bold text-primary mb-2">0</div>
                <div className="text-light/60 text-sm">Active Vaults</div>
              </div>
              <div className="bg-dark/50 border border-primary/10 rounded-lg p-6">
                <div className="text-3xl font-bold text-primary mb-2">0</div>
                <div className="text-light/60 text-sm">Community Members</div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="px-4 py-20">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-4xl font-bold text-light text-center mb-16">Why CHRONOS?</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {/* Feature 1 */}
              <div className="card">
                <LockIcon className="h-10 w-10 mb-4 text-primary" />
                <h3 className="text-xl font-bold text-light mb-3">Non-Custodial</h3>
                <p className="text-light/70">
                  You control your keys. We never hold your tokens. All settlement on Arc Testnet.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="card">
                <ClockIcon className="h-10 w-10 mb-4 text-primary" />
                <h3 className="text-xl font-bold text-light mb-3">FIXED Vaults</h3>
                <p className="text-light/70">
                  Immutable unlock dates. Zero early withdrawal. Maximum discipline. 0% penalty.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="card">
                <ShieldIcon className="h-10 w-10 mb-4 text-primary" />
                <h3 className="text-xl font-bold text-light mb-3">FLEXIBLE Vaults</h3>
                <p className="text-light/70">
                  Emergency withdrawals anytime. 0.5% penalty if before unlock. 0% at maturity.
                </p>
              </div>

              {/* Feature 4 */}
              <div className="card">
                <BridgeIcon className="h-10 w-10 mb-4 text-primary" />
                <h3 className="text-xl font-bold text-light mb-3">Multi-Chain</h3>
                <p className="text-light/70">
                  Deposit from Base, Arbitrum, or Ethereum. Settle on Arc. Claim back on source.
                </p>
              </div>

              {/* Feature 5 */}
              <div className="card">
                <ChartIcon className="h-10 w-10 mb-4 text-primary" />
                <h3 className="text-xl font-bold text-light mb-3">Proof of Reserves</h3>
                <p className="text-light/70">
                  Real-time transparency. Auditable on-chain. Smart contract verified.
                </p>
              </div>

              {/* Feature 6 */}
              <div className="card">
                <PlusIcon className="h-10 w-10 mb-4 text-primary" />
                <h3 className="text-xl font-bold text-light mb-3">Add to Vault</h3>
                <p className="text-light/70">
                  Extend with new deposits. Same unlock date. Keep growing your discipline.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="px-4 py-20 bg-dark/50">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-4xl font-bold text-light text-center mb-16">How It Works</h2>

            <div className="space-y-8">
              <div className="flex gap-6">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary text-dark flex items-center justify-center font-bold text-lg">
                  1
                </div>
                <div>
                  <h3 className="text-xl font-bold text-light mb-2">Create Vault</h3>
                  <p className="text-light/70">
                    Choose FIXED or FLEXIBLE. Set amount and lock duration (5 mins to 12 months in test mode).
                  </p>
                </div>
              </div>

              <div className="flex gap-6">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary text-dark flex items-center justify-center font-bold text-lg">
                  2
                </div>
                <div>
                  <h3 className="text-xl font-bold text-light mb-2">Bridge & Lock</h3>
                  <p className="text-light/70">
                    Tokens are bridged from your source chain to Arc Testnet via Circle CCTP.
                  </p>
                </div>
              </div>

              <div className="flex gap-6">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary text-dark flex items-center justify-center font-bold text-lg">
                  3
                </div>
                <div>
                  <h3 className="text-xl font-bold text-light mb-2">Wait & Watch</h3>
                  <p className="text-light/70">
                    Real-time countdown timer. Add more deposits anytime. Manage from dashboard.
                  </p>
                </div>
              </div>

              <div className="flex gap-6">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary text-dark flex items-center justify-center font-bold text-lg">
                  4
                </div>
                <div>
                  <h3 className="text-xl font-bold text-light mb-2">Claim at Maturity</h3>
                  <p className="text-light/70">
                    Unlock date reached. Claim tokens back to your source chain. Instant settlement.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Trust Section */}
        <section className="px-4 py-20">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl font-bold text-light mb-12">Built for Trust</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-8 text-center">
              <div>
                <CheckIcon className="mx-auto h-10 w-10 mb-3 text-primary" />
                <div className="text-light/70 text-sm">Non-Custodial</div>
              </div>
              <div>
                <CheckIcon className="mx-auto h-10 w-10 mb-3 text-primary" />
                <div className="text-light/70 text-sm">Auditable</div>
              </div>
              <div>
                <CheckIcon className="mx-auto h-10 w-10 mb-3 text-primary" />
                <div className="text-light/70 text-sm">Open-Source</div>
              </div>
              <div>
                <CheckIcon className="mx-auto h-10 w-10 mb-3 text-primary" />
                <div className="text-light/70 text-sm">Smart Contract Verified</div>
              </div>
              <div>
                <CheckIcon className="mx-auto h-10 w-10 mb-3 text-primary" />
                <div className="text-light/70 text-sm">Zero Fees (Testnet)</div>
              </div>
              <div>
                <CheckIcon className="mx-auto h-10 w-10 mb-3 text-primary" />
                <div className="text-light/70 text-sm">Real-Time Stats</div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="px-4 py-20 bg-gradient-to-r from-primary/10 to-accent/10 border-t border-primary/20">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl font-bold text-light mb-6">Ready to Lock & Earn Discipline?</h2>
            <p className="text-light/70 mb-8">
              Join the testnet. Lock your first vault. Start your savings journey with CHRONOS.
            </p>
            <button
              onClick={handleGetStarted}
              className="px-8 py-4 bg-primary text-dark font-bold rounded-lg hover:bg-primary/90 transition-all text-lg"
            >
              {isConnected ? 'Go to Dashboard' : 'Get Started'}
            </button>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
