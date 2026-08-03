import Image from 'next/image';
import Link from 'next/link';

export default function Footer() {
  const currentYear = new Date().getFullYear();
  const backendUrl = 'https://chronos-backend-production.up.railway.app';

  return (
    <footer className="border-t border-primary/10 bg-dark py-8">
      <div className="mx-auto max-w-[1180px] px-4 sm:px-6">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-[1.4fr_0.8fr_0.9fr_1fr]">
          <div className="max-w-sm">
            <div className="mb-3 flex items-center gap-2 text-base font-bold text-primary">
              <Image
                src="/chronos-logo.png"
                alt="CHRONOS"
                width={44}
                height={44}
                className="h-11 w-11 object-contain"
              />
              <span>CHRONOS</span>
            </div>
            <p className="text-sm leading-6 text-light/55">
              Non-custodial USDC vaults for Arc Testnet, built around time locks,
              CCTP settlement, and live reserve visibility.
            </p>
            <p className="mt-3 text-xs text-light/35">
              Testnet release. Not audited for mainnet value.
            </p>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold text-light">Product</h4>
            <ul className="space-y-1.5 text-sm text-light/50">
              <li><Link href="/features" className="hover:text-primary transition-colors">Features</Link></li>
              <li><Link href="/docs" className="hover:text-primary transition-colors">Docs</Link></li>
              <li><Link href="/proof-of-reserves" className="hover:text-primary transition-colors">Reserves</Link></li>
              <li><Link href="/dashboard" className="hover:text-primary transition-colors">Dashboard</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold text-light">Resources</h4>
            <ul className="space-y-1.5 text-sm text-light/50">
              <li><a href="https://github.com/ometere123/chronos" className="hover:text-primary transition-colors">GitHub</a></li>
              <li><a href="https://github.com/ometere123/chronos/blob/main/README.md" className="hover:text-primary transition-colors">README</a></li>
              <li><a href="https://github.com/ometere123/chronos/blob/main/docs/ARCHITECTURE.md" className="hover:text-primary transition-colors">Architecture</a></li>
              <li><Link href="/docs#operations" className="hover:text-primary transition-colors">Operations</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold text-light">Status</h4>
            <div className="space-y-2">
              <a
                href={`${backendUrl}/health`}
                className="flex items-center justify-between rounded-md border border-primary/10 px-3 py-2 text-xs text-light/55 hover:border-primary/30 hover:text-primary"
              >
                Backend health
                <span className="ml-3 h-2 w-2 rounded-full bg-primary" />
              </a>
              <a
                href={`${backendUrl}/api/agent/status`}
                className="flex items-center justify-between rounded-md border border-primary/10 px-3 py-2 text-xs text-light/55 hover:border-primary/30 hover:text-primary"
              >
                Agent keeper
                <span className="ml-3 h-2 w-2 rounded-full bg-primary" />
              </a>
              <Link
                href="/docs#troubleshooting"
                className="block text-xs text-light/40 hover:text-primary"
              >
                Troubleshooting
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-primary/10 pt-5 text-xs text-light/35 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {currentYear} CHRONOS. Non-custodial testnet vault infrastructure for Arc.
          </p>
          <p>
            Wallet custody stays with the user.
          </p>
        </div>
      </div>
    </footer>
  );
}
