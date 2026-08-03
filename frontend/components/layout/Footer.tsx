import Image from 'next/image';
import Link from 'next/link';

export default function Footer() {
  const currentYear = new Date().getFullYear();
  const backendUrl = 'https://chronos-backend-production.up.railway.app';

  return (
    <footer className="bg-dark border-t border-primary/10 py-12">
      <div className="max-w-7xl mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr_1fr_1fr] gap-8 mb-8">
          <div>
            <div className="flex items-center gap-2 font-bold text-lg text-primary mb-4">
              <Image
                src="/chronos-logo.png"
                alt="CHRONOS"
                width={56}
                height={56}
                className="h-[56px] w-[56px] object-contain"
              />
              <span>CHRONOS</span>
            </div>
            <p className="text-light/60 text-sm">
              Non-custodial USDC vaults for Arc Testnet. Built around time locks,
              CCTP settlement, live reserves, and explicit wallet authority.
            </p>
            <p className="mt-4 text-xs text-light/40">
              Testnet release. Not audited for mainnet value.
            </p>
          </div>

          <div>
            <h4 className="font-semibold text-light mb-4">Product</h4>
            <ul className="space-y-2 text-light/60 text-sm">
              <li><Link href="/features" className="hover:text-primary transition-colors">Features</Link></li>
              <li><Link href="/docs" className="hover:text-primary transition-colors">Docs</Link></li>
              <li><Link href="/proof-of-reserves" className="hover:text-primary transition-colors">Proof of Reserves</Link></li>
              <li><Link href="/dashboard" className="hover:text-primary transition-colors">Dashboard</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-light mb-4">Developers</h4>
            <ul className="space-y-2 text-light/60 text-sm">
              <li><a href="https://github.com/ometere123/chronos" className="hover:text-primary transition-colors">GitHub</a></li>
              <li><a href="https://github.com/ometere123/chronos/blob/main/README.md" className="hover:text-primary transition-colors">README</a></li>
              <li><a href="https://github.com/ometere123/chronos/blob/main/docs/ARCHITECTURE.md" className="hover:text-primary transition-colors">Architecture</a></li>
              <li><a href={`${backendUrl}/health`} className="hover:text-primary transition-colors">Backend Health</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-light mb-4">Status</h4>
            <ul className="space-y-2 text-light/60 text-sm">
              <li><a href={backendUrl} className="hover:text-primary transition-colors">Railway Backend</a></li>
              <li><a href={`${backendUrl}/api/agent/status`} className="hover:text-primary transition-colors">Agent Keeper</a></li>
              <li><Link href="/docs#operations" className="hover:text-primary transition-colors">Operations</Link></li>
              <li><Link href="/docs#troubleshooting" className="hover:text-primary transition-colors">Troubleshooting</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-primary/10 pt-8">
          <p className="text-light/40 text-sm text-center">
            © {currentYear} CHRONOS. Non-custodial testnet vault infrastructure for Arc.
          </p>
        </div>
      </div>
    </footer>
  );
}
