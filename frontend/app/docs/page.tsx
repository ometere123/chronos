import Link from 'next/link';
import type { ReactNode } from 'react';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import {
  ArrowRightIcon,
  BridgeIcon,
  CheckIcon,
  CoinsIcon,
  LockIcon,
  ShieldIcon,
  SparklesIcon,
} from '@/components/ui/Icons';

const quickLinks = [
  { href: '#overview', label: 'Overview' },
  { href: '#requirements', label: 'Requirements' },
  { href: '#create-vault', label: 'Create vault' },
  { href: '#add-funds', label: 'Add funds' },
  { href: '#claim', label: 'Claim' },
  { href: '#delegate-agent', label: 'Delegate agent' },
  { href: '#credit-lines', label: 'Credit lines' },
  { href: '#operations', label: 'Operations' },
];

const supportedChains = [
  'Ethereum Sepolia',
  'Base Sepolia',
  'Arbitrum Sepolia',
  'OP Sepolia',
  'Arc Testnet',
];

const createSteps = [
  {
    title: 'Connect a wallet',
    body: 'Use the Connect button and complete Privy authentication. CHRONOS uses the connected wallet address for dashboard ownership, backend session auth, and transaction signing.',
  },
  {
    title: 'Choose a source chain',
    body: 'Pick where your test USDC starts. The app will ask the wallet to switch to the chosen source chain before the source-chain burn or approval step.',
  },
  {
    title: 'Enter amount and duration',
    body: 'Set the deposit amount and unlock schedule. Testnet mode supports short durations for fast demos, while the UI still models the same lock and maturity rules.',
  },
  {
    title: 'Select vault type',
    body: 'Fixed vaults enforce strict lock discipline. Flexible vaults allow early exit and apply the configured early-withdrawal penalty before maturity.',
  },
  {
    title: 'Optional advanced controls',
    body: 'When available for the selected flow, add conditional unlock data, split allocation settings, or streaming tranche configuration. These modes extend the settlement path and may not combine with every other option.',
  },
  {
    title: 'Review and create',
    body: 'Confirm the final terms. The app checks wallet chain, token allowance, submits source-chain settlement, records backend state, and opens the vault detail page when creation is complete.',
  },
];

const addFundsSteps = [
  'Open an active vault from the dashboard.',
  'Use the add-funds action on the vault detail page.',
  'Choose the amount and confirm the source-chain wallet transaction.',
  'Wait for backend settlement and lifecycle reconciliation.',
  'Confirm the Added Funds lifecycle entry and the updated locked balance.',
];

const claimSteps = [
  {
    title: 'Maturity claim',
    body: 'After the unlock date, the vault becomes mature. Use the claim action to settle the releasable balance according to the vault configuration.',
  },
  {
    title: 'Flexible early withdrawal',
    body: 'For flexible vaults only, early withdrawal can happen before maturity and applies the early-withdrawal penalty. Fixed vaults intentionally block early withdrawal.',
  },
  {
    title: 'Destination selection',
    body: 'When claiming or withdrawing, choose Arc or the source chain depending on the supported route and the available settlement path.',
  },
  {
    title: 'Reconciliation',
    body: 'The vault detail page reconciles claimed status and current locked balance from Arc so the UI reflects the live contract outcome.',
  },
];

const troubleshooting = [
  {
    problem: 'Wallet is on the wrong chain',
    fix: 'Switch to the chain shown in the error, then retry the action. CHRONOS validates wallet chain before signing.',
  },
  {
    problem: 'Approval prompt appears',
    fix: 'Approvals are required only when allowance is not already sufficient for the selected spender and amount.',
  },
  {
    problem: 'Burn submitted but no vault appears',
    fix: 'Use the recover submitted burn panel on the create-vault confirmation step with the source-chain burn transaction hash.',
  },
  {
    problem: 'Claim simulation says vault is not active',
    fix: 'Refresh the vault detail page and confirm status. If the vault is already claimed or not in an active claimable state, the contract simulation will reject it.',
  },
];

const envRows = [
  ['NEXT_PUBLIC_API_URL', 'Frontend API base URL. Production should point to the Railway backend.'],
  ['NEXT_PUBLIC_TIMELOCK_VAULT', 'Frontend contract address for the deployed TimeLockVault.'],
  ['NEXT_PUBLIC_CREDIT_LINE', 'Frontend contract address for the deployed CreditLine contract.'],
  ['PRIVY_APP_ID', 'Privy application identifier used by the backend session flow.'],
  ['PRIVY_APP_SECRET', 'Privy server secret. Keep server-side only.'],
  ['SCHEDULED_PAYMENTS_ADMIN_KEY', 'Server-side admin key for owner-gated scheduled-payment creation.'],
];

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-b border-primary/10 py-12 last:border-b-0">
      <h2 className="text-3xl font-bold text-light">{title}</h2>
      <div className="mt-6 space-y-6 text-light/70">{children}</div>
    </section>
  );
}

