import apiClient from './api';
import { Vault, BridgeTransaction } from '../types';

const getEffectiveVaultStatus = (status: any, unlockAtValue: any) => {
  const normalizedStatus = status ?? 'ACTIVE';
  if (normalizedStatus !== 'ACTIVE') {
    return normalizedStatus;
  }

  const unlockAtMs = new Date(unlockAtValue).getTime();
  if (Number.isFinite(unlockAtMs) && unlockAtMs <= Date.now()) {
    return 'MATURE';
  }

  return normalizedStatus;
};

const getOptionalChainId = (value: any) => {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }

  return Number(value);
};

const toCamelCaseVault = (vault: any): Vault => ({
  vaultId: vault.vault_id ?? vault.vaultId,
  owner: vault.owner_address ?? vault.owner,
  totalAmount: String(vault.total_amount ?? vault.totalAmount ?? '0'),
  createdAt: Math.floor(new Date(vault.created_at ?? vault.createdAt).getTime() / 1000),
  unlockAt: Math.floor(new Date(vault.unlock_at ?? vault.unlockAt).getTime() / 1000),
  sourceChain: Number(vault.source_chain ?? vault.sourceChain ?? 0),
  destinationChain: getOptionalChainId(vault.destination_chain ?? vault.destinationChain),
  bridgeProtocol: vault.bridge_protocol ?? vault.bridgeProtocol,
  tokenAddress: vault.token_address ?? vault.tokenAddress ?? '',
  vaultType: vault.vault_type ?? vault.vaultType,
  status: getEffectiveVaultStatus(vault.status, vault.unlock_at ?? vault.unlockAt),
  bridgeTxHash: vault.bridge_tx_hash ?? vault.bridgeTxHash ?? undefined,
  createdOnChainTx: vault.created_on_chain_tx ?? vault.createdOnChainTx ?? undefined,
  claimed_tx_hash: vault.claimed_tx_hash ?? vault.claimedTxHash ?? undefined,
});

export const toCamelCaseBridgeTx = (tx: any): BridgeTransaction => ({
  txHash: tx.tx_hash ?? tx.txHash,
  vaultId: tx.vault_id ?? tx.vaultId,
  direction: tx.direction,
  fromChain: Number(tx.from_chain ?? tx.fromChain ?? 0),
  toChain: Number(tx.to_chain ?? tx.toChain ?? 0),
  amount: String(tx.amount ?? '0'),
  bridgeProtocol: tx.bridge_protocol ?? tx.bridgeProtocol,
  tokenAddress: tx.token_address ?? tx.tokenAddress ?? undefined,
  status: tx.status,
  createdAt:
    typeof tx.created_at === 'string' ? tx.created_at : new Date(tx.created_at ?? tx.createdAt).toISOString(),
  completedAt:
    typeof tx.completed_at === 'string'
      ? tx.completed_at
      : tx.completed_at
        ? new Date(tx.completed_at).toISOString()
        : tx.completedAt ?? undefined,
  retryCount: Number(tx.retry_count ?? tx.retryCount ?? 0),
  attestationData: tx.attestation_data ?? tx.attestationData ?? undefined,
});

export const vaultService = {
  async getCctpTransferFee(
    sourceChain: number,
    destinationChain: number,
    amount: string,
    finalityThreshold = 1000
  ) {
    const response = await apiClient.get('/bridge/cctp-fee', {
      params: {
        sourceChain,
        destinationChain,
        amount,
        finalityThreshold,
      },
    });

    return response.data as {
      sourceDomain: number;
      destinationDomain: number;
      finalityThreshold: number;
      minimumFeeBps: number;
      maxFee: string;
    };
  },

  async getCreateVaultPreflight() {
    const response = await apiClient.get('/vaults/preflight');
    return response.data as {
      arcSettlement: {
        ready: boolean;
        reason: string | null;
      };
    };
  },

  // Create new vault
  async createVault(
    amount: string,
    duration: number,
    sourceChain: number,
    destChain: number,
    bridgeProtocol: 'CCTP',
    tokenAddress: string,
    vaultType: 'FIXED' | 'FLEXIBLE',
    ownerAddress?: string,
    sourceTxHash?: string,
    cctpBurnAmount?: string,
    cctpMaxFeeAmount?: string,
    cctpFinalityThreshold?: number
  ) {
    const response = await apiClient.post('/vaults/create', {
      amount,
      customDuration: duration,
      sourceChain,
      destinationChain: destChain,
      bridgeProtocol,
      tokenAddress,
      vaultType,
      ownerAddress,
      sourceTxHash,
      cctpBurnAmount,
      cctpMaxFeeAmount,
      cctpFinalityThreshold,
    });
    return response.data;
  },

  // Get single vault
  async getVault(vaultId: string): Promise<Vault> {
    const response = await apiClient.get(`/vaults/${vaultId}`);
    const vault = response.data;
    return {
      ...toCamelCaseVault(vault),
      deposits: (vault.deposits ?? []).map((deposit: any) => ({
        amount: String(deposit.amount ?? '0'),
        depositedAt: Math.floor(new Date(deposit.deposited_at ?? deposit.depositedAt).getTime() / 1000),
        sourceChain: Number(deposit.source_chain ?? deposit.sourceChain ?? 0),
        bridgeTxHash: deposit.bridge_tx_hash ?? deposit.bridgeTxHash ?? undefined,
      })),
      bridgeTransactions: (vault.bridgeTransactions ?? []).map(toCamelCaseBridgeTx),
    } as Vault;
  },

  // Get user's vaults
  async getUserVaults(userAddress: string): Promise<Vault[]> {
    const response = await apiClient.get(`/users/${userAddress}`);
    return (response.data.vaults ?? []).map(toCamelCaseVault);
  },

  // Add to existing vault
  async addToVault(
    vaultId: string,
    amount: string,
    sourceTxHash: string,
    ownerAddress?: string,
    cctpBurnAmount?: string,
    cctpMaxFeeAmount?: string,
    cctpFinalityThreshold?: number
  ) {
    const response = await apiClient.post(`/vaults/${vaultId}/add`, {
      amount,
      sourceTxHash,
      ownerAddress,
      cctpBurnAmount,
      cctpMaxFeeAmount,
      cctpFinalityThreshold,
    });
    return response.data;
  },

  // Claim mature vault
  async claimVault(
    vaultId: string,
    destinationChain: number,
    claimTxHash: string,
    bridgeBackTxHash?: string
  ) {
    const response = await apiClient.post(`/vaults/${vaultId}/claim`, {
      destinationChain,
      claimTxHash,
      bridgeBackTxHash,
    });
    return response.data;
  },

  // Withdraw from flexible vault
  async withdrawFlexible(
    vaultId: string,
    amount: string,
    withdrawTxHash: string,
    destinationChain: number,
    bridgeBackTxHash?: string
  ) {
    const response = await apiClient.post(`/vaults/${vaultId}/withdraw`, {
      amount,
      withdrawTxHash,
      destinationChain,
      bridgeBackTxHash,
    });
    return response.data;
  },

  // Get bridge status
  async getBridgeStatus(txHash: string): Promise<BridgeTransaction> {
    const response = await apiClient.get(`/bridge/status/${txHash}`);
    return toCamelCaseBridgeTx(response.data);
  },

  // Retry failed bridge
  async retryBridge(vaultId: string) {
    const response = await apiClient.post(`/bridge-retry/${vaultId}`);
    return response.data;
  },
};
