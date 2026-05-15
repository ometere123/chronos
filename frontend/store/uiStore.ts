import { create } from 'zustand';

export interface Notification {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
}

interface UIState {
  isCreateVaultOpen: boolean;
  isAddToVaultOpen: boolean;
  isClaimVaultOpen: boolean;
  isWithdrawOpen: boolean;
  notifications: Notification[];

  setCreateVaultOpen: (open: boolean) => void;
  setAddToVaultOpen: (open: boolean) => void;
  setClaimVaultOpen: (open: boolean) => void;
  setWithdrawOpen: (open: boolean) => void;

  showNotification: (message: string, type: 'success' | 'error' | 'info' | 'warning', duration?: number) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  isCreateVaultOpen: false,
  isAddToVaultOpen: false,
  isClaimVaultOpen: false,
  isWithdrawOpen: false,
  notifications: [],

  setCreateVaultOpen: (open) => set({ isCreateVaultOpen: open }),
  setAddToVaultOpen: (open) => set({ isAddToVaultOpen: open }),
  setClaimVaultOpen: (open) => set({ isClaimVaultOpen: open }),
  setWithdrawOpen: (open) => set({ isWithdrawOpen: open }),

  showNotification: (message, type, duration = 5000) => set((state) => ({
    notifications: [
      ...state.notifications,
      {
        id: `${Date.now()}-${Math.random()}`,
        message,
        type,
        duration,
      },
    ],
  })),

  removeNotification: (id) => set((state) => ({
    notifications: state.notifications.filter((n) => n.id !== id),
  })),

  clearNotifications: () => set({ notifications: [] }),
}));
