'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { vaultService } from '@/services/vaultService';
import VaultCard from '@/components/ui/VaultCard';
import { Vault } from '@/types';
import { useState } from 'react';
import { useInjectedWallet } from '@/hooks/useInjectedWallet';
import { Plus } from 'lucide-react';

export default function DashboardPage() {
  const { address } = useInjectedWallet();
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'mature' | 'claimed'>('all');

  const { data: vaults = [], isLoading, error } = useQuery({
    queryKey: ['userVaults', address],
    queryFn: () => vaultService.getUserVaults(address || ''),
    enabled: !!address,
    refetchInterval: 15000,
  });

  const filteredVaults = vaults.filter((vault: Vault) => {
    if (filterStatus === 'all') return true;
    return vault.status.toLowerCase() === filterStatus;
  });

  const activeVaults = vaults.filter((v: Vault) => v.status === 'ACTIVE');
  const matureVaults = vaults.filter((v: Vault) => v.status === 'MATURE');
  const claimedVaults = vaults.filter((v: Vault) => v.status === 'CLAIMED');

  const totalLocked = vaults
    .filter((v: Vault) => v.status === 'ACTIVE' || v.status === 'MATURE')
    .reduce((sum, v) => sum + parseFloat(v.totalAmount), 0);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-bold text-light mb-2">My Vaults</h1>
          <p className="text-light/60">Manage and track your time-locked savings</p>
        </div>
        <Link
          href="/dashboard/create-vault"
          className="px-6 py-3 bg-primary text-dark font-bold rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Create Vault
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card">
          <div className="text-light/60 text-sm mb-2">Total Locked</div>
          <div className="text-3xl font-bold text-primary">${totalLocked.toFixed(2)}</div>
        </div>
        <div className="card">
          <div className="text-light/60 text-sm mb-2">Active Vaults</div>
          <div className="text-3xl font-bold text-primary">{activeVaults.length}</div>
        </div>
        <div className="card">
          <div className="text-light/60 text-sm mb-2">Mature (Ready)</div>
          <div className="text-3xl font-bold text-yellow-400">{matureVaults.length}</div>
        </div>
        <div className="card">
          <div className="text-light/60 text-sm mb-2">Claimed</div>
          <div className="text-3xl font-bold text-green-400">{claimedVaults.length}</div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 border-b border-primary/10">
        {(['all', 'active', 'mature', 'claimed'] as const).map((status) => (
          <button
            key={status}
            onClick={() => setFilterStatus(status)}
            className={`px-4 py-3 font-medium transition-colors border-b-2 ${
              filterStatus === status
                ? 'text-primary border-primary'
                : 'text-light/60 border-transparent hover:text-light'
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      {/* Vaults List */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="text-light/60">Loading vaults...</div>
        </div>
      ) : error ? (
        <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4">
          <div className="text-red-400">Error loading vaults. Please try again.</div>
        </div>
      ) : filteredVaults.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-light/60 mb-6">No vaults yet</div>
          <Link
            href="/dashboard/create-vault"
            className="inline-block px-6 py-3 bg-primary text-dark font-bold rounded-lg hover:bg-primary/90 transition-colors"
          >
            Create Your First Vault
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredVaults.map((vault: Vault) => (
            <VaultCard key={vault.vaultId} vault={vault} />
          ))}
        </div>
      )}
    </div>
  );
}
