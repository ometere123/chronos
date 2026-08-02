'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { BridgeTransaction } from '@/types';
import { ARC_CHAIN_ID, CHAINS, getChainName } from '@/config/chains';
import { useWallet } from '@/hooks/useWallet';
import apiClient from '@/services/api';
import { toCamelCaseBridgeTx } from '@/services/vaultService';

type ActivityKind = 'INITIAL_DEPOSIT' | 'ADD_FUNDS' | 'EARLY_WITHDRAWAL' | 'MATURE_CLAIM';
type ProofStatus = 'confirmed' | 'pending';

type TransactionProof = {
  label: string;
  hash?: string | null;
  chainId?: number;
  status?: ProofStatus;
};

const activityLabels: Record<ActivityKind, string> = {
  INITIAL_DEPOSIT: 'Initial Deposit',
  ADD_FUNDS: 'Add Funds',
  EARLY_WITHDRAWAL: 'Early Withdrawal',
  MATURE_CLAIM: 'Mature Claim',
};

function parseTransactionMetadata(tx: BridgeTransaction) {
  if (!tx.attestationData) {
    return null;
  }

  try {
    return JSON.parse(tx.attestationData) as Record<string, any>;
  } catch {
    return null;
  }
}

function getActivityKind(tx: BridgeTransaction): ActivityKind {
  const metadata = parseTransactionMetadata(tx);

  if (metadata?.type === 'ADD_TO_VAULT' || metadata?.type === 'ADD_TO_VAULT_RECOVERY') {
    return 'ADD_FUNDS';
  }

  if (metadata?.type === 'FLEXIBLE_WITHDRAWAL' || metadata?.type === 'FLEXIBLE_WITHDRAWAL_RETURN') {
    return 'EARLY_WITHDRAWAL';
  }

  if (metadata?.type === 'ARC_DIRECT_CLAIM' || metadata?.type === 'CCTP_RETURN_TO_SOURCE') {
    return 'MATURE_CLAIM';
  }

  if (tx.direction === 'INBOUND') {
    return 'INITIAL_DEPOSIT';
  }

  return 'MATURE_CLAIM';
}

function getTransactionTypeLabel(tx: BridgeTransaction) {
  return activityLabels[getActivityKind(tx)];
}

function getTransactionDetailLabel(tx: BridgeTransaction) {
  const metadata = parseTransactionMetadata(tx);
  const kind = getActivityKind(tx);

  if (kind === 'ADD_FUNDS') {
    return 'Additional deposit';
  }

  if (kind === 'EARLY_WITHDRAWAL') {
    const penalty = metadata?.penalty ? `, penalty $${Number(metadata.penalty).toFixed(2)}` : '';
    return metadata?.type === 'FLEXIBLE_WITHDRAWAL_RETURN'
      ? `Flexible withdrawal to ${getChainName(tx.toChain)}${penalty}`
      : `Flexible withdrawal on Arc${penalty}`;
  }

  if (kind === 'MATURE_CLAIM') {
    return metadata?.type === 'CCTP_RETURN_TO_SOURCE'
      ? `Claim return to ${getChainName(tx.toChain)}`
      : 'Claim on Arc';
  }

  return 'Vault funding';
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('0x') && value.length > 10;
}

function getExplorerTxUrl(chainId?: number, txHash?: string | null) {
  if (!chainId || !isHash(txHash)) {
    return null;
  }

  const explorer = CHAINS[chainId]?.explorer;
  return explorer ? `${explorer}/tx/${txHash}` : null;
}

