import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
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

const featureGroups = [
  {
    title: 'Vault primitives',
    description:
      'Create savings positions with explicit rules for timing, early exits, top-ups, and release behavior.',
    items: [
      'Fixed vaults with no early withdrawal path',
      'Flexible vaults with a 0.5% early-withdrawal penalty',
      'Add-funds support that keeps the same unlock schedule',
      'Maturity detection and claim flows from the vault detail page',
    ],
    icon: LockIcon,
  },
  {
    title: 'Advanced vault modes',
    description:
      'Use the same core vault flow for more expressive release patterns when a single unlock date is not enough.',
    items: [
      'Split allocations for multiple recipients or buckets',
      'Streaming tranches for staged release schedules',
      'Oracle-conditioned unlock data for external proof based flows',
      'Agent-delegated maintenance for eligible mature vaults',
    ],
    icon: SparklesIcon,
  },
  {
    title: 'Cross-chain settlement',
    description:
      'Deposit on a supported source chain, bridge into Arc Testnet, and manage the settled position from CHRONOS.',
    items: [
      'Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, and OP Sepolia source-chain support',
      'Circle CCTP based burn-and-mint settlement',
      'Wallet chain checks before signing transactions',
      'Recovery flow for submitted burns when backend settlement times out',
    ],
    icon: BridgeIcon,
  },
  {
    title: 'Transparency',
    description:
      'The app reconciles database records with live contract state so displayed balances do not drift from Arc.',
    items: [
      'Proof-of-reserves page backed by live reserve verification',
      'Vault lifecycle cards for deposits, top-ups, withdrawals, penalties, and mature claims',
      'Activity feed for user-facing vault events',
      'On-chain status reconciliation for claimed vaults',
    ],
    icon: ChartIcon,
  },
  {
    title: 'Credit lines',
    description:
      'Use the lending area for the credit-line workflow when the deployed CreditLine contract is configured.',
    items: [
      'Dedicated dashboard lending page',
      'Borrower and collateral flow documentation',
      'Frontend service wiring for the CreditLine backend route',
      'Production env support through NEXT_PUBLIC_CREDIT_LINE',
    ],
    icon: CoinsIcon,
  },
  {
    title: 'Production operations',
    description:
      'The deployed backend exposes health and keeper status endpoints for verifying live service posture.',
    items: [
      'Railway health endpoint for listener and keeper status',
      'Vault-agent status endpoint for delegate automation',
      'Vercel frontend build configured for webpack',
      'Privy wallet authentication across the frontend and backend session flow',
    ],
    icon: ShieldIcon,
  },
];

const supportedFlows = [
  'Create a fixed or flexible vault',
  'Add more funds to an active vault',
  'Recover a submitted source-chain burn',
  'Claim a mature vault',
  'Delegate eligible maintenance to the agent',
  'Review reserves and lifecycle accounting',
];

export default function FeaturesPage() {
  return (
    <>
      <Header />
      <main className="min-h-screen bg-dark">
        <section className="border-b border-primary/10 px-4 py-20 sm:py-24">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-3xl">
              <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
                <ClockIcon className="mr-2 h-4 w-4" />
                Product surface
              </span>
              <h1 className="mt-8 text-4xl font-bold leading-tight text-light sm:text-6xl">
                Time-locked savings, built around real settlement.
              </h1>
              <p className="mt-6 text-lg leading-8 text-light/70">
                CHRONOS combines non-custodial vaults, CCTP settlement, live reserve checks,
                advanced release modes, and agent-assisted upkeep into one dashboard for Arc
                Testnet savings workflows.
              </p>
              <div className="mt-10 flex flex-col gap-3 sm:flex-row">
                <Link href="/dashboard/create-vault" className="btn-primary inline-flex items-center justify-center gap-2">
                  Create Vault
                  <ArrowRightIcon className="h-4 w-4" />
                </Link>
                <Link href="/docs" className="btn-ghost inline-flex items-center justify-center">
                  Read Docs
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="px-4 py-16">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {featureGroups.map(({ title, description, items, icon: Icon }) => (
              <article key={title} className="card">
                <Icon className="mb-5 h-10 w-10 text-primary" />
                <h2 className="text-xl font-bold text-light">{title}</h2>
                <p className="mt-3 text-sm leading-6 text-light/70">{description}</p>
                <ul className="mt-6 space-y-3">
                  {items.map((item) => (
                    <li key={item} className="flex gap-3 text-sm leading-6 text-light/70">
                      <CheckIcon className="mt-1 h-4 w-4 flex-shrink-0 text-primary" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="border-y border-primary/10 bg-primary/5 px-4 py-16">
          <div className="mx-auto max-w-6xl">
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
              <div>
                <h2 className="text-3xl font-bold text-light">What users can do today</h2>
                <p className="mt-4 text-light/70">
                  These are the workflows the product is organized around. Some actions still
                  depend on having the right testnet assets, connected wallet network, and deployed
                  contract configuration.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {supportedFlows.map((flow) => (
                  <div key={flow} className="rounded-lg border border-primary/10 bg-dark/70 p-4">
                    <div className="flex items-center gap-3 text-sm font-semibold text-light">
                      <CheckIcon className="h-4 w-4 text-primary" />
                      {flow}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
