import apiClient from './api';

export interface CreditLinePoolStats {
  availableLiquidity: string;
  totalBorrowed: string;
  totalPool: string;
  totalLpShares: string;
  utilizationBps: number;
  interestBps: number;
  maxLtvBps: number;
}

export interface CreditLineVaultStatus {
  vaultId: string;
  hasActiveLoan: boolean;
  locked: boolean;
  borrower: string | null;
  principal: string;
  collateralValue: string;
  interestOwed: string;
  totalOwed: string;
  maxBorrowable: string;
  ltvBps: number;
  startTime: number | null;
}

export interface CreditLineLenderPosition {
  address: string;
  shares: string;
  pendingInterest: string;
}

export const creditLineService = {
  async getPoolStats(): Promise<CreditLinePoolStats> {
    const response = await apiClient.get('/credit-line/pool');
    return response.data;
  },

  async getVaultStatus(vaultId: string): Promise<CreditLineVaultStatus> {
    const response = await apiClient.get(`/credit-line/vault/${vaultId}`);
    return response.data;
  },

  async getLenderPosition(address: string): Promise<CreditLineLenderPosition> {
    const response = await apiClient.get(`/credit-line/lender/${address}`);
    return response.data;
  },
};