function shortHash(hash?: string | null) {
  if (!isHash(hash)) {
    return 'Pending';
  }

  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

function hasProof(proofs: TransactionProof[], label: string, hash?: string | null) {
  return proofs.some((proof) => proof.label === label && proof.hash?.toLowerCase() === hash?.toLowerCase());
}

function pushProof(
  proofs: TransactionProof[],
  proof: TransactionProof
) {
  if (proof.status !== 'pending' && !isHash(proof.hash)) {
    return;
  }

  if (isHash(proof.hash) && hasProof(proofs, proof.label, proof.hash)) {
    return;
  }

  proofs.push({
    status: 'confirmed',
    ...proof,
  });
}

function buildTransactionProofs(tx: BridgeTransaction): TransactionProof[] {
  const metadata = parseTransactionMetadata(tx);
  const kind = getActivityKind(tx);
  const proofs: TransactionProof[] = [];

  if (kind === 'INITIAL_DEPOSIT' || kind === 'ADD_FUNDS') {
    pushProof(proofs, {
      label: kind === 'ADD_FUNDS' ? 'Source add burn' : 'Source deposit burn',
      hash: tx.txHash,
      chainId: tx.fromChain,
    });

    pushProof(proofs, {
      label: kind === 'ADD_FUNDS' ? 'Arc add settlement' : 'Arc vault settlement',
      hash: metadata?.settlementTxHash || metadata?.destinationTxHash,
      chainId: ARC_CHAIN_ID,
    });

    pushProof(proofs, {
      label: 'Arc backing mint',
      hash: metadata?.destinationMintTxHash,
      chainId: ARC_CHAIN_ID,
    });

    if (!metadata?.destinationMintTxHash && tx.status === 'PENDING') {
      pushProof(proofs, {
        label: 'Arc backing mint',
        chainId: ARC_CHAIN_ID,
        status: 'pending',
      });
    }

    return proofs;
  }

  if (kind === 'EARLY_WITHDRAWAL') {
    pushProof(proofs, {
      label: 'Arc withdrawal',
      hash: metadata?.withdrawTxHash || (tx.fromChain === ARC_CHAIN_ID && tx.toChain === ARC_CHAIN_ID ? tx.txHash : null),
      chainId: ARC_CHAIN_ID,
    });

    if (metadata?.type === 'FLEXIBLE_WITHDRAWAL_RETURN' || tx.toChain !== ARC_CHAIN_ID) {
      pushProof(proofs, {
        label: 'Arc bridge burn',
        hash: tx.txHash,
        chainId: ARC_CHAIN_ID,
      });

      pushProof(proofs, {
        label: 'Source mint',
        hash: metadata?.destinationTxHash,
        chainId: tx.toChain,
      });

      if (!metadata?.destinationTxHash && tx.status === 'PENDING') {
        pushProof(proofs, {
          label: 'Source mint',
          chainId: tx.toChain,
          status: 'pending',
        });
      }
    }

    return proofs;
  }

  pushProof(proofs, {
    label: 'Arc claim',
    hash: metadata?.claimTxHash || (tx.fromChain === ARC_CHAIN_ID && tx.toChain === ARC_CHAIN_ID ? tx.txHash : null),
    chainId: ARC_CHAIN_ID,
  });

  if (metadata?.type === 'CCTP_RETURN_TO_SOURCE' || tx.toChain !== ARC_CHAIN_ID) {
    pushProof(proofs, {
      label: 'Arc bridge burn',
      hash: tx.txHash,
      chainId: ARC_CHAIN_ID,
    });

    pushProof(proofs, {
      label: 'Source mint',
      hash: metadata?.destinationTxHash,
      chainId: tx.toChain,
    });

    if (!metadata?.destinationTxHash && tx.status === 'PENDING') {
      pushProof(proofs, {
        label: 'Source mint',
        chainId: tx.toChain,
        status: 'pending',
      });
    }
  }

  return proofs;
}

function getProofTone(proof: TransactionProof) {
  if (proof.status === 'pending') {
    return 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300';
  }

  if (!isHash(proof.hash)) {
    return 'border-light/10 bg-light/5 text-light/50';
  }

  return 'border-primary/30 bg-primary/10 text-primary';
}

export default function ActivityPage() {
  const { address } = useWallet();
  const [filterStatus, setFilterStatus] = useState<'all' | 'PENDING' | 'COMPLETE' | 'FAILED'>('all');
  const [filterActivity, setFilterActivity] = useState<'all' | ActivityKind>('all');

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ['userActivity', address],
    queryFn: async () => {
      if (!address) return [];
      const response = await apiClient.get(`/users/${address}`);
      return (response.data.transactions ?? []).map(toCamelCaseBridgeTx) as BridgeTransaction[];
    },
    enabled: !!address,
    refetchInterval: 10000,
  });

  const filteredTransactions = useMemo(
    () =>
      transactions.filter((tx) => {
        if (filterStatus !== 'all' && tx.status !== filterStatus) return false;
        if (filterActivity !== 'all' && getActivityKind(tx) !== filterActivity) return false;
        return true;
      }),
    [filterActivity, filterStatus, transactions]
  );

  const statusColors = {
    PENDING: 'bg-yellow-500/20 text-yellow-400',
    COMPLETE: 'bg-green-500/20 text-green-400',
    FAILED: 'bg-red-500/20 text-red-400',
  };

  const statusIcons = {
    PENDING: 'Pending',
    COMPLETE: 'Complete',
    FAILED: 'Failed',
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-2 text-4xl font-bold text-light">Activity History</h1>
        <p className="text-light/60">All your vault operations and bridge transactions</p>
      </div>

      <div className="flex flex-wrap gap-4">
        <div>
          <label className="mb-2 block text-sm text-light/60">Status</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
            className="input-field"
          >
            <option value="all">All Statuses</option>
            <option value="PENDING">Pending</option>
            <option value="COMPLETE">Complete</option>
            <option value="FAILED">Failed</option>
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm text-light/60">Type</label>
          <select
            value={filterActivity}
            onChange={(e) => setFilterActivity(e.target.value as typeof filterActivity)}
            className="input-field"
          >
            <option value="all">All Types</option>
            <option value="INITIAL_DEPOSIT">Initial Deposits</option>
            <option value="ADD_FUNDS">Add Funds</option>
            <option value="EARLY_WITHDRAWAL">Early Withdrawals</option>
            <option value="MATURE_CLAIM">Mature Claims</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center">
          <div className="text-light/60">Loading activity...</div>
        </div>
      ) : filteredTransactions.length === 0 ? (
        <div className="card py-12 text-center">
          <div className="text-light/60">No transactions yet</div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-primary/20">
                <th className="px-4 py-3 text-left text-sm font-semibold text-light/60">Date & Time</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-light/60">Type</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-light/60">Amount</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-light/60">Chains</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-light/60">Status</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-light/60">Transaction Proofs</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.map((tx, index) => {
                const proofs = buildTransactionProofs(tx);

                return (
                  <tr
                    key={tx.txHash || `${tx.vaultId}-${tx.createdAt}-${index}`}
                    className="border-b border-primary/10 transition-colors hover:bg-primary/5"
                  >
                    <td className="px-4 py-3 text-sm">
                      <div className="text-light">{new Date(tx.createdAt).toLocaleDateString()}</div>
                      <div className="text-xs text-light/60">{new Date(tx.createdAt).toLocaleTimeString()}</div>
                    </td>

                    <td className="px-4 py-3 text-sm">
                      <div className="font-semibold text-light">{getTransactionTypeLabel(tx)}</div>
                      <div className="text-xs text-light/60">{getTransactionDetailLabel(tx)}</div>
                    </td>

                    <td className="px-4 py-3 text-sm font-mono text-primary">${parseFloat(tx.amount).toFixed(2)}</td>

                    <td className="px-4 py-3 text-sm text-light/70">
                      <div className="text-xs">
                        {getChainName(tx.fromChain)} to {getChainName(tx.toChain)}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-sm">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
                          statusColors[tx.status as keyof typeof statusColors]
                        }`}
                      >
                        {statusIcons[tx.status as keyof typeof statusIcons]}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-sm">
                      <div className="flex min-w-[280px] flex-col gap-2">
                        {proofs.length > 0 ? (
                          proofs.map((proof, proofIndex) => {
                            const txUrl = getExplorerTxUrl(proof.chainId, proof.hash);
                            const proofBody = (
                              <>
                                <span className="text-light/70">{proof.label}</span>
                                <span className="font-mono">{shortHash(proof.hash)}</span>
                              </>
                            );

                            return txUrl ? (
                              <a
                                key={`${proof.label}-${proof.hash}-${proofIndex}`}
                                href={txUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`inline-flex w-fit max-w-full items-center gap-2 rounded-md border px-2 py-1 text-xs hover:border-primary hover:bg-primary/15 ${getProofTone(proof)}`}
                                title={`${proof.label} on ${getChainName(proof.chainId || 0)}: ${proof.hash}`}
                              >
                                {proofBody}
                              </a>
                            ) : (
                              <span
                                key={`${proof.label}-${proofIndex}`}
                                className={`inline-flex w-fit max-w-full items-center gap-2 rounded-md border px-2 py-1 text-xs ${getProofTone(proof)}`}
                                title={proof.status === 'pending' ? `${proof.label} is still pending` : proof.label}
                              >
                                {proofBody}
                              </span>
                            );
                          })
                        ) : (
                          <span className="font-mono text-xs text-light/50">No transaction proof yet</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
