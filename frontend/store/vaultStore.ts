import { create } from 'zustand';
import { Vault } from '../types';

interface VaultState {
  selectedVault: Vault | null;
  vaults: Vault[];
  isLoading: boolean;
  error: string | null;

  setSelectedVault: (vault: Vault | null) => void;
  setVaults: (vaults: Vault[]) => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearSelectedVault: () => void;
  reset: () => void;
}

export const useVaultStore = create<VaultState>((set) => ({
  selectedVault: null,
  vaults: [],
  isLoading: false,
  error: null,

  setSelectedVault: (vault) => set({ selectedVault: vault }),
  setVaults: (vaults) => set({ vaults }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  clearSelectedVault: () => set({ selectedVault: null }),

  reset: () => set({
    selectedVault: null,
    vaults: [],
    isLoading: false,
    error: null,
  }),
}));
