import axios, { AxiosInstance } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const apiClient: AxiosInstance = axios.create({
  baseURL: `${API_URL}/api`,
  timeout: 90000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor - attach CHRONOS wallet session token
apiClient.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('chronos_auth_token') : null;
  const walletAddress = typeof window !== 'undefined' ? localStorage.getItem('chronos_wallet_address') : null;

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  if (walletAddress) {
    config.headers['X-Wallet-Address'] = walletAddress;
  }

  return config;
});

// Response interceptor - handle errors
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Handle unauthorized
      if (typeof window !== 'undefined') {
        localStorage.removeItem('chronos_auth_token');
        localStorage.removeItem('chronos_wallet_address');
        window.location.href = '/';
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
