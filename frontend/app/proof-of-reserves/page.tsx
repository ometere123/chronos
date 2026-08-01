'use client';

import Header from '@/components/layout/Header';
import ProofOfReservesView from '@/components/ProofOfReservesView';

// Public, read-only proof-of-reserves page. Intentionally NOT nested under
// app/dashboard, which redirects unauthenticated visitors to `/`. Anyone
// should be able to load this page and see live on-chain reserve data
// without connecting a wallet.
export default function PublicProofOfReservesPage() {
  return (
    <>
      <Header />
      <div className="min-h-screen bg-dark">
        <div className="max-w-7xl mx-auto p-6">
          <ProofOfReservesView />
        </div>
      </div>
    </>
  );
}
