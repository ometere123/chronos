import { decodeFunctionResult, encodeFunctionData } from 'viem';

export const ZERO_BYTES32 = `0x${'0'.repeat(64)}` as const;
export const CCTP_FAST_FINALITY_THRESHOLD = 1000;
export const CCTP_STANDARD_FINALITY_THRESHOLD = 2000;

export const ERC20_APPROVE_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export const ERC20_ALLOWANCE_ABI = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export const CCTP_TOKEN_MESSENGER_ABI = [
  {
    type: 'function',
    name: 'depositForBurn',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
      { name: 'destinationCaller', type: 'bytes32' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint32' },
    ],
    outputs: [{ name: 'nonce', type: 'uint64' }],
  },
  {
    type: 'function',
    name: 'getMinFeeAmount',
    stateMutability: 'view',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export const TIMELOCK_VAULT_ABI = [
  {
    type: 'function',
    name: 'claimVault',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'vaultId', type: 'bytes32' },
      { name: 'destinationChain', type: 'uint32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdrawFlexible',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'vaultId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

export function toBytes32Address(address: string) {
  return `0x${address.replace(/^0x/, '').toLowerCase().padStart(64, '0')}` as `0x${string}`;
}

export function getTransactionErrorMessage(error: any, fallback = 'Transaction failed') {
  if (typeof error === 'string') return error;

  if (error?.code === 4001) {
    return 'Transaction rejected in wallet.';
  }

  return (
    error?.response?.data?.error?.message ||
    error?.shortMessage ||
    error?.details ||
    error?.data?.message ||
    error?.error?.message ||
    error?.message ||
    fallback
  );
}

export function getTransactionErrorLog(error: any, fallback = 'Transaction failed') {
  return {
    message: getTransactionErrorMessage(error, fallback),
    name: error?.name,
    code: error?.code,
    reason: error?.reason,
    details: error?.details,
    shortMessage: error?.shortMessage,
    response: error?.response?.data,
    data: error?.data,
    stack: error?.stack,
  };
}

export async function waitForTransactionReceipt(
  walletProvider: EthereumProvider,
  hash: `0x${string}`,
  label: string,
  timeoutMs = 120000,
  pollMs = 3000
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const receipt = await walletProvider.request<any>({
      method: 'eth_getTransactionReceipt',
      params: [hash],
    });

    if (receipt) {
      if (receipt.status && receipt.status !== '0x1') {
        throw new Error(`${label} transaction failed on-chain.`);
      }
      return receipt;
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(`Timed out waiting for ${label} confirmation.`);
}

export async function simulateTransaction(
  walletProvider: EthereumProvider,
  tx: Record<string, string>,
  label: string
) {
  try {
    await walletProvider.request({
      method: 'eth_estimateGas',
      params: [tx],
    });
  } catch (error) {
    const message = getTransactionErrorMessage(error, `${label} failed`);
    throw new Error(`${label} simulation failed: ${message}`);
  }
}

export async function getWalletChainId(walletProvider: EthereumProvider) {
  const chainId = (await walletProvider.request({
    method: 'eth_chainId',
  })) as string;

  return Number.parseInt(chainId, 16);
}

export async function waitForWalletChain(
  walletProvider: EthereumProvider,
  expectedChainId: number,
  chainName: string,
  timeoutMs = 20000,
  pollMs = 500
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const currentChainId = await getWalletChainId(walletProvider);
    if (currentChainId === expectedChainId) {
      return currentChainId;
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  const currentChainId = await getWalletChainId(walletProvider);
  throw new Error(
    `Wallet is still on chain ${currentChainId}. Switch to ${chainName} (${expectedChainId}) and retry.`
  );
}

export async function assertContractCode(
  walletProvider: EthereumProvider,
  address: `0x${string}`,
  label: string
) {
  const code = (await walletProvider.request({
    method: 'eth_getCode',
    params: [address, 'latest'],
  })) as `0x${string}`;

  if (!code || code === '0x') {
    throw new Error(`${label} is not deployed on the currently selected wallet network.`);
  }

  return code;
}

export async function getCctpMaxFeeAmount(
  walletProvider: EthereumProvider,
  activeAddress: string,
  cctpTokenMessenger: `0x${string}`,
  amountInTokenUnits: bigint
) {
  const feeCallData = encodeFunctionData({
    abi: CCTP_TOKEN_MESSENGER_ABI,
    functionName: 'getMinFeeAmount',
    args: [amountInTokenUnits],
  });

  try {
    const feeResult = (await walletProvider.request({
      method: 'eth_call',
      params: [
        {
          from: activeAddress,
          to: cctpTokenMessenger,
          data: feeCallData,
        },
        'latest',
      ],
    })) as `0x${string}`;

    const feeAmount = decodeFunctionResult({
      abi: CCTP_TOKEN_MESSENGER_ABI,
      functionName: 'getMinFeeAmount',
      data: feeResult,
    });

    return feeAmount;
  } catch (error) {
    console.warn(
      '[wallet] CCTP getMinFeeAmount unavailable; using standard transfer maxFee=0.',
      getTransactionErrorLog(error, 'Could not load CCTP min fee')
    );
    return 0n;
  }
}

export async function getErc20Allowance(
  walletProvider: EthereumProvider,
  owner: string,
  tokenAddress: `0x${string}`,
  spender: `0x${string}`
) {
  await assertContractCode(walletProvider, tokenAddress, `USDC contract ${tokenAddress}`);

  const data = encodeFunctionData({
    abi: ERC20_ALLOWANCE_ABI,
    functionName: 'allowance',
    args: [owner as `0x${string}`, spender],
  });

  const result = (await walletProvider.request({
    method: 'eth_call',
    params: [
      {
        from: owner,
        to: tokenAddress,
        data,
      },
      'latest',
    ],
  })) as `0x${string}`;

  if (!result || result === '0x') {
    throw new Error(
      `USDC allowance returned empty data. Confirm your wallet is on the selected source chain and retry.`
    );
  }

  return decodeFunctionResult({
    abi: ERC20_ALLOWANCE_ABI,
    functionName: 'allowance',
    data: result,
  });
}

export async function waitForErc20Allowance(
  walletProvider: EthereumProvider,
  owner: string,
  tokenAddress: `0x${string}`,
  spender: `0x${string}`,
  requiredAmount: bigint,
  timeoutMs = 45000,
  pollMs = 2500
) {
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const allowance = await getErc20Allowance(walletProvider, owner, tokenAddress, spender);
      if (allowance >= requiredAmount) {
        return allowance;
      }
    } catch (error: any) {
      lastError = error;
      if (/not deployed on the currently selected wallet network/i.test(error?.message || '')) {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  if (lastError) {
    throw new Error(`Timed out waiting for ERC-20 allowance to update on-chain. Last read error: ${getTransactionErrorMessage(lastError)}`);
  }

  throw new Error('Timed out waiting for ERC-20 allowance to update on-chain.');
}