export default function DocsPage() {
  return (
    <>
      <Header />
      <main className="min-h-screen bg-dark">
        <section className="border-b border-primary/10 px-4 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-3xl">
              <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
                <ShieldIcon className="mr-2 h-4 w-4" />
                Platform documentation
              </span>
              <h1 className="mt-8 text-4xl font-bold leading-tight text-light sm:text-6xl">
                CHRONOS docs
              </h1>
              <p className="mt-6 text-lg leading-8 text-light/70">
                Detailed product, wallet, vault, agent, and operations documentation for the
                current CHRONOS testnet release. This page documents the behavior wired in the app
                and the deployed backend service.
              </p>
              <div className="mt-10 flex flex-col gap-3 sm:flex-row">
                <Link href="/dashboard/create-vault" className="btn-primary inline-flex items-center justify-center gap-2">
                  Start a Vault
                  <ArrowRightIcon className="h-4 w-4" />
                </Link>
                <Link href="/features" className="btn-ghost inline-flex items-center justify-center">
                  View Features
                </Link>
              </div>
            </div>
          </div>
        </section>

        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-12 lg:grid-cols-[240px_1fr]">
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <nav className="rounded-lg border border-primary/10 bg-dark/70 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-light/40">
                Contents
              </p>
              <div className="space-y-1">
                {quickLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="block rounded-md px-3 py-2 text-sm text-light/70 hover:bg-primary/10 hover:text-primary"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </nav>
          </aside>

          <div className="min-w-0">
            <Section id="overview" title="Overview">
              <p>
                CHRONOS is a non-custodial time-locked savings application for Arc Testnet. Users
                connect a wallet, deposit supported testnet assets from a source chain, settle the
                vault on Arc, and manage lifecycle actions from the dashboard.
              </p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {[
                  ['Custody model', 'Users keep wallet custody. Contracts and settlement services enforce vault state.'],
                  ['Primary asset', 'USDC-oriented testnet settlement with multi-token app support.'],
                  ['Production URLs', 'Frontend on Vercel, backend on Railway.'],
                ].map(([title, body]) => (
                  <div key={title} className="rounded-lg border border-primary/10 bg-dark/70 p-5">
                    <h3 className="font-semibold text-light">{title}</h3>
                    <p className="mt-2 text-sm leading-6">{body}</p>
                  </div>
                ))}
              </div>
            </Section>

            <Section id="requirements" title="Requirements">
              <p>Before using the testnet app, make sure you have the right wallet and network setup.</p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-primary/10 bg-dark/70 p-5">
                  <h3 className="flex items-center gap-2 font-semibold text-light">
                    <LockIcon className="h-5 w-5 text-primary" />
                    Wallet
                  </h3>
                  <p className="mt-3 text-sm leading-6">
                    Connect with Privy using an external wallet or supported login method. The
                    connected wallet signs source-chain approvals, burns, vault transactions, and
                    claim actions.
                  </p>
                </div>
                <div className="rounded-lg border border-primary/10 bg-dark/70 p-5">
                  <h3 className="flex items-center gap-2 font-semibold text-light">
                    <BridgeIcon className="h-5 w-5 text-primary" />
                    Networks
                  </h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {supportedChains.map((chain) => (
                      <span key={chain} className="rounded-full border border-primary/20 px-3 py-1 text-xs text-primary">
                        {chain}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </Section>

            <Section id="create-vault" title="Create a vault">
              <p>
                The create flow is a guided five-step process. It is designed to keep wallet
                signing moments explicit and to make final vault terms visible before any settlement
                transaction is submitted.
              </p>
              <div className="space-y-4">
                {createSteps.map((step, index) => (
                  <div key={step.title} className="rounded-lg border border-primary/10 bg-dark/70 p-5">
                    <div className="flex gap-4">
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-dark">
                        {index + 1}
                      </div>
                      <div>
                        <h3 className="font-semibold text-light">{step.title}</h3>
                        <p className="mt-2 text-sm leading-6">{step.body}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <Section id="add-funds" title="Add funds">
              <p>
                Adding funds increases the locked balance on an existing vault while preserving the
                vault schedule and lifecycle accounting.
              </p>
              <ol className="space-y-3">
                {addFundsSteps.map((step) => (
                  <li key={step} className="flex gap-3 rounded-lg border border-primary/10 bg-dark/70 p-4 text-sm leading-6">
                    <CheckIcon className="mt-1 h-4 w-4 flex-shrink-0 text-primary" />
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </Section>

            <Section id="claim" title="Claim and withdraw">
              <p>
                Claim behavior depends on vault type, maturity, and destination route. The app
                simulates transactions before sending so contract reverts are shown before a wallet
                signature whenever possible.
              </p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {claimSteps.map((step) => (
                  <div key={step.title} className="rounded-lg border border-primary/10 bg-dark/70 p-5">
                    <h3 className="font-semibold text-light">{step.title}</h3>
                    <p className="mt-2 text-sm leading-6">{step.body}</p>
                  </div>
                ))}
              </div>
            </Section>

            <Section id="delegate-agent" title="Delegate to the agent">
              <p>
                The vault agent keeper runs on the backend and can process eligible vault
                maintenance when configured. Production status is exposed through the agent status
                endpoint.
              </p>
              <div className="rounded-lg border border-primary/10 bg-dark/70 p-5">
                <h3 className="flex items-center gap-2 font-semibold text-light">
                  <SparklesIcon className="h-5 w-5 text-primary" />
                  Agent keeper status
                </h3>
                <p className="mt-3 text-sm leading-6">
                  Current production endpoint:
                  <span className="mt-2 block break-all font-mono text-primary">
                    https://chronos-backend-production.up.railway.app/api/agent/status
                  </span>
                </p>
                <p className="mt-3 text-sm leading-6">
                  A healthy response reports the keeper as configured and running. Eligible vault
                  count may be zero when no mature agent-delegated vaults are ready.
                </p>
              </div>
            </Section>

            <Section id="credit-lines" title="Credit lines">
              <p>
                The lending dashboard is the entry point for credit-line functionality. It relies on
                the deployed CreditLine contract address and the backend credit-line route being
                configured for the target environment.
              </p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-primary/10 bg-dark/70 p-5">
                  <h3 className="flex items-center gap-2 font-semibold text-light">
                    <CoinsIcon className="h-5 w-5 text-primary" />
                    User flow
                  </h3>
                  <p className="mt-3 text-sm leading-6">
                    Open the lending page from the dashboard, review available credit-line actions,
                    connect the wallet expected by the route, and complete contract interactions
                    through the wallet.
                  </p>
                </div>
                <div className="rounded-lg border border-primary/10 bg-dark/70 p-5">
                  <h3 className="flex items-center gap-2 font-semibold text-light">
                    <ShieldIcon className="h-5 w-5 text-primary" />
                    Configuration
                  </h3>
                  <p className="mt-3 text-sm leading-6">
                    Production needs the public `NEXT_PUBLIC_CREDIT_LINE` frontend value and the
                    backend contract configuration to point at the same deployed contract family.
                  </p>
                </div>
              </div>
            </Section>

            <Section id="operations" title="Operations">
              <p>
                These are the non-secret environment and smoke-check details operators should know.
                Secret values belong only in the hosting provider secret stores.
              </p>
              <div className="overflow-hidden rounded-lg border border-primary/10">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="bg-primary/10 text-light">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Variable</th>
                      <th className="px-4 py-3 font-semibold">Purpose</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-primary/10 bg-dark/70">
                    {envRows.map(([name, purpose]) => (
                      <tr key={name}>
                        <td className="px-4 py-3 font-mono text-primary">{name}</td>
                        <td className="px-4 py-3 text-light/70">{purpose}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rounded-lg border border-primary/10 bg-dark/70 p-5">
                <h3 className="font-semibold text-light">Production smoke checks</h3>
                <ul className="mt-4 space-y-3 text-sm leading-6">
                  <li className="break-all">
                    Frontend: <span className="font-mono text-primary">https://chronosfinance.vercel.app</span>
                  </li>
                  <li className="break-all">
                    Backend health:{' '}
                    <span className="font-mono text-primary">
                      https://chronos-backend-production.up.railway.app/health
                    </span>
                  </li>
                  <li>
                    Local frontend checks: <span className="font-mono text-primary">npm run type-check</span> and{' '}
                    <span className="font-mono text-primary">npm run build</span>
                  </li>
                </ul>
              </div>
            </Section>

            <Section id="troubleshooting" title="Troubleshooting">
              <div className="space-y-4">
                {troubleshooting.map((item) => (
                  <div key={item.problem} className="rounded-lg border border-primary/10 bg-dark/70 p-5">
                    <h3 className="font-semibold text-light">{item.problem}</h3>
                    <p className="mt-2 text-sm leading-6">{item.fix}</p>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
