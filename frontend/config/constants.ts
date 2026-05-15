// Duration options (in milliseconds)
export const DURATION_PRESETS = [
  { label: '5 minutes', value: 5 * 60 * 1000 },
  { label: '30 minutes', value: 30 * 60 * 1000 },
  { label: '1 hour', value: 60 * 60 * 1000 },
  { label: '1 day', value: 24 * 60 * 60 * 1000 },
  { label: '7 days', value: 7 * 24 * 60 * 60 * 1000 },
  { label: '30 days', value: 30 * 24 * 60 * 60 * 1000 },
  { label: '90 days', value: 90 * 24 * 60 * 60 * 1000 },
  { label: '1 year', value: 365 * 24 * 60 * 60 * 1000 },
];

// Vault constraints
export const MIN_DURATION = 5 * 60 * 1000; // 5 minutes (test mode)
export const MAX_DURATION = 365 * 24 * 60 * 60 * 1000; // 12 months

// Fees
export const FLEXIBLE_EARLY_WITHDRAWAL_PENALTY = 0.005; // 0.5%
export const PROTOCOL_FEE_PERCENTAGE = 0; // Will be added if needed

// UI
export const COUNTDOWN_UPDATE_INTERVAL = 1000; // 1 second
export const PROOF_OF_RESERVES_CACHE_TIME = 5 * 60 * 1000; // 5 minutes

// API
export const API_TIMEOUT = 90000; // 90 seconds
export const RETRY_ATTEMPTS = 3;
export const RETRY_DELAY = 1000; // 1 second

// Contract addresses (will be loaded from env)
export const CONTRACT_ADDRESSES = {
  TIMELOCK_VAULT: process.env.NEXT_PUBLIC_TIMELOCK_VAULT || '',
};
