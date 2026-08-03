'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { useWallet } from '@/hooks/useWallet';
import {
  ArrowRightIcon,
  BridgeIcon,
  ChartIcon,
  CheckIcon,
  ClockIcon,
  CoinsIcon,
  LockIcon,
  ShieldIcon,
  SparklesIcon,
} from '@/components/ui/Icons';

const trustPoints = ['Arc Testnet', 'Circle CCTP', 'Privy wallet auth', 'Live reserve checks'];

const primaryFeatures = [
  {
    title: 'Fixed and flexible vaults',
    description:
      'Choose strict time locks or emergency access with an early-withdrawal penalty.',
    icon: LockIcon,
  },
  {
    title: 'Cross-chain USDC settlement',
    description:
      'Deposit from supported Sepolia networks and settle vault state on Arc Testnet.',
    icon: BridgeIcon,
  },
  {
    title: 'Live proof of reserves',
    description:
      'Public reserve views and a live contract verification path keep balances inspectable.',
    icon: ChartIcon,
  },
  {
    title: 'Advanced release rules',
    description:
      'Split allocations, streaming tranches, and condition-gated unlocks for richer vault design.',
    icon: ClockIcon,
  },
  {
    title: 'Credit-line surface',
    description:
      'Use locked vault balances as collateral through the configured credit-line contract path.',
    icon: CoinsIcon,
  },
  {
    title: 'Delegated claims',
    description:
      'Authorize an agent to trigger eligible mature claims without redirecting user funds.',
    icon: SparklesIcon,
  },
];

const flowSteps = [
  ['Create', 'Pick chain, amount, duration, vault type, and any advanced release settings.'],
  ['Settle', 'Approve only when needed, then submit the wallet transaction for CCTP settlement.'],
  ['Track', 'Watch maturity, lifecycle accounting, reserve status, and add-funds activity.'],
  ['Claim', 'Withdraw at maturity, use flexible emergency exit, or delegate eligible claims.'],
];

