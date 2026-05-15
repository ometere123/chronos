'use client';

import { useQuery } from '@tanstack/react-query';
import { getChainName } from '@/config/chains';
import apiClient from '@/services/api';
import { ProofOfReserves } from '@/types';

const contractLabels: Record<string, string> = {
  proofOfReserves: 'Proof of Reserves',
  timeLockVault: 'TimeLockVault',
  vaultFactory: 'VaultFactory',
  bridgeOrchestrator: 'BridgeOrchestrator',
  treasury: 'Treasury',
  usdc: 'Arc USDC',
};

function shortenAddress(address?: string) {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getVerificationTitle(reserves: ProofOfReserves) {
  if (reserves.source === 'database-fallback') {
    return 'Contract Check Unavailable';
  }

  return reserves.verified ? 'Fully Reserved' : 'Reserves Need Review';
}

function hasSyncedProofRegistry(reserves: ProofOfReserves) {
  return Boolean(
    reserves.onChain &&
      !reserves.onChain.error &&
      ((reserves.onChain.proofContractTotalVaults ?? 0) > 0 ||
        parseFloat(reserves.onChain.proofContractTotalLocked ?? '0') > 0)
  );
}

export default function ProofOfReservesPage() {
  const { data: reserves, isLoading, error } = useQuery({
    queryKey: ['proofOfReserves'],
    queryFn: async () => {
      const response = await apiClient.get('/proof-of-reserves');
      return response.data as ProofOfReserves;
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const contractEntries = reserves?.contracts
    ? Object.entries(contractLabels)
        .map(([key, label]) => ({
          key,
          label,
          address: reserves.contracts?.[key as keyof typeof reserves.contracts] as string | undefined,
          href: reserves.contracts?.links?.[key],
        }))
        .filter((contract) => contract.address)
    : [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-light mb-2">Proof of Reserves</h1>
        <p className="text-light/60">Real-time transparency. All funds auditable on Arc Testnet.</p>
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <div className="text-light/60">Loading reserves data...</div>
        </div>
      ) : error ? (
        <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-6">
          <div className="text-red-400">Failed to load reserves data</div>
        </div>
      ) : reserves ? (
        <>
          <div
            className={`card border-2 ${
              reserves.verified
                ? 'border-green-500/30 bg-green-500/5'
                : 'border-amber-500/30 bg-amber-500/5'
            }`}
          >
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div
                  className={`text-lg font-bold ${
                    reserves.verified ? 'text-green-400' : 'text-amber-300'
                  }`}
                >
                  {getVerificationTitle(reserves)}
                </div>
                <p className="text-light/70 mt-2">
                  Vault Balance: ${reserves.verificationDetails.timeLockVaultBalance}
                </p>
                <p className="text-light/70">
                  User Liabilities: ${reserves.verificationDetails.userLiabilities}
                </p>
                {reserves.source && (
                  <p className="text-light/50 text-xs mt-2">
                    Source: {reserves.source}
                  </p>
                )}
              </div>
              <div className="rounded border border-primary/20 px-4 py-3 text-right">
                <div className="text-light/50 text-xs">Arc Chain</div>
                <div className="text-primary font-mono">
                  {reserves.contracts?.arcChainId ?? '5042002'}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="card">
              <div className="text-light/60 text-sm mb-2">Total Locked</div>
              <div className="text-4xl font-bold text-primary">${reserves.totalLocked}</div>
              <div className="text-light/60 text-xs mt-2">{reserves.totalVaults} vaults</div>
            </div>

            <div className="card">
              <div className="text-light/60 text-sm mb-2">Active Users</div>
              <div className="text-4xl font-bold text-primary">{reserves.totalUsers}</div>
              <div className="text-light/60 text-xs mt-2">Wallets with vaults</div>
            </div>

            <div className="card">
              <div className="text-light/60 text-sm mb-2">Total Claimed</div>
              <div className="text-4xl font-bold text-green-400">
                ${reserves.totalClaimed ?? '0'}
              </div>
              <div className="text-light/60 text-xs mt-2">Completed vaults</div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="card">
              <h2 className="text-xl font-bold text-light mb-6">Locked by Chain</h2>
              <div className="space-y-3">
                {Object.entries(reserves.byChain).map(([chainId, amount]) => (
                  <div key={chainId} className="flex justify-between items-center py-3 border-b border-primary/10 last:border-0">
                    <div className="font-semibold">{getChainName(parseInt(chainId, 10))}</div>
                    <div className="text-primary font-mono">${amount}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <h2 className="text-xl font-bold text-light mb-6">Locked by Token</h2>
              <div className="space-y-3">
                {Object.entries(reserves.byToken).map(([token, amount]) => (
                  <div key={token} className="flex justify-between items-center gap-4 py-3 border-b border-primary/10 last:border-0">
                    <div className="font-mono text-sm truncate">{token}</div>
                    <div className="text-primary font-mono">${amount}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {reserves.onChain && !reserves.onChain.error && (
            <div className="card">
              <h2 className="text-xl font-bold text-light mb-6">On-Chain Reserve Backing</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <div className="text-light/50 text-sm">TimeLockVault Balance</div>
                  <div className="font-mono text-primary">${reserves.onChain.timeLockVaultBalance}</div>
                </div>
                <div>
                  <div className="text-light/50 text-sm">User Liabilities</div>
                  <div className="font-mono text-primary">${reserves.verificationDetails.userLiabilities}</div>
                </div>
                <div>
                  <div className="text-light/50 text-sm">Reserve Match</div>
                  <div className="font-mono text-primary">
                    {reserves.verificationDetails.match ? 'true' : 'false'}
                  </div>
                </div>
              </div>
              {!hasSyncedProofRegistry(reserves) && (
                <p className="mt-4 text-sm text-light/60">
                  The reserve verifier is live, but the on-chain vault registry is still syncing. The balance check above is the accurate backing signal for now.
                </p>
              )}
              {hasSyncedProofRegistry(reserves) && (
                <div className="mt-6 grid grid-cols-1 gap-4 border-t border-primary/10 pt-4 md:grid-cols-3">
                  <div>
                    <div className="text-light/50 text-sm">Registry Locked</div>
                    <div className="font-mono text-primary">${reserves.onChain.proofContractTotalLocked}</div>
                  </div>
                  <div>
                    <div className="text-light/50 text-sm">Registry Vaults</div>
                    <div className="font-mono text-primary">{reserves.onChain.proofContractTotalVaults}</div>
                  </div>
                  <div>
                    <div className="text-light/50 text-sm">Registry Verified</div>
                    <div className="font-mono text-primary">
                      {reserves.onChain.proofContractVerified ? 'true' : 'false'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {contractEntries.length > 0 && (
            <div className="card">
              <h2 className="text-xl font-bold text-light mb-6">Arc Contracts</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {contractEntries.map((contract) => (
                  <a
                    key={contract.key}
                    href={contract.href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-4 rounded border border-primary/10 px-4 py-3 hover:border-primary/40 transition-colors"
                  >
                    <span className="text-light/80">{contract.label}</span>
                    <span className="font-mono text-primary">{shortenAddress(contract.address)}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="text-center text-light/60 text-xs">
            Last updated: {new Date(reserves.updatedAt).toLocaleString()}
          </div>
        </>
      ) : null}
    </div>
  );
}
