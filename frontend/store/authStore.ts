import { create } from 'zustand';
import { User } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;

  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  setIsConnected: (connected: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  logout: () => void;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isConnected: false,
  isLoading: false,
  error: null,

  setUser: (user) => set({ user, isConnected: !!user }),
  setToken: (token) => set({ token }),
  setIsConnected: (isConnected) => set({ isConnected }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  logout: () => set({ user: null, token: null, isConnected: false, error: null }),
  reset: () => set({
    user: null,
    token: null,
    isConnected: false,
    isLoading: false,
    error: null,
  }),
}));
