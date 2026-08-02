'use client';

import { Vault } from '@/types';
import { getChainName } from '@/config/chains';
import CountdownTimer from './CountdownTimer';
import {
  ArrowRightIcon,
  CheckIcon,
  ClockIcon,
  CoinsIcon,
  LockIcon,
  PlusIcon,
  ShieldIcon,
  SparklesIcon,
  UnlockIcon,
  XCircleIcon,
} from './Icons';
import Link from 'next/link';

interface VaultCardProps {
  vault: Vault;
}

export default function VaultCard({ vault }: VaultCardProps) {
  const statusColors = {
    ACTIVE: 'bg-green-500/20 text-green-400',
    MATURE: 'bg-yellow-500/20 text-yellow-400',
    CLAIMED: 'bg-blue-500/20 text-blue-400',
    FAILED: 'bg-red-500/20 text-red-400',
  };

  const StatusIcon = {
    ACTIVE: LockIcon,
    MATURE: UnlockIcon,
    CLAIMED: CheckIcon,
    FAILED: XCircleIcon,
  }[vault.status];

  const VaultTypeIcon = vault.vaultType === 'FIXED' ? ClockIcon : ShieldIcon;

  return (
    <Link href={`/dashboard/${vault.vaultId}`}>
      <div className="card hover:border-primary/30 cursor-pointer group transition-all">
        {/* Header */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <VaultTypeIcon className="h-5 w-5 text-primary" />
              <span className="text-light/60 text-sm font-medium">{vault.vaultType} Vault</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${statusColors[vault.status]}`}>
                <StatusIcon className="h-3.5 w-3.5" />
                {vault.status}
              </div>
              {vault.is_split && (
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-accent/20 text-accent">
                  Smart Split
                </span>
              )}
              {vault.is_streaming && (
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-accent/20 text-accent">
                  Streaming
                </span>
              )}
            </div>
          </div>
          <div className="text-3xl font-bold text-primary">
            ${parseFloat(vault.totalAmount).toFixed(0)}
          </div>
        </div>

        {/* Chains */}
        <div className="mb-6 pb-6 border-b border-primary/10">
          <div className="text-light/60 text-xs mb-2">Chains</div>
          <div className="flex items-center gap-2 text-sm">
            <span className="bg-primary/20 px-2 py-1 rounded text-primary">
              From: {getChainName(vault.sourceChain)}
            </span>
            <ArrowRightIcon className="h-4 w-4 text-light/40" />
            <span className="bg-accent/20 px-2 py-1 rounded text-accent">
              To: {vault.destinationChain ? getChainName(vault.destinationChain) : getChainName(vault.sourceChain)}
            </span>
          </div>
        </div>

        {/* Lock Duration */}
        {vault.status !== 'CLAIMED' && vault.status !== 'FAILED' && (
          <div className="mb-6 pb-6 border-b border-primary/10">
            <div className="text-light/60 text-xs mb-2">Time Remaining</div>
            <CountdownTimer unlockAt={vault.unlockAt} vaultId={vault.vaultId} />
          </div>
        )}

        {/* Bridge Protocol & Token */}
        <div className="mb-6 pb-6 border-b border-primary/10">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-light/60 text-xs mb-1">Bridge</div>
              <div className="text-light font-mono text-xs">{vault.bridgeProtocol}</div>
            </div>
            <div>
              <div className="text-light/60 text-xs mb-1">Token</div>
              <div className="text-light font-mono text-xs truncate">{vault.tokenAddress}</div>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div className="flex gap-2">
          {vault.status === 'ACTIVE' && (
            <>
              <button className="flex-1 px-3 py-2 bg-primary/20 text-primary text-sm font-medium rounded hover:bg-primary/30 transition-colors">
                <span className="inline-flex items-center justify-center gap-1.5">
                  <PlusIcon className="h-4 w-4" />
                  Add
                </span>
              </button>
              {vault.vaultType === 'FLEXIBLE' && (
                <button className="flex-1 px-3 py-2 bg-accent/20 text-accent text-sm font-medium rounded hover:bg-accent/30 transition-colors">
                  <span className="inline-flex items-center justify-center gap-1.5">
                    <CoinsIcon className="h-4 w-4" />
                    Withdraw
                  </span>
                </button>
              )}
            </>
          )}
          {vault.status === 'MATURE' && (
            <button className="w-full px-3 py-2 bg-green-500/20 text-green-400 text-sm font-medium rounded hover:bg-green-500/30 transition-colors">
              <span className="inline-flex items-center justify-center gap-1.5">
                <SparklesIcon className="h-4 w-4" />
                Claim Now
              </span>
            </button>
          )}
          {vault.status === 'CLAIMED' && (
            <button className="w-full px-3 py-2 bg-blue-500/20 text-blue-400 text-sm font-medium rounded opacity-60 cursor-default">
              <span className="inline-flex items-center justify-center gap-1.5">
                <CheckIcon className="h-4 w-4" />
                Claimed
              </span>
            </button>
          )}
        </div>
      </div>
    </Link>
  );
}
