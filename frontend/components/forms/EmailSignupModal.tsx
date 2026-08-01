'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useEmailWallet } from '@/hooks/useEmailWallet';

interface EmailSignupModalProps {
  open: boolean;
  onClose: () => void;
}

export default function EmailSignupModal({ open, onClose }: EmailSignupModalProps) {
  const [email, setEmail] = useState('');
  const { step, error, address, configured, startEmailSignup } = useEmailWallet();
  const router = useRouter();

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    await startEmailSignup(email);
  };

  if (step === 'done' && address) {
    router.push('/dashboard');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md rounded-xl border border-primary/20 bg-dark p-8">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-light">Sign up with Email</h2>
          <button onClick={onClose} className="text-light/50 hover:text-light">
            ✕
          </button>
        </div>

        {!configured ? (
          <p className="text-light/70">
            Email sign-up isn&apos;t configured yet on this deployment. Please use{' '}
            <strong>Connect Wallet</strong> instead.
          </p>
        ) : step === 'idle' ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-light/70 text-sm">
              No wallet needed — we&apos;ll create one for you, secured by a PIN you set in the
              next step. Powered by Circle&apos;s User-Controlled Wallets on Arc.
            </p>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-primary/20 bg-dark/50 px-4 py-3 text-light placeholder:text-light/40 focus:border-primary focus:outline-none"
            />
            <button
              type="submit"
              className="w-full rounded-lg bg-primary py-3 font-bold text-dark transition-all hover:bg-primary/90"
            >
              Continue
            </button>
          </form>
        ) : step === 'awaiting-otp' ? (
          <p className="text-light/70">Check your email for a verification code — enter it in the popup.</p>
        ) : step === 'awaiting-pin' ? (
          <p className="text-light/70">Set a PIN to secure your new wallet in the popup.</p>
        ) : null}

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