export default function Home() {
  const { isConnected, connect } = useWallet();
  const router = useRouter();

  // Privy's connect() opens a modal immediately. Wait for the session to finish before routing.
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
      <main className="min-h-screen bg-dark">
        <section className="border-b border-primary/10 px-4 py-14 sm:py-20">
          <div className="mx-auto max-w-[1050px]">
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
              <div>
                <div className="mb-6 flex flex-wrap gap-2.5">
                  {trustPoints.map((point) => (
                    <span
                      key={point}
                      className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary"
                    >
                      <CheckIcon className="mr-2 h-3.5 w-3.5" />
                      {point}
                    </span>
                  ))}
                </div>

                <h1 className="max-w-3xl text-4xl font-bold leading-tight text-light sm:text-6xl lg:text-[4.75rem]">
                  Non-custodial USDC vaults for Arc.
                </h1>

                <p className="mt-6 max-w-xl text-base leading-7 text-light/70 sm:text-lg">
                  CHRONOS lets users lock, track, add, claim, and withdraw testnet USDC through
                  transparent time-based vaults. Settlement lives on Arc; wallet authority stays
                  with the user.
                </p>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <button
                    onClick={handleGetStarted}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-7 py-3.5 text-base font-bold text-dark hover:bg-primary/90"
                  >
                    {isConnected ? 'Go to Dashboard' : 'Create Vault'}
                    <ArrowRightIcon className="h-4 w-4" />
                  </button>
                  <Link
                    href="/docs"
                    className="inline-flex items-center justify-center rounded-lg border-2 border-primary px-7 py-3.5 text-base font-bold text-primary hover:bg-primary/10"
                  >
                    Read Docs
                  </Link>
                </div>
              </div>

              <div className="rounded-lg border border-primary/10 bg-dark/70 p-5">
                <div className="mb-5 flex items-center justify-between border-b border-primary/10 pb-4">
                  <div>
                    <p className="text-xs text-light/50">Vault status</p>
                    <h2 className="text-xl font-bold text-light">Arc settlement view</h2>
                  </div>
                  <ShieldIcon className="h-8 w-8 text-primary" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    ['Vault types', 'Fixed / Flexible'],
                    ['Source chains', 'Sepolia routes'],
                    ['Reserve path', 'Public + live'],
                    ['Automation', 'Keeper running'],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-primary/10 bg-primary/5 p-3.5">
                      <p className="text-xs text-light/50">{label}</p>
                      <p className="mt-2 text-sm font-semibold text-light">{value}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-5 rounded-lg border border-primary/10 bg-dark p-3.5">
                  <p className="text-sm font-semibold text-primary">Production backend</p>
                  <p className="mt-2 break-all font-mono text-xs text-light/60">
                    chronos-backend-production.up.railway.app
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-primary/10 px-4 py-16">
          <div className="mx-auto max-w-6xl">
            <div className="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-primary">
                  Product surface
                </p>
                <h2 className="mt-3 text-3xl font-bold text-light sm:text-4xl">
                  Built around vault behavior, not vague yield promises.
                </h2>
              </div>
              <Link href="/features" className="inline-flex items-center gap-2 font-semibold text-primary">
                Full feature list
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {primaryFeatures.map(({ title, description, icon: Icon }) => (
                <article key={title} className="card">
                  <Icon className="mb-5 h-9 w-9 text-primary" />
                  <h3 className="text-xl font-bold text-light">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-light/70">{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-primary/10 bg-primary/5 px-4 py-16">
          <div className="mx-auto max-w-6xl">
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-[0.85fr_1.15fr]">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-primary">
                  Flow
                </p>
                <h2 className="mt-3 text-3xl font-bold text-light sm:text-4xl">
                  The main path is simple. The controls are explicit.
                </h2>
                <p className="mt-4 text-light/70">
                  Users should always know whether they are choosing vault terms, signing a wallet
                  transaction, waiting for settlement, or claiming settled funds.
                </p>
              </div>

              <div className="space-y-4">
                {flowSteps.map(([title, body], index) => (
                  <div key={title} className="rounded-lg border border-primary/10 bg-dark/70 p-5">
                    <div className="flex gap-4">
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-dark">
                        {index + 1}
                      </div>
                      <div>
                        <h3 className="font-semibold text-light">{title}</h3>
                        <p className="mt-2 text-sm leading-6 text-light/70">{body}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="px-4 py-16">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="rounded-lg border border-primary/10 bg-dark/70 p-6 lg:col-span-2">
              <ChartIcon className="mb-5 h-9 w-9 text-primary" />
              <h2 className="text-3xl font-bold text-light">Reserve visibility is public.</h2>
              <p className="mt-4 max-w-2xl leading-7 text-light/70">
                The proof-of-reserves page is available without wallet login. The backend also
                exposes a live verification path so demo-critical reserve claims can be checked
                against contract state instead of dashboard numbers alone.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/proof-of-reserves" className="btn-primary inline-flex justify-center">
                  View Reserves
                </Link>
                <Link href="/docs#operations" className="btn-ghost inline-flex justify-center">
                  Operator Notes
                </Link>
              </div>
            </div>

            <div className="rounded-lg border border-primary/10 bg-dark/70 p-6">
              <h3 className="text-xl font-bold text-light">Useful links</h3>
              <div className="mt-5 space-y-3">
                {[
                  ['/features', 'Features'],
                  ['/docs', 'Docs'],
                  ['/dashboard/lend', 'Credit lines'],
                  ['/dashboard/treasury-payments', 'Treasury payments'],
                ].map(([href, label]) => (
                  <Link
                    key={href}
                    href={href}
                    className="flex items-center justify-between rounded-lg border border-primary/10 px-4 py-3 text-sm font-semibold text-light/80 hover:border-primary/30 hover:text-primary"
                  >
                    {label}
                    <ArrowRightIcon className="h-4 w-4" />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-primary/10 px-4 py-16">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold text-light">
              Start with a vault. Inspect everything after.
            </h2>
            <p className="mt-4 text-light/70">
              CHRONOS is a testnet release. Bring a wallet, use testnet assets, and treat every
              signing step as part of the product.
            </p>
            <button
              onClick={handleGetStarted}
              className="mt-8 rounded-lg bg-primary px-8 py-4 text-lg font-bold text-dark hover:bg-primary/90"
            >
              {isConnected ? 'Go to Dashboard' : 'Open App'}
            </button>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
