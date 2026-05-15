import Image from 'next/image';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-dark border-t border-primary/10 py-12">
      <div className="max-w-7xl mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
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
              Multi-token time-locked savings infrastructure on Arc Testnet.
            </p>
          </div>

          <div>
            <h4 className="font-semibold text-light mb-4">Product</h4>
            <ul className="space-y-2 text-light/60 text-sm">
              <li><a href="#features" className="hover:text-primary transition-colors">Features</a></li>
              <li><a href="#" className="hover:text-primary transition-colors">Docs</a></li>
              <li><a href="#" className="hover:text-primary transition-colors">Smart Contracts</a></li>
              <li><a href="#" className="hover:text-primary transition-colors">API</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-light mb-4">Community</h4>
            <ul className="space-y-2 text-light/60 text-sm">
              <li><a href="#" className="hover:text-primary transition-colors">Discord</a></li>
              <li><a href="#" className="hover:text-primary transition-colors">Twitter</a></li>
              <li><a href="#" className="hover:text-primary transition-colors">GitHub</a></li>
              <li><a href="#" className="hover:text-primary transition-colors">Blog</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-light mb-4">Legal</h4>
            <ul className="space-y-2 text-light/60 text-sm">
              <li><a href="#" className="hover:text-primary transition-colors">Terms</a></li>
              <li><a href="#" className="hover:text-primary transition-colors">Privacy</a></li>
              <li><a href="#" className="hover:text-primary transition-colors">Disclaimer</a></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-primary/10 pt-8">
          <p className="text-light/40 text-sm text-center">
            © {currentYear} CHRONOS. Built for testnet discipline. Non-custodial, always auditable.
          </p>
        </div>
      </div>
    </footer>
  );
}
