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

// Contract addresses (will be loaded from env). Oracle/treasury/scheduled-payment addresses fall
// back to the addresses recorded in the repo root .env.local (ARC_MOCK_PRICE_ORACLE_ADDRESS,
// ARC_BAND_ORACLE_ADAPTER_ADDRESS, ARC_TREASURY_ADDRESS, ARC_SCHEDULED_PAYMENT_ADDRESS) since no
// frontend/.env.local exists in this checkout to source NEXT_PUBLIC_* overrides from - set the
// NEXT_PUBLIC_* env vars in deployment to override without a rebuild-time constant change.
export const CONTRACT_ADDRESSES = {
  TIMELOCK_VAULT: process.env.NEXT_PUBLIC_TIMELOCK_VAULT || '',
  MOCK_PRICE_ORACLE: process.env.NEXT_PUBLIC_MOCK_PRICE_ORACLE || '0xe21cc82362f03df8782ec3507b3ee1468d8dec7b',
  BAND_ORACLE_ADAPTER: process.env.NEXT_PUBLIC_BAND_ORACLE_ADAPTER || '0x0ebf76abc6cb74f67591da08f51b9f6b1e5cd401',
  TREASURY: process.env.NEXT_PUBLIC_TREASURY || '0xba45817143a6297e0b38e8155c8e7540d235592b',
  SCHEDULED_PAYMENT: process.env.NEXT_PUBLIC_SCHEDULED_PAYMENT || '0xb3ce025ada67ca2583ddc1253b667cf70c03a5fd',
  CREDIT_LINE: process.env.NEXT_PUBLIC_CREDIT_LINE || '0x54b4F513bf4607f23867721a5576b9B0CCcEb405',
};
