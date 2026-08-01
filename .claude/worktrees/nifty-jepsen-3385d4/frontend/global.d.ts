declare module '*.css';

type EthereumRequestArgs = {
  method: string;
  params?: unknown[] | Record<string, unknown>;
};

interface EthereumProvider {
  request<T = unknown>(args: EthereumRequestArgs): Promise<T>;
  on?: (event: string, listener: (...args: any[]) => void) => void;
  removeListener?: (event: string, listener: (...args: any[]) => void) => void;
  isMetaMask?: boolean;
}

interface Window {
  ethereum?: EthereumProvider;
}
