export type VaultType = 'FIXED' | 'FLEXIBLE';
export type VaultStatus = 'ACTIVE' | 'MATURE' | 'CLAIMED' | 'FAILED';
export type BridgeProtocol = 'CCTP';

export interface Vault {
  vaultId: string;
  owner: string;
  totalAmount: string;
  createdAt: number;
  unlockAt: number;
  sourceChain: number;
  destinationChain?: number;
  bridgeProtocol: BridgeProtocol;
  tokenAddress: string;
  vaultType: VaultType;
  status: VaultStatus;
  bridgeTxHash?: string;
  createdOnChainTx?: string;
  claimed_tx_hash?: string;
  deposits?: Deposit[];
  bridgeTransactions?: BridgeTransaction[];
  is_split?: boolean;
  is_streaming?: boolean;
  splitAllocation?: SplitAllocation | null;
  streamingAllocation?: StreamingAllocation | null;
}

export interface SplitAllocation {
  savingsBps: number;
  yieldBps: number;
  reserveBps: number;
  buckets: {
    savings: { amount: number; claimed: boolean };
    yield: { amount: number; claimed: boolean };
    reserve: { amount: number; claimed: boolean };
  };
}

export interface StreamingTranche {
  index: number;
  amount: number;
  maturesAt: number;
  matured: boolean;
  claimed: boolean;
}

export interface StreamingAllocation {
  numTranches: number;
  intervalSeconds: number;
  claimedTranches: number;
  maturedTranches: number;
  perTranche: number;
  tranches: StreamingTranche[];
}

export interface Deposit {
  amount: string;
  depositedAt: number;
  sourceChain: number;
  bridgeTxHash?: string;
}

export interface User {
  address: string;
  email?: string;
  authId: string;
  createdAt: string;
  lastLogin?: string;
}

export interface BridgeTransaction {
  txHash: string;
  vaultId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  fromChain: number;
  toChain: number;
  amount: string;
  bridgeProtocol: BridgeProtocol;
  tokenAddress?: string;
  status: 'PENDING' | 'COMPLETE' | 'FAILED';
  createdAt: string;
  completedAt?: string;
  retryCount: number;
  attestationData?: string;
}

export interface ProofOfReserves {
  totalLocked: string;
  byChain: Record<number, string>;
  byToken: Record<string, string>;
  totalVaults: number;
  totalUsers: number;
  totalClaimed?: string;
  verified: boolean;
  verificationDetails: {
    timeLockVaultBalance: string;
    userLiabilities: string;
    match: boolean;
  };
  source?: 'on-chain' | 'database' | 'database-fallback';
  contracts?: {
    arcChainId: number;
    explorerBaseUrl: string;
    usdc?: string;
    timeLockVault?: string;
    vaultFactory?: string;
    bridgeOrchestrator?: string;
    treasury?: string;
    proofOfReserves?: string;
    links?: Record<string, string>;
  };
  onChain?: {
    proofContractTotalLocked?: string;
    proofContractTotalVaults?: number;
    proofContractTotalUsers?: number;
    proofContractVerified?: boolean;
    timeLockVaultBalance?: string;
    error?: string;
  };
  updatedAt: string;
}

export interface GasEstimate {
  bridgeFee: string;
  protocolFee: string;
  finalAmount: string;
  loading: boolean;
}

export interface ChainConfig {
  id: number;
  name: string;
  rpc: string;
  explorer: string;
  usdc: string;
  cctpDomain?: number;
  cctpTokenMessenger?: string;
  cctpMessageTransmitter?: string;
}
