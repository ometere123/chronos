'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { decodeFunctionResult, encodeFunctionData, formatUnits, getAddress, parseUnits, zeroAddress } from 'viem';
import CountdownTimer from '@/components/ui/CountdownTimer';
import { ARC_CCTP_DOMAIN, ARC_CHAIN_ID, CHAINS, getChainName } from '@/config/chains';
import { CONTRACT_ADDRESSES } from '@/config/constants';
import { useWallet } from '@/hooks/useWallet';
import {
  CCTP_FAST_FINALITY_THRESHOLD,
  CCTP_STANDARD_FINALITY_THRESHOLD,
  CCTP_TOKEN_MESSENGER_ABI,
  CREDIT_LINE_ABI,
  ERC20_APPROVE_ABI,
  PRICE_ORACLE_ABI,
  SPLIT_BUCKET_INDEX,
  TIMELOCK_VAULT_ABI,
  TIMELOCK_VAULT_VIEW_ABI,
  ZERO_BYTES32,
  getTransactionErrorLog,
  getTransactionErrorMessage,
  publicMulticall,
  simulateTransaction,
  type Multicall3Call,
  toBytes32Address,
  waitForErc20Allowance,
  waitForTransactionReceipt,
  type SplitBucketName,
} from '@/lib/evm';
import apiClient from '@/services/api';
import { creditLineService } from '@/services/creditLineService';
import { vaultService } from '@/services/vaultService';
import { useUIStore } from '@/store/uiStore';
import type { BridgeTransaction, Vault } from '@/types';

const ZERO_ADDRESS = zeroAddress;
const TREASURY_BALANCE_ABI = [
  {
    type: 'function',
    name: 'getUsdcBalance',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

function parseBridgeMetadata(attestationData?: string) {
  if (!attestationData) {
    return null;
  }

  try {
    return JSON.parse(attestationData) as Record<string, any>;
  } catch {
    return null;
  }
}

function hasConfirmedRecipientMismatch(metadata: Record<string, any> | null) {
  return metadata?.relayState === 'RECIPIENT_MISMATCH' && Boolean(metadata.actualMintRecipient);
}

function isRetryableRecipientDecodeFailure(metadata: Record<string, any> | null) {
  return metadata?.relayState === 'RECIPIENT_MISMATCH' && !metadata.actualMintRecipient;
}

function isRelayComplete(tx: { status: string }, metadata: Record<string, any> | null) {
  return tx.status === 'COMPLETE' && metadata?.relayState === 'COMPLETE';
}

function parseUsdAmount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatUsdAmount(value: number) {
  return `$${Math.max(value, 0).toFixed(2)}`;
}

function hasCctpDomain(chainId: number) {
  return typeof CHAINS[chainId]?.cctpDomain === 'number';
}

function getBridgeMetadataType(tx: BridgeTransaction) {
  return parseBridgeMetadata(tx.attestationData)?.type;
}

function getGrossWithdrawalAmount(tx: BridgeTransaction) {
  const metadata = parseBridgeMetadata(tx.attestationData);
  return parseUsdAmount(tx.amount) + parseUsdAmount(metadata?.penalty);
}

function getLifecycleKind(tx: BridgeTransaction) {
  const metadataType = getBridgeMetadataType(tx);

  if (metadataType === 'ADD_TO_VAULT') return 'ADD_FUNDS';
  if (metadataType === 'FLEXIBLE_WITHDRAWAL' || metadataType === 'FLEXIBLE_WITHDRAWAL_RETURN') {
    return 'EARLY_WITHDRAWAL';
  }
  if (metadataType === 'ARC_DIRECT_CLAIM' || metadataType === 'CCTP_RETURN_TO_SOURCE') {
    return 'MATURE_CLAIM';
  }
  if (tx.direction === 'INBOUND') return 'INITIAL_DEPOSIT';

  return 'MATURE_CLAIM';
}

function getLifecycleLabel(tx: BridgeTransaction) {
  const kind = getLifecycleKind(tx);

  if (kind === 'ADD_FUNDS') return 'Add Funds';
  if (kind === 'EARLY_WITHDRAWAL') return 'Early Withdrawal';
  if (kind === 'MATURE_CLAIM') return 'Mature Claim';
  return 'Initial Deposit';
}

function getLifecycleAmount(tx: BridgeTransaction) {
  return getLifecycleKind(tx) === 'EARLY_WITHDRAWAL'
    ? getGrossWithdrawalAmount(tx)
    : parseUsdAmount(tx.amount);
}

function getLifecycleDetail(tx: BridgeTransaction) {
  const metadata = parseBridgeMetadata(tx.attestationData);
  const kind = getLifecycleKind(tx);
  const route = `${getChainName(tx.fromChain)} to ${getChainName(tx.toChain)}`;

  if (kind === 'EARLY_WITHDRAWAL') {
    const penalty = parseUsdAmount(metadata?.penalty);
    const received = parseUsdAmount(tx.amount);
    return `${route} - received ${formatUsdAmount(received)}${penalty > 0 ? `, penalty ${formatUsdAmount(penalty)}` : ''}`;
  }

  if (kind === 'MATURE_CLAIM') {
    return tx.toChain === ARC_CHAIN_ID ? 'Claimed on Arc Testnet' : `Claimed to ${getChainName(tx.toChain)}`;
  }

  return route;
}

function buildVaultLifecycle(vault?: Vault) {
  const bridgeTransactions = vault?.bridgeTransactions ?? [];
  const relevantTransactions = bridgeTransactions.filter((tx) => tx.status !== 'FAILED');
  const deposited = relevantTransactions
    .filter((tx) => tx.direction === 'INBOUND')
    .reduce((sum, tx) => sum + parseUsdAmount(tx.amount), 0);
  const initialDeposited = relevantTransactions
    .filter((tx) => tx.direction === 'INBOUND' && getLifecycleKind(tx) === 'INITIAL_DEPOSIT')
    .reduce((sum, tx) => sum + parseUsdAmount(tx.amount), 0);
  const addedFunds = relevantTransactions
    .filter((tx) => getLifecycleKind(tx) === 'ADD_FUNDS')
    .reduce((sum, tx) => sum + parseUsdAmount(tx.amount), 0);
  const earlyWithdrawn = relevantTransactions
    .filter((tx) => getLifecycleKind(tx) === 'EARLY_WITHDRAWAL')
    .reduce((sum, tx) => sum + getGrossWithdrawalAmount(tx), 0);
  const penalties = relevantTransactions
    .filter((tx) => getLifecycleKind(tx) === 'EARLY_WITHDRAWAL')
    .reduce((sum, tx) => sum + parseUsdAmount(parseBridgeMetadata(tx.attestationData)?.penalty), 0);
  const maturedClaimed = relevantTransactions
    .filter((tx) => getLifecycleKind(tx) === 'MATURE_CLAIM')
    .reduce((sum, tx) => sum + parseUsdAmount(tx.amount), 0);
  const fallbackCurrent = parseUsdAmount(vault?.totalAmount);
  const currentLocked = vault?.status === 'CLAIMED'
    ? 0
    : relevantTransactions.length > 0
      ? Math.max(deposited - earlyWithdrawn - maturedClaimed, 0)
      : fallbackCurrent;
  const timeline = [...relevantTransactions]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((tx) => ({
      tx,
      label: getLifecycleLabel(tx),
      amount: getLifecycleAmount(tx),
      detail: getLifecycleDetail(tx),
    }));

  return {
    deposited,
    initialDeposited,
    addedFunds,
    earlyWithdrawn,
    penalties,
    maturedClaimed,
    currentLocked,
    timeline,
  };
}

async function getCctpBurnSettings(
  sourceChain: number,
  destinationChain: number,
  amount: string,
  label: string
) {
  try {
    const quote = await vaultService.getCctpTransferFee(
      sourceChain,
      destinationChain,
      amount,
      CCTP_FAST_FINALITY_THRESHOLD
    );

    return {
      maxFeeAmount: BigInt(quote.maxFee || '0'),
      finalityThreshold: quote.finalityThreshold || CCTP_FAST_FINALITY_THRESHOLD,
    };
  } catch (error) {
    console.warn(`[${label}] CCTP fast fee quote unavailable; using standard finality.`, error);
    return {
      maxFeeAmount: 0n,
      finalityThreshold: CCTP_STANDARD_FINALITY_THRESHOLD,
    };
  }
}

export default function VaultDetailsPage() {
  const params = useParams<{ vaultId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const vaultId = params.vaultId;
  const { showNotification } = useUIStore();
  const { address, getProvider, connect, switchChain } = useWallet();

  const [addAmount, setAddAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [borrowAmount, setBorrowAmount] = useState('');
  const [destChain, setDestChain] = useState(String(ARC_CHAIN_ID));
  const [withdrawDestinationChain, setWithdrawDestinationChain] = useState(String(ARC_CHAIN_ID));
  const [showCreatedBanner, setShowCreatedBanner] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<'idle' | 'copied'>('idle');
  const [isRevealed, setIsRevealed] = useState(false);
  const [claimStatusMessage, setClaimStatusMessage] = useState('');

  useEffect(() => {
    const wasCreated = searchParams.get('created') === '1';
    if (!wasCreated) {
      return;
    }

    setShowCreatedBanner(true);
    const revealTimer = requestAnimationFrame(() => setIsRevealed(true));
    const timer = setTimeout(() => setShowCreatedBanner(false), 4500);
    return () => {
      cancelAnimationFrame(revealTimer);
      clearTimeout(timer);
    };
  }, [searchParams]);

  const { data: vault, isLoading, error } = useQuery({
    queryKey: ['vault', vaultId],
    queryFn: () => vaultService.getVault(vaultId),
    enabled: !!vaultId,
    refetchInterval: 5000,
  });

  // Live on-chain read of the oracle-gated/treasury-guard unlock condition (Item 5/6) and the
  // agent-delegate status (Item 14/15), read directly from TimeLockVault + oracle contracts via
  // a public RPC call - independent of whether a wallet is connected.
  const { data: onChainInfo } = useQuery({
    queryKey: ['vaultOnChainCondition', vaultId],
    queryFn: async () => {
      const rpcUrl = CHAINS[ARC_CHAIN_ID].rpc;
      const timelockVaultAddress = getAddress(CONTRACT_ADDRESSES.TIMELOCK_VAULT);

      // Batch getVault/vaultDelegate/agentFeeBps into ONE eth_call via Multicall3 (deployed on
      // Arc Testnet at the standard deterministic address) instead of 3 sequential requests -
      // Arc's public RPC is rate-limited enough that every extra round-trip is another chance to
      // hit it, and this cuts the common case (no condition set) from up to 5 requests to 1.
      const [getVaultRes, delegateRes, feeRes] = await publicMulticall(rpcUrl, [
        {
          target: timelockVaultAddress,
          allowFailure: false,
          callData: encodeFunctionData({ abi: TIMELOCK_VAULT_VIEW_ABI, functionName: 'getVault', args: [vaultId as `0x${string}`] }),
        },
        {
          target: timelockVaultAddress,
          allowFailure: false,
          callData: encodeFunctionData({ abi: TIMELOCK_VAULT_VIEW_ABI, functionName: 'vaultDelegate', args: [vaultId as `0x${string}`] }),
        },
        {
          target: timelockVaultAddress,
          allowFailure: false,
          callData: encodeFunctionData({ abi: TIMELOCK_VAULT_VIEW_ABI, functionName: 'agentFeeBps', args: [] }),
        },
      ]);

      const onChainVault = decodeFunctionResult({ abi: TIMELOCK_VAULT_VIEW_ABI, functionName: 'getVault', data: getVaultRes.returnData });
      const delegate = decodeFunctionResult({ abi: TIMELOCK_VAULT_VIEW_ABI, functionName: 'vaultDelegate', data: delegateRes.returnData });
      const agentFeeBps = decodeFunctionResult({ abi: TIMELOCK_VAULT_VIEW_ABI, functionName: 'agentFeeBps', data: feeRes.returnData });

      const hasOracle = onChainVault.conditionOracle && onChainVault.conditionOracle.toLowerCase() !== ZERO_ADDRESS;
      const hasTreasuryCheck = onChainVault.treasuryBalanceCheck && onChainVault.treasuryBalanceCheck.toLowerCase() !== ZERO_ADDRESS;

      let oraclePrice: bigint | null = null;
      let treasuryBalance: bigint | null = null;

      if (hasOracle || hasTreasuryCheck) {
        // Second batched call for the condition-specific reads - only needed for conditioned
        // vaults, which are the minority case.
        const conditionCalls: Multicall3Call[] = [];
        if (hasOracle) {
          conditionCalls.push({
            target: onChainVault.conditionOracle,
            allowFailure: false,
            callData: encodeFunctionData({ abi: PRICE_ORACLE_ABI, functionName: 'getPrice', args: [] }),
          });
        }
        if (hasTreasuryCheck) {
          conditionCalls.push({
            target: onChainVault.treasuryBalanceCheck,
            allowFailure: false,
            callData: encodeFunctionData({ abi: TREASURY_BALANCE_ABI, functionName: 'getUsdcBalance', args: [] }),
          });
        }

        const conditionResults = await publicMulticall(rpcUrl, conditionCalls);
        let i = 0;
        if (hasOracle) {
          oraclePrice = decodeFunctionResult({ abi: PRICE_ORACLE_ABI, functionName: 'getPrice', data: conditionResults[i].returnData }) as bigint;
          i += 1;
        }
        if (hasTreasuryCheck) {
          treasuryBalance = decodeFunctionResult({ abi: TREASURY_BALANCE_ABI, functionName: 'getUsdcBalance', data: conditionResults[i].returnData }) as bigint;
        }
      }

      return { vault: onChainVault, delegate: delegate as string, agentFeeBps: Number(agentFeeBps), oraclePrice, treasuryBalance };
    },
    enabled: !!vaultId && !!CONTRACT_ADDRESSES.TIMELOCK_VAULT,
    refetchInterval: 15000,
    retry: 3,
    // This reads a public RPC directly, independent of the app's own network/auth state - don't
    // let React Query's onlineManager pause it.
    networkMode: 'always',
  });

  const { data: creditLineStatus } = useQuery({
    queryKey: ['creditLineVault', vaultId],
    queryFn: () => creditLineService.getVaultStatus(vaultId),
    enabled: !!vaultId && !!CONTRACT_ADDRESSES.CREDIT_LINE,
    refetchInterval: 10000,
    retry: false,
  });

  const { data: agentAddressData } = useQuery({
    queryKey: ['agentAddress'],
    queryFn: async () => {
      const response = await apiClient.get('/agent/address');
      return response.data as { address: string };
    },
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });

  const conditionOracleLabel = (address?: string) => {
    if (!address) return '';
    const lower = address.toLowerCase();
    if (lower === CONTRACT_ADDRESSES.MOCK_PRICE_ORACLE.toLowerCase()) return 'Mock Price Oracle';
    if (lower === CONTRACT_ADDRESSES.BAND_ORACLE_ADAPTER.toLowerCase()) return 'Band Protocol';
    return address;
  };

  const delegateMutation = useMutation({
    mutationFn: async (delegateAddress: string) => {
      const activeAddress = address?.toLowerCase();
      if (!activeAddress) {
        throw new Error('No wallet connected. Please connect your wallet first.');
      }

      const timelockVaultAddress = CONTRACT_ADDRESSES.TIMELOCK_VAULT;
      if (!timelockVaultAddress) {
        throw new Error('Arc TimeLockVault address is missing.');
      }

      const activeProvider = await getProvider();
      if (!activeProvider) {
        throw new Error('No wallet provider found.');
      }

      await switchChain(ARC_CHAIN_ID);

      const data = encodeFunctionData({
        abi: TIMELOCK_VAULT_ABI,
        functionName: 'setVaultDelegate',
        args: [vaultId as `0x${string}`, getAddress(delegateAddress)],
      });

      const tx = {
        from: activeAddress,
        to: getAddress(timelockVaultAddress),
        data,
        value: '0x0',
      } as const;

      await simulateTransaction(activeProvider, tx, 'Set vault delegate');
      const hash = (await activeProvider.request({
        method: 'eth_sendTransaction',
        params: [tx],
      })) as `0x${string}`;
      await waitForTransactionReceipt(activeProvider, hash, 'Set vault delegate');
      return hash;
    },
    onSuccess: async (_hash, delegateAddress) => {
      await queryClient.invalidateQueries({ queryKey: ['vaultOnChainCondition', vaultId] });
      showNotification(
        delegateAddress === ZERO_ADDRESS ? 'Agent delegate revoked.' : 'Vault delegated to the autonomous agent.',
        'success'
      );
    },
    onError: (error: any) => {
      const message = getTransactionErrorMessage(error, 'Failed to update vault delegate');
      console.error('[vault-delegate] Error:', getTransactionErrorLog(error, 'Failed to update vault delegate'));
      showNotification(message, 'error', 10000);
    },
  });

  useEffect(() => {
    if (!vault) {
      return;
    }

    if (vault.status === 'MATURE') {
      if (vault.bridgeProtocol === 'CCTP' && vault.sourceChain !== ARC_CHAIN_ID) {
        setDestChain(String(vault.sourceChain));
      } else {
        setDestChain(String(ARC_CHAIN_ID));
      }
    }

    if (vault.vaultType === 'FLEXIBLE') {
      if (vault.bridgeProtocol === 'CCTP' && vault.sourceChain !== ARC_CHAIN_ID) {
        setWithdrawDestinationChain(String(vault.sourceChain));
      } else {
        setWithdrawDestinationChain(String(ARC_CHAIN_ID));
      }
    }
  }, [vault]);

  const destinationChainLabel = useMemo(
    () => (vault ? getChainName(vault.destinationChain ?? vault.sourceChain) : ''),
    [vault]
  );

  const inboundRecipientMismatch = vault?.bridgeTransactions?.find((tx) => {
    if (tx.direction !== 'INBOUND' || tx.bridgeProtocol !== 'CCTP') {
      return false;
    }

    const metadata = parseBridgeMetadata(tx.attestationData);
    return hasConfirmedRecipientMismatch(metadata);
  });

  const inboundRecipientMismatchMetadata = useMemo(
    () => parseBridgeMetadata(inboundRecipientMismatch?.attestationData),
    [inboundRecipientMismatch?.attestationData]
  );

  const inboundFundingPending = !!vault?.bridgeTransactions?.some((tx) => {
    if (tx.direction !== 'INBOUND' || tx.bridgeProtocol !== 'CCTP') {
      return false;
    }

    const metadata = parseBridgeMetadata(tx.attestationData);
    if (isRelayComplete(tx, metadata)) {
      return false;
    }

    if (tx.status === 'FAILED') {
      return isRetryableRecipientDecodeFailure(metadata);
    }

    if (tx.status === 'PENDING') {
      return true;
    }

    if (!metadata) {
      return true;
    }

    return !metadata.destinationMintTxHash;
  });
  const inboundFundingMismatch = !!inboundRecipientMismatch;
  const inboundFundingBlocked = inboundFundingPending || inboundFundingMismatch;
  const canAddFunds =
    !!vault &&
    vault.status === 'ACTIVE' &&
    Math.floor(Date.now() / 1000) < vault.unlockAt &&
    vault.bridgeProtocol === 'CCTP' &&
    !!CHAINS[vault.sourceChain]?.cctpTokenMessenger &&
    !inboundFundingBlocked;

  const canBorrow =
    !!vault &&
    vault.status === 'ACTIVE' &&
    Math.floor(Date.now() / 1000) < vault.unlockAt &&
    !!CONTRACT_ADDRESSES.CREDIT_LINE &&
    !!creditLineStatus &&
    !creditLineStatus.hasActiveLoan &&
    !creditLineStatus.locked;

  const hasActiveLoan = !!creditLineStatus?.hasActiveLoan;
  const maxBorrowableAmount = parseFloat(creditLineStatus?.maxBorrowable || '0');

  const canClaimToSourceChain =
    !!vault &&
    vault.bridgeProtocol === 'CCTP' &&
    vault.sourceChain !== ARC_CHAIN_ID &&
    hasCctpDomain(vault.sourceChain);

  const latestOutboundBridge = vault?.bridgeTransactions?.find((tx) => tx.direction === 'OUTBOUND');
  const latestOutboundMetadata = useMemo(() => {
    if (!latestOutboundBridge?.attestationData) {
      return null;
    }

    try {
      return JSON.parse(latestOutboundBridge.attestationData);
    } catch {
      return null;
    }
  }, [latestOutboundBridge?.attestationData]);
  const claimedCardTitle =
    latestOutboundMetadata?.type === 'FLEXIBLE_WITHDRAWAL' ||
    latestOutboundMetadata?.type === 'FLEXIBLE_WITHDRAWAL_RETURN'
      ? 'Vault Closed'
      : 'Vault Claimed';
  const lifecycle = useMemo(() => buildVaultLifecycle(vault), [vault]);

  const claimMutation = useMutation({
    mutationFn: async () => {
      setClaimStatusMessage('Starting claim flow. Check your wallet for prompts.');
      showNotification('Starting claim flow. Check your wallet for prompts.', 'info', 8000);

      let activeAddress = address?.toLowerCase();
      if (!activeAddress) {
        setClaimStatusMessage('Connecting wallet...');
        connect();
      }

      if (!activeAddress) {
        throw new Error('No wallet connected. Please connect your wallet first.');
      }

      if (inboundFundingMismatch) {
        throw new Error('This vault was bridged to a previous Arc settlement address and cannot be claimed from the current deployment. Create a fresh vault with the latest contracts.');
      }

      if (inboundFundingPending) {
        throw new Error('This vault is still receiving its source-chain funds on Arc. Give the bridge a moment, then retry.');
      }

      const timelockVaultAddress = CONTRACT_ADDRESSES.TIMELOCK_VAULT;
      if (!timelockVaultAddress) {
        throw new Error('Arc TimeLockVault address is missing. Check NEXT_PUBLIC_TIMELOCK_VAULT in .env');
      }

      const activeProvider = await getProvider();
      if (!activeProvider) {
        throw new Error('No wallet provider found.');
      }

      setClaimStatusMessage('Switching wallet to Arc Testnet...');
      await switchChain(ARC_CHAIN_ID);

      const claimDestinationChain = parseInt(destChain, 10);
      const claimData = encodeFunctionData({
        abi: TIMELOCK_VAULT_ABI,
        functionName: 'claimVault',
        args: [vaultId as `0x${string}`, claimDestinationChain],
      });

      const claimTx = {
        from: activeAddress,
        to: getAddress(timelockVaultAddress),
        data: claimData,
        value: '0x0',
      } as const;

      setClaimStatusMessage('Checking whether the Arc claim transaction can run...');
      await simulateTransaction(activeProvider, claimTx, 'Vault claim');

      setClaimStatusMessage('Submitting Arc claim transaction. Confirm it in your wallet.');
      showNotification('Submitting Arc claim transaction...', 'info');
      const claimHash = (await activeProvider.request({
        method: 'eth_sendTransaction',
        params: [claimTx],
      })) as `0x${string}`;

      setClaimStatusMessage('Waiting for Arc claim confirmation...');
      await waitForTransactionReceipt(activeProvider, claimHash, 'Vault claim');

      if (claimDestinationChain === ARC_CHAIN_ID) {
        setClaimStatusMessage('Saving claim confirmation to backend...');
        return vaultService.claimVault(vaultId, claimDestinationChain, claimHash);
      }

      if (!vault) {
        throw new Error('Vault details are still loading.');
      }

      const arcConfig = CHAINS[ARC_CHAIN_ID];
      const sourceConfig = CHAINS[claimDestinationChain];
      if (!hasCctpDomain(claimDestinationChain)) {
        throw new Error('CCTP is not configured for the selected destination chain.');
      }
      const destinationDomain = sourceConfig.cctpDomain;
      if (typeof destinationDomain !== 'number') {
        throw new Error('CCTP is not configured for the selected destination chain.');
      }

      const arcUsdc = getAddress(arcConfig.usdc);
      const arcTokenMessenger = getAddress(arcConfig.cctpTokenMessenger || '');
      const claimAmountUnits = parseUnits(vault.totalAmount, 6);

      setClaimStatusMessage('Approving Arc USDC for bridge-back. Confirm it in your wallet.');
      showNotification('Approving Arc USDC for bridge-back...', 'info');
      const approveData = encodeFunctionData({
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [arcTokenMessenger, claimAmountUnits],
      });

      const approveTx = {
        from: activeAddress,
        to: arcUsdc,
        data: approveData,
        value: '0x0',
      } as const;

      await simulateTransaction(activeProvider, approveTx, 'Arc USDC approval');

      const approveHash = (await activeProvider.request({
        method: 'eth_sendTransaction',
        params: [approveTx],
      })) as `0x${string}`;

      await waitForTransactionReceipt(activeProvider, approveHash, 'Arc USDC approval');
      await waitForErc20Allowance(
        activeProvider,
        activeAddress,
        arcUsdc,
        arcTokenMessenger,
        claimAmountUnits
      );

      setClaimStatusMessage('Preparing CCTP bridge-back fee quote...');
      const { maxFeeAmount, finalityThreshold } = await getCctpBurnSettings(
        ARC_CHAIN_ID,
        claimDestinationChain,
        vault.totalAmount,
        'claim-vault'
      );

      setClaimStatusMessage(`Submitting bridge-back to ${getChainName(claimDestinationChain)}. Confirm it in your wallet.`);
      showNotification(`Bridging claimed USDC back to ${getChainName(claimDestinationChain)}...`, 'info');
      const bridgeBackData = encodeFunctionData({
        abi: CCTP_TOKEN_MESSENGER_ABI,
        functionName: 'depositForBurn',
        args: [
          claimAmountUnits,
          destinationDomain,
          toBytes32Address(getAddress(activeAddress)),
          arcUsdc,
          ZERO_BYTES32,
          maxFeeAmount,
          finalityThreshold,
        ],
      });

      const bridgeBackTx = {
        from: activeAddress,
        to: arcTokenMessenger,
        data: bridgeBackData,
        value: '0x0',
      } as const;

      await simulateTransaction(activeProvider, bridgeBackTx, 'CCTP bridge-back');

      const bridgeBackHash = (await activeProvider.request({
        method: 'eth_sendTransaction',
        params: [bridgeBackTx],
      })) as `0x${string}`;

      setClaimStatusMessage('Waiting for bridge-back burn confirmation...');
      await waitForTransactionReceipt(activeProvider, bridgeBackHash, 'CCTP bridge-back');

      setClaimStatusMessage('Saving claim and bridge-back details to backend...');
      return vaultService.claimVault(vaultId, claimDestinationChain, claimHash, bridgeBackHash);
    },
    onSuccess: async (data: any) => {
      setClaimStatusMessage('');
      await queryClient.invalidateQueries({ queryKey: ['vault', vaultId] });
      await queryClient.invalidateQueries({ queryKey: ['userVaults', address] });
      const selectedDestination = Number(data?.destinationChain ?? parseInt(destChain, 10));
      if (selectedDestination === ARC_CHAIN_ID) {
        showNotification('Vault claimed successfully on Arc!', 'success');
      } else if (data?.bridgeStatus?.state === 'COMPLETE') {
        showNotification(`Vault claimed and delivered to ${getChainName(selectedDestination)}.`, 'success');
      } else {
        showNotification(`Vault claimed. Bridge-back to ${getChainName(selectedDestination)} is in progress.`, 'success');
      }
    },
    onError: (error: any) => {
      const message = getTransactionErrorMessage(error, 'Failed to claim vault');
      console.error('[claim-vault] Error:', getTransactionErrorLog(error, 'Failed to claim vault'));
      setClaimStatusMessage(message);
      showNotification(message, 'error', 12000);
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!vault) {
        throw new Error('Vault details are still loading.');
      }

      let activeAddress = address?.toLowerCase();
      if (!activeAddress) {
        connect();
      }

      if (!activeAddress) {
        throw new Error('No wallet connected. Please connect your wallet first.');
      }

      if (inboundFundingMismatch) {
        throw new Error('This vault was bridged to a previous Arc settlement address and cannot accept new deposits on the current deployment. Create a fresh vault instead.');
      }

      if (vault.bridgeProtocol !== 'CCTP') {
        throw new Error('Additional deposits are currently supported for CCTP vaults only.');
      }

      const preflight = await vaultService.getCreateVaultPreflight();
      if (!preflight.arcSettlement.ready) {
        throw new Error(preflight.arcSettlement.reason || 'Arc settlement is not ready.');
      }

      const activeProvider = await getProvider();
      if (!activeProvider) {
        throw new Error('No wallet provider found.');
      }

      const sourceConfig = CHAINS[vault.sourceChain];
      const timelockVaultAddress = CONTRACT_ADDRESSES.TIMELOCK_VAULT;

      if (!sourceConfig?.cctpTokenMessenger) {
        throw new Error('CCTP is not configured for this vault source chain.');
      }

      if (!timelockVaultAddress) {
        throw new Error('Destination vault contract address is missing. Check NEXT_PUBLIC_TIMELOCK_VAULT in .env');
      }

      const tokenAddress = getAddress(sourceConfig.usdc);
      const cctpTokenMessenger = getAddress(sourceConfig.cctpTokenMessenger);
      const normalizedTimelockVault = getAddress(timelockVaultAddress);
      const lockAmountUnits = parseUnits(addAmount, 6);
      const mintRecipient = toBytes32Address(normalizedTimelockVault);

      const { maxFeeAmount, finalityThreshold } = await getCctpBurnSettings(
        vault.sourceChain,
        ARC_CHAIN_ID,
        addAmount,
        'add-to-vault'
      );
      const burnAmountUnits = lockAmountUnits + maxFeeAmount;
      const burnAmount = formatUnits(burnAmountUnits, 6);

      await switchChain(vault.sourceChain);

      showNotification('Approving USDC on the source chain...', 'info');
      const approveData = encodeFunctionData({
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [cctpTokenMessenger, burnAmountUnits],
      });

      const approveTx = {
        from: activeAddress,
        to: tokenAddress,
        data: approveData,
        value: '0x0',
      } as const;

      await simulateTransaction(activeProvider, approveTx, 'USDC approval');

      const approveHash = (await activeProvider.request({
        method: 'eth_sendTransaction',
        params: [approveTx],
      })) as `0x${string}`;

      await waitForTransactionReceipt(activeProvider, approveHash, 'USDC approval');
      await waitForErc20Allowance(
        activeProvider,
        activeAddress,
        tokenAddress,
        cctpTokenMessenger,
        burnAmountUnits
      );

      showNotification('Submitting CCTP top-up transaction...', 'info');
      const burnData = encodeFunctionData({
        abi: CCTP_TOKEN_MESSENGER_ABI,
        functionName: 'depositForBurn',
        args: [
          burnAmountUnits,
          ARC_CCTP_DOMAIN,
          mintRecipient,
          tokenAddress,
          ZERO_BYTES32,
          maxFeeAmount,
          finalityThreshold,
        ],
      });

      const burnTx = {
        from: activeAddress,
        to: cctpTokenMessenger,
        data: burnData,
        value: '0x0',
      } as const;

      await simulateTransaction(activeProvider, burnTx, 'CCTP bridge');

      const burnHash = (await activeProvider.request({
        method: 'eth_sendTransaction',
        params: [burnTx],
      })) as `0x${string}`;

      await waitForTransactionReceipt(activeProvider, burnHash, 'CCTP bridge');

      return vaultService.addToVault(
        vaultId,
        addAmount,
        burnHash,
        activeAddress,
        burnAmount,
        maxFeeAmount.toString(),
        finalityThreshold
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['vault', vaultId] });
      showNotification('Funds added successfully!', 'success');
      setAddAmount('');
    },
    onError: (error: any) =>
      showNotification(getTransactionErrorMessage(error, 'Failed to add to vault'), 'error'),
  });

  const withdrawMutation = useMutation({
    mutationFn: async () => {
      if (!vault) {
        throw new Error('Vault details are still loading.');
      }

      let activeAddress = address?.toLowerCase();
      if (!activeAddress) {
        connect();
      }

      if (!activeAddress) {
        throw new Error('No wallet connected. Please connect your wallet first.');
      }

      if (inboundFundingMismatch) {
        throw new Error('This vault was bridged to a previous Arc settlement address and cannot be withdrawn from the current deployment. Create a fresh vault with the latest contracts.');
      }

      if (inboundFundingPending) {
        throw new Error('This vault is still receiving its source-chain funds on Arc. Give the bridge a moment, then retry.');
      }

      const timelockVaultAddress = CONTRACT_ADDRESSES.TIMELOCK_VAULT;
      if (!timelockVaultAddress) {
        throw new Error('Arc TimeLockVault address is missing. Check NEXT_PUBLIC_TIMELOCK_VAULT in .env');
      }

      const activeProvider = await getProvider();
      if (!activeProvider) {
        throw new Error('No wallet provider found.');
      }

      const withdrawDestination = parseInt(withdrawDestinationChain, 10);
      const amountUnits = parseUnits(withdrawAmount, 6);
      await switchChain(ARC_CHAIN_ID);

      const withdrawData = encodeFunctionData({
        abi: TIMELOCK_VAULT_ABI,
        functionName: 'withdrawFlexible',
        args: [vaultId as `0x${string}`, amountUnits],
      });

      const withdrawTx = {
        from: activeAddress,
        to: getAddress(timelockVaultAddress),
        data: withdrawData,
        value: '0x0',
      } as const;

      await simulateTransaction(activeProvider, withdrawTx, 'Flexible withdrawal');

      showNotification('Submitting Arc withdrawal transaction...', 'info');
      const withdrawHash = (await activeProvider.request({
        method: 'eth_sendTransaction',
        params: [withdrawTx],
      })) as `0x${string}`;

      await waitForTransactionReceipt(activeProvider, withdrawHash, 'Flexible withdrawal');

      if (withdrawDestination === ARC_CHAIN_ID) {
        return vaultService.withdrawFlexible(vaultId, withdrawAmount, withdrawHash, ARC_CHAIN_ID);
      }

      if (vault.bridgeProtocol !== 'CCTP') {
        throw new Error('Withdraw back to source chain is currently available for CCTP USDC vaults only.');
      }

      const arcConfig = CHAINS[ARC_CHAIN_ID];
      const sourceConfig = CHAINS[withdrawDestination];
      if (!hasCctpDomain(withdrawDestination)) {
        throw new Error('CCTP is not configured for the selected destination chain.');
      }
      const destinationDomain = sourceConfig.cctpDomain;
      if (typeof destinationDomain !== 'number') {
        throw new Error('CCTP is not configured for the selected destination chain.');
      }

      const arcUsdc = getAddress(arcConfig.usdc);
      const arcTokenMessenger = getAddress(arcConfig.cctpTokenMessenger || '');
      const penaltyUnits = Math.floor(Date.now() / 1000) < vault.unlockAt ? (amountUnits * 5n) / 1000n : 0n;
      const userReceivesUnits = amountUnits - penaltyUnits;

      showNotification(`Approving Arc USDC for bridge-back to ${getChainName(withdrawDestination)}...`, 'info');
      const approveData = encodeFunctionData({
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [arcTokenMessenger, userReceivesUnits],
      });

      const approveTx = {
        from: activeAddress,
        to: arcUsdc,
        data: approveData,
        value: '0x0',
      } as const;

      await simulateTransaction(activeProvider, approveTx, 'Arc USDC approval');

      const approveHash = (await activeProvider.request({
        method: 'eth_sendTransaction',
        params: [approveTx],
      })) as `0x${string}`;

      await waitForTransactionReceipt(activeProvider, approveHash, 'Arc USDC approval');
      await waitForErc20Allowance(
        activeProvider,
        activeAddress,
        arcUsdc,
        arcTokenMessenger,
        userReceivesUnits
      );

      const { maxFeeAmount, finalityThreshold } = await getCctpBurnSettings(
        ARC_CHAIN_ID,
        withdrawDestination,
        formatUnits(userReceivesUnits, 6),
        'flexible-withdraw'
      );

      showNotification(`Bridging withdrawn USDC back to ${getChainName(withdrawDestination)}...`, 'info');
      const bridgeBackData = encodeFunctionData({
        abi: CCTP_TOKEN_MESSENGER_ABI,
        functionName: 'depositForBurn',
        args: [
          userReceivesUnits,
          destinationDomain,
          toBytes32Address(getAddress(activeAddress)),
          arcUsdc,
          ZERO_BYTES32,
          maxFeeAmount,
          finalityThreshold,
        ],
      });

      const bridgeBackTx = {
        from: activeAddress,
        to: arcTokenMessenger,
        data: bridgeBackData,
        value: '0x0',
      } as const;

      await simulateTransaction(activeProvider, bridgeBackTx, 'CCTP bridge-back');

      const bridgeBackHash = (await activeProvider.request({
        method: 'eth_sendTransaction',
        params: [bridgeBackTx],
      })) as `0x${string}`;

      await waitForTransactionReceipt(activeProvider, bridgeBackHash, 'CCTP bridge-back');

      return vaultService.withdrawFlexible(
        vaultId,
        withdrawAmount,
        withdrawHash,
        withdrawDestination,
        bridgeBackHash
      );
    },
    onSuccess: async (data: any) => {
      await queryClient.invalidateQueries({ queryKey: ['vault', vaultId] });
      const selectedDestination = Number(data?.destinationChain ?? parseInt(withdrawDestinationChain, 10));
      if (selectedDestination === ARC_CHAIN_ID) {
        showNotification('Withdrawal successful on Arc!', 'success');
      } else if (data?.bridgeStatus?.state === 'COMPLETE') {
        showNotification(`Withdrawal delivered to ${getChainName(selectedDestination)}.`, 'success');
      } else {
        showNotification(`Withdrawal submitted. Bridge-back to ${getChainName(selectedDestination)} is in progress.`, 'success');
      }
      setWithdrawAmount('');
    },
    onError: (error: any) =>
      showNotification(getTransactionErrorMessage(error, 'Failed to withdraw'), 'error'),
  });

  const borrowMutation = useMutation({
    mutationFn: async () => {
      if (!vault) {
        throw new Error('Vault details are still loading.');
      }

      const creditLineAddress = CONTRACT_ADDRESSES.CREDIT_LINE;
      if (!creditLineAddress) {
        throw new Error('CreditLine address is missing. Check NEXT_PUBLIC_CREDIT_LINE in .env');
      }

      const activeAddress = address?.toLowerCase();
      if (!activeAddress) {
        throw new Error('No wallet connected. Please connect your wallet first.');
      }

      const activeProvider = await getProvider();
      if (!activeProvider) {
        throw new Error('No wallet provider found.');
      }

      await switchChain(ARC_CHAIN_ID);

      const amountUnits = parseUnits(borrowAmount, 6);
      const borrowData = encodeFunctionData({
        abi: CREDIT_LINE_ABI,
        functionName: 'borrow',
        args: [vaultId as `0x${string}`, amountUnits],
      });

      const borrowTx = {
        from: activeAddress,
        to: getAddress(creditLineAddress),
        data: borrowData,
        value: '0x0',
      } as const;

      await simulateTransaction(activeProvider, borrowTx, 'Borrow against vault');

      showNotification('Submitting borrow transaction. Confirm it in your wallet.', 'info');
      const borrowHash = (await activeProvider.request({
        method: 'eth_sendTransaction',
        params: [borrowTx],
      })) as `0x${string}`;

      await waitForTransactionReceipt(activeProvider, borrowHash, 'Borrow against vault');

      return { borrowHash };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['creditLineVault', vaultId] });
      await queryClient.invalidateQueries({ queryKey: ['vault', vaultId] });
      showNotification('Borrow successful! USDC has been sent to your wallet.', 'success');
      setBorrowAmount('');
    },
    onError: (error: any) =>
      showNotification(getTransactionErrorMessage(error, 'Failed to borrow'), 'error'),
  });

  const repayMutation = useMutation({
    mutationFn: async () => {
      if (!vault || !creditLineStatus) {
        throw new Error('Vault or loan details are still loading.');
      }

      const creditLineAddress = CONTRACT_ADDRESSES.CREDIT_LINE;
      if (!creditLineAddress) {
        throw new Error('CreditLine address is missing. Check NEXT_PUBLIC_CREDIT_LINE in .env');
      }

      const activeAddress = address?.toLowerCase();
      if (!activeAddress) {
        throw new Error('No wallet connected. Please connect your wallet first.');
      }

      const activeProvider = await getProvider();
      if (!activeProvider) {
        throw new Error('No wallet provider found.');
      }

      await switchChain(ARC_CHAIN_ID);

      const arcUsdc = getAddress(CHAINS[ARC_CHAIN_ID].usdc);
      const creditLineAddr = getAddress(creditLineAddress);
      const owedUnits = parseUnits(creditLineStatus.totalOwed, 6);

      showNotification('Approving USDC for repayment. Confirm it in your wallet.', 'info');
      const approveData = encodeFunctionData({
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [creditLineAddr, owedUnits],
      });

      const approveTx = {
        from: activeAddress,
        to: arcUsdc,
        data: approveData,
        value: '0x0',
      } as const;

      await simulateTransaction(activeProvider, approveTx, 'USDC approval');

      const approveHash = (await activeProvider.request({
        method: 'eth_sendTransaction',
        params: [approveTx],
      })) as `0x${string}`;

      await waitForTransactionReceipt(activeProvider, approveHash, 'USDC approval');
      await waitForErc20Allowance(activeProvider, activeAddress, arcUsdc, creditLineAddr, owedUnits);

      const repayData = encodeFunctionData({
        abi: CREDIT_LINE_ABI,
        functionName: 'repay',
        args: [vaultId as `0x${string}`],
      });

      const repayTx = {
        from: activeAddress,
        to: creditLineAddr,
        data: repayData,
        value: '0x0',
      } as const;

      await simulateTransaction(activeProvider, repayTx, 'Repay loan');

      showNotification('Submitting repayment transaction. Confirm it in your wallet.', 'info');
      const repayHash = (await activeProvider.request({
        method: 'eth_sendTransaction',
        params: [repayTx],
      })) as `0x${string}`;

      await waitForTransactionReceipt(activeProvider, repayHash, 'Repay loan');

      return { repayHash };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['creditLineVault', vaultId] });
      await queryClient.invalidateQueries({ queryKey: ['vault', vaultId] });
      showNotification('Loan repaid! Vault collateral has been unlocked.', 'success');
    },
    onError: (error: any) =>
      showNotification(getTransactionErrorMessage(error, 'Failed to repay'), 'error'),
  });

  const claimBucketMutation = useMutation({
    mutationFn: async (bucket: SplitBucketName) => {
      const activeAddress = address?.toLowerCase();
      if (!activeAddress) {
        throw new Error('No wallet connected. Please connect your wallet first.');
      }

      const timelockVaultAddress = CONTRACT_ADDRESSES.TIMELOCK_VAULT;
      if (!timelockVaultAddress) {
        throw new Error('Arc TimeLockVault address is missing. Check NEXT_PUBLIC_TIMELOCK_VAULT in .env');
      }

      const activeProvider = await getProvider();
      if (!activeProvider) {
        throw new Error('No wallet provider found.');
      }

      await switchChain(ARC_CHAIN_ID);

      const claimData = encodeFunctionData({
        abi: TIMELOCK_VAULT_ABI,
        functionName: 'claimBucket',
        args: [vaultId as `0x${string}`, SPLIT_BUCKET_INDEX[bucket]],
      });

      const claimTx = {
        from: activeAddress,
        to: getAddress(timelockVaultAddress),
        data: claimData,
        value: '0x0',
      } as const;

      await simulateTransaction(activeProvider, claimTx, `Claim ${bucket} bucket`);

      showNotification(`Submitting claim for ${bucket} bucket...`, 'info');
      const claimHash = (await activeProvider.request({
        method: 'eth_sendTransaction',
        params: [claimTx],
      })) as `0x${string}`;

      await waitForTransactionReceipt(activeProvider, claimHash, `Claim ${bucket} bucket`);

      return vaultService.claimBucket(vaultId, bucket, claimHash);
    },
    onSuccess: async (_data, bucket) => {
      await queryClient.invalidateQueries({ queryKey: ['vault', vaultId] });
      showNotification(`${bucket.charAt(0).toUpperCase() + bucket.slice(1)} bucket claimed!`, 'success');
    },
    onError: (error: any) =>
      showNotification(getTransactionErrorMessage(error, 'Failed to claim bucket'), 'error'),
  });

  const claimTranchesMutation = useMutation({
    mutationFn: async () => {
      const activeAddress = address?.toLowerCase();
      if (!activeAddress) {
        throw new Error('No wallet connected. Please connect your wallet first.');
      }

      const timelockVaultAddress = CONTRACT_ADDRESSES.TIMELOCK_VAULT;
      if (!timelockVaultAddress) {
        throw new Error('Arc TimeLockVault address is missing. Check NEXT_PUBLIC_TIMELOCK_VAULT in .env');
      }

      const activeProvider = await getProvider();
      if (!activeProvider) {
        throw new Error('No wallet provider found.');
      }

      await switchChain(ARC_CHAIN_ID);

      const claimData = encodeFunctionData({
        abi: TIMELOCK_VAULT_ABI,
        functionName: 'claimStreamingTranches',
        args: [vaultId as `0x${string}`],
      });

      const claimTx = {
        from: activeAddress,
        to: getAddress(timelockVaultAddress),
        data: claimData,
        value: '0x0',
      } as const;

      await simulateTransaction(activeProvider, claimTx, 'Claim matured tranches');

      showNotification('Submitting tranche claim...', 'info');
      const claimHash = (await activeProvider.request({
        method: 'eth_sendTransaction',
        params: [claimTx],
      })) as `0x${string}`;

      await waitForTransactionReceipt(activeProvider, claimHash, 'Claim matured tranches');

      return vaultService.claimTranches(vaultId, claimHash);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['vault', vaultId] });
      showNotification('Matured tranches claimed!', 'success');
    },
    onError: (error: any) =>
      showNotification(getTransactionErrorMessage(error, 'Failed to claim tranches'), 'error'),
  });

  if (isLoading) {
    return (
      <div className="py-12 text-center">
        <div className="text-light/60">Loading vault...</div>
      </div>
    );
  }

  if (error || !vault) {
    return (
      <div className="card border-red-500/30 bg-red-500/10">
        <div className="font-semibold text-red-400">Vault not found</div>
        <p className="mt-2 text-light/60">This vault may not exist yet, or it may still be syncing.</p>
        <button
          onClick={() => router.replace('/dashboard')}
          className="mt-4 rounded-lg border border-primary px-4 py-2 text-primary transition-colors hover:bg-primary/10"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  const statusLabels: Record<string, string> = {
    ACTIVE: 'Locked',
    MATURE: 'Mature',
    CLAIMED: 'Claimed',
    FAILED: 'Failed',
  };

  const vaultTypeLabel = vault.vaultType === 'FIXED' ? 'Fixed' : 'Flexible';

  const calculateFlexiblePenalty = (amount: number) => {
    const now = Math.floor(Date.now() / 1000);
    if (now >= vault.unlockAt) return 0;
    return amount * 0.005;
  };

  const handleCopyVaultId = async () => {
    try {
      await navigator.clipboard.writeText(vaultId);
      setCopyFeedback('copied');
      showNotification('Vault ID copied!', 'success');
      window.setTimeout(() => setCopyFeedback('idle'), 1800);
    } catch {
      showNotification('Could not copy Vault ID', 'error');
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {showCreatedBanner && (
        <div className="card success-pop success-glow border-green-500/30 bg-gradient-to-r from-green-500/10 via-green-500/5 to-transparent">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/20 text-green-400">
              OK
            </div>
            <div>
              <div className="font-semibold text-green-400">Vault created successfully!</div>
              <div className="text-sm text-light/70">Your vault is live and the countdown has begun.</div>
            </div>
          </div>
        </div>
      )}

      <div>
        <div className={`success-pop mb-4 flex items-center gap-3 ${isRevealed ? 'success-shimmer' : ''}`}>
          <span className="text-3xl">{vaultTypeLabel}</span>
          <div>
            <h1 className="text-3xl font-bold text-light">{vaultTypeLabel} Vault</h1>
            <p className="mt-1 break-all font-mono text-sm text-light/60">{vaultId}</p>
          </div>
          <button
            onClick={handleCopyVaultId}
            className={`ml-auto rounded-lg border px-3 py-2 text-sm transition-all ${
              copyFeedback === 'copied'
                ? 'border-green-500/40 bg-green-500/15 text-green-400'
                : 'border-primary/30 text-primary hover:bg-primary/10'
            }`}
          >
            {copyFeedback === 'copied' ? 'Copied' : 'Copy Vault ID'}
          </button>
        </div>
      </div>

      <div className="card success-pop success-glow">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div>
            <div className="mb-2 text-sm text-light/60">Current Locked Balance</div>
            <div className="text-5xl font-bold text-primary">{formatUsdAmount(lifecycle.currentLocked)}</div>
          </div>
          <div>
            <div className="mb-2 text-sm text-light/60">Status</div>
            <div className="flex items-center gap-2">
              <div>
                <div className="text-2xl font-bold text-light">{statusLabels[vault.status] || vault.status}</div>
                {vault.status !== 'CLAIMED' && vault.status !== 'FAILED' && (
                  <CountdownTimer unlockAt={vault.unlockAt} vaultId={vaultId} />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {onChainInfo?.vault && (onChainInfo.vault.conditionOracle.toLowerCase() !== ZERO_ADDRESS || onChainInfo.vault.treasuryBalanceCheck.toLowerCase() !== ZERO_ADDRESS) && (
        <div className="card">
          <h2 className="mb-4 text-xl font-bold text-light">Unlock Condition Status</h2>
          <div className="space-y-4">
            {onChainInfo.vault.conditionOracle.toLowerCase() !== ZERO_ADDRESS && (
              <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-dark/30 p-4">
                <div>
                  <div className="font-semibold text-light">{conditionOracleLabel(onChainInfo.vault.conditionOracle)}</div>
                  <div className="text-sm text-light/60">
                    Price must be {onChainInfo.vault.conditionAbove ? '>=' : '<='} {onChainInfo.vault.conditionThreshold.toString()}
                    {onChainInfo.oraclePrice !== null && ` (current: ${onChainInfo.oraclePrice.toString()})`}
                  </div>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    onChainInfo.oraclePrice !== null &&
                    (onChainInfo.vault.conditionAbove
                      ? onChainInfo.oraclePrice >= onChainInfo.vault.conditionThreshold
                      : onChainInfo.oraclePrice <= onChainInfo.vault.conditionThreshold)
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-yellow-500/20 text-yellow-300'
                  }`}
                >
                  {onChainInfo.oraclePrice !== null &&
                  (onChainInfo.vault.conditionAbove
                    ? onChainInfo.oraclePrice >= onChainInfo.vault.conditionThreshold
                    : onChainInfo.oraclePrice <= onChainInfo.vault.conditionThreshold)
                    ? 'Met'
                    : 'Not met'}
                </span>
              </div>
            )}

            {onChainInfo.vault.treasuryBalanceCheck.toLowerCase() !== ZERO_ADDRESS && (
              <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-dark/30 p-4">
                <div>
                  <div className="font-semibold text-light">Treasury balance guard</div>
                  <div className="text-sm text-light/60">
                    Treasury must hold {formatUnits(onChainInfo.vault.treasuryBalanceThreshold, 6)} USDC
                    {onChainInfo.treasuryBalance !== null && ` (current: ${formatUnits(onChainInfo.treasuryBalance, 6)} USDC)`}
                  </div>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    onChainInfo.treasuryBalance !== null && onChainInfo.treasuryBalance >= onChainInfo.vault.treasuryBalanceThreshold
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-yellow-500/20 text-yellow-300'
                  }`}
                >
                  {onChainInfo.treasuryBalance !== null && onChainInfo.treasuryBalance >= onChainInfo.vault.treasuryBalanceThreshold
                    ? 'Met'
                    : 'Not met'}
                </span>
              </div>
            )}
          </div>
          <p className="mt-4 text-xs text-light/50">
            Claiming still also requires the time-lock to have matured. All configured conditions are AND'd together.
          </p>
        </div>
      )}

      {address?.toLowerCase() === vault.owner?.toLowerCase() && (
        <div className="card">
          <h2 className="mb-2 text-xl font-bold text-light">Delegate to Autonomous Agent</h2>
          <p className="mb-4 text-sm text-light/60">
            Authorize the CHRONOS vault-maintenance agent to call claimVault() on your behalf once
            this vault matures. Funds always go to you; the agent only earns a small
            {' '}{onChainInfo ? (onChainInfo.agentFeeBps / 100).toFixed(2) : '…'}% fee on delegate-triggered claims.
          </p>

          {!onChainInfo ? (
            <div className="text-sm text-light/50">Loading on-chain delegate status…</div>
          ) : (
          <>
          <div className="mb-4 flex items-center justify-between rounded-lg border border-primary/20 bg-dark/30 p-4">
            <div>
              <div className="text-sm text-light/60">Current delegate</div>
              <div className="font-mono text-sm text-light">
                {onChainInfo.delegate.toLowerCase() === ZERO_ADDRESS ? 'None' : onChainInfo.delegate}
              </div>
            </div>
            {onChainInfo.delegate.toLowerCase() === ZERO_ADDRESS ? (
              <span className="rounded-full bg-light/10 px-3 py-1 text-xs font-bold text-light/60">Not delegated</span>
            ) : (
              <span className="rounded-full bg-primary/20 px-3 py-1 text-xs font-bold text-primary">Active</span>
            )}
          </div>

          {onChainInfo.delegate.toLowerCase() === ZERO_ADDRESS ? (
            <button
              type="button"
              disabled={delegateMutation.isPending || !agentAddressData?.address}
              onClick={() => agentAddressData?.address && delegateMutation.mutate(agentAddressData.address)}
              className="rounded-lg bg-primary px-4 py-2 font-bold text-dark transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {delegateMutation.isPending
                ? 'Confirm in wallet...'
                : agentAddressData?.address
                  ? 'Delegate to Agent'
                  : 'Agent address unavailable'}
            </button>
          ) : (
            <button
              type="button"
              disabled={delegateMutation.isPending}
              onClick={() => delegateMutation.mutate(ZERO_ADDRESS)}
              className="rounded-lg border border-primary/40 px-4 py-2 font-bold text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
            >
              {delegateMutation.isPending ? 'Confirm in wallet...' : 'Revoke Delegate'}
            </button>
          )}
          </>
          )}
        </div>
      )}

      <div className="card">
        <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-light">Vault Lifecycle</h2>
            <p className="text-sm text-light/60">Complete movement of funds through this vault.</p>
          </div>
          <div className="text-sm text-light/60">
            Net result: <span className="font-mono text-primary">{formatUsdAmount(lifecycle.currentLocked)}</span> locked
          </div>
        </div>

        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
          <div className="rounded-lg border border-primary/20 bg-dark/30 p-4">
            <div className="text-xs text-light/60">Total Deposited</div>
            <div className="mt-2 font-mono text-xl font-bold text-primary">{formatUsdAmount(lifecycle.deposited)}</div>
          </div>
          <div className="rounded-lg border border-primary/20 bg-dark/30 p-4">
            <div className="text-xs text-light/60">Added Funds</div>
            <div className="mt-2 font-mono text-xl font-bold text-primary">{formatUsdAmount(lifecycle.addedFunds)}</div>
          </div>
          <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4">
            <div className="text-xs text-light/60">Early Withdrawn</div>
            <div className="mt-2 font-mono text-xl font-bold text-yellow-300">{formatUsdAmount(lifecycle.earlyWithdrawn)}</div>
          </div>
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4">
            <div className="text-xs text-light/60">Penalties</div>
            <div className="mt-2 font-mono text-xl font-bold text-red-300">{formatUsdAmount(lifecycle.penalties)}</div>
          </div>
          <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-4">
            <div className="text-xs text-light/60">Mature Claimed</div>
            <div className="mt-2 font-mono text-xl font-bold text-green-300">{formatUsdAmount(lifecycle.maturedClaimed)}</div>
          </div>
        </div>

        {lifecycle.timeline.length > 0 ? (
          <div className="space-y-3">
            {lifecycle.timeline.map(({ tx, label, amount, detail }) => (
              <div
                key={tx.txHash}
                className="grid gap-3 rounded-lg border border-primary/10 bg-dark/20 p-4 md:grid-cols-[1fr_auto]"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold text-light">{label}</div>
                    <span
                      className={`rounded-full px-2 py-1 text-xs ${
                        tx.status === 'COMPLETE'
                          ? 'bg-green-500/15 text-green-300'
                          : tx.status === 'FAILED'
                            ? 'bg-red-500/15 text-red-300'
                            : 'bg-yellow-500/15 text-yellow-300'
                      }`}
                    >
                      {tx.status}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-light/60">{detail}</div>
                  <div className="mt-2 font-mono text-xs text-light/40">
                    {new Date(tx.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="font-mono text-xl font-bold text-primary md:text-right">
                  {formatUsdAmount(amount)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-primary/10 bg-dark/20 p-4 text-sm text-light/60">
            No lifecycle events recorded yet.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="card">
          <div className="mb-2 text-sm text-light/60">Created</div>
          <div className="font-mono text-sm text-primary">
            {new Date(vault.createdAt * 1000).toLocaleString()}
          </div>
        </div>

        <div className="card">
          <div className="mb-2 text-sm text-light/60">Unlock Date</div>
          <div className="font-mono text-sm text-primary">
            {new Date(vault.unlockAt * 1000).toLocaleString()}
          </div>
        </div>

        <div className="card">
          <div className="mb-2 text-sm text-light/60">Source Chain</div>
          <div className="font-semibold text-light">{getChainName(vault.sourceChain)}</div>
        </div>

        <div className="card">
          <div className="mb-2 text-sm text-light/60">Bridge Protocol</div>
          <div className="font-semibold text-light">{vault.bridgeProtocol}</div>
        </div>

        <div className="card">
          <div className="mb-2 text-sm text-light/60">Destination Chain</div>
          <div className="font-semibold text-light">{destinationChainLabel}</div>
        </div>

        <div className="card md:col-span-2">
          <div className="mb-2 text-sm text-light/60">Token Address</div>
          <div className="break-all rounded bg-dark/50 p-3 font-mono text-xs text-primary">
            {vault.tokenAddress}
          </div>
        </div>

        {vault.createdOnChainTx && (
          <div className="card md:col-span-2">
            <div className="mb-2 text-sm text-light/60">Arc Settlement Tx</div>
            <div className="break-all rounded bg-dark/50 p-3 font-mono text-xs text-primary">
              {vault.createdOnChainTx}
            </div>
          </div>
        )}
      </div>

      {vault.status === 'ACTIVE' && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="card">
            <h3 className="mb-4 text-lg font-bold text-light">Add Funds</h3>
            <p className="mb-4 text-sm text-light/60">
              Lock additional funds in this vault. The same unlock date still applies to the full balance.
            </p>
            {inboundFundingMismatch && (
              <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                This vault points to an older Arc TimeLockVault address, so its original bridge mint cannot fund the current deployment.
                <div className="mt-2 space-y-1 font-mono text-xs text-red-200/80">
                  <div>Source burn: {inboundRecipientMismatch?.txHash}</div>
                  {inboundRecipientMismatchMetadata?.actualMintRecipient && (
                    <div>Minted to: {inboundRecipientMismatchMetadata.actualMintRecipient}</div>
                  )}
                  {inboundRecipientMismatchMetadata?.expectedMintRecipient && (
                    <div>Expected now: {inboundRecipientMismatchMetadata.expectedMintRecipient}</div>
                  )}
                </div>
              </div>
            )}
            {!inboundFundingMismatch && inboundFundingPending && (
              <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
                The latest source-chain bridge into Arc is still attesting with Circle. Actions unlock as soon as the Arc mint transaction completes.
              </div>
            )}
            {!canAddFunds && !inboundFundingMismatch && !inboundFundingPending && (
              <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                This vault cannot accept additional deposits with the current bridge configuration.
              </div>
            )}
            <input
              type="number"
              step="0.01"
              min="0"
              value={addAmount}
              onChange={(e) => setAddAmount(e.target.value)}
              placeholder="Amount to add"
              className={`input-field mb-4 ${!canAddFunds ? 'opacity-60' : ''}`}
              disabled={!canAddFunds || addMutation.isPending}
            />
            <button
              onClick={() => addMutation.mutate()}
              disabled={!canAddFunds || !addAmount || addMutation.isPending}
              className="w-full rounded-lg bg-primary px-4 py-3 font-bold text-dark transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {addMutation.isPending ? 'Adding funds...' : 'Add Funds'}
            </button>
          </div>

          {vault.vaultType === 'FLEXIBLE' && (
            <div className="card">
              <h3 className="mb-4 text-lg font-bold text-light">Withdraw Early</h3>
              <p className="mb-4 text-sm text-light/60">
                Withdraw before unlock with a <span className="text-red-400">0.5% penalty</span>.
              </p>
              {inboundFundingMismatch && (
                <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                  This vault never received its backing funds on the current Arc deployment, so withdrawals are disabled here. Create a fresh vault after the contract redeploy.
                </div>
              )}
              {!inboundFundingMismatch && inboundFundingPending && (
                <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
                  This vault is still receiving its original bridge mint on Arc. Withdrawals will work once the backing funds arrive.
                </div>
              )}
              {canClaimToSourceChain && (
                <select
                  value={withdrawDestinationChain}
                  onChange={(e) => setWithdrawDestinationChain(e.target.value)}
                  className="input-field mb-3"
                  disabled={withdrawMutation.isPending}
                >
                  <option value={String(vault.sourceChain)}>
                    Withdraw back to {getChainName(vault.sourceChain)}
                  </option>
                  <option value={String(ARC_CHAIN_ID)}>Withdraw to Arc Testnet</option>
                </select>
              )}
              {canClaimToSourceChain && (
                <p className="mb-4 text-xs text-light/60">
                  Source-chain withdrawals bridge your post-penalty USDC back after the Arc withdrawal completes.
                </p>
              )}
              <input
                type="number"
                step="0.01"
                min="0"
                max={parseFloat(vault.totalAmount)}
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="Amount to withdraw"
                className="input-field mb-2"
                disabled={withdrawMutation.isPending || inboundFundingBlocked}
              />
              {withdrawAmount && (
                <div className="mb-4 text-xs text-light/60">
                  Penalty: ${(calculateFlexiblePenalty(parseFloat(withdrawAmount)) || 0).toFixed(2)}
                </div>
              )}
              <button
                onClick={() => withdrawMutation.mutate()}
                disabled={!withdrawAmount || withdrawMutation.isPending || inboundFundingBlocked}
                className="w-full rounded-lg bg-accent px-4 py-3 font-bold text-dark transition-colors hover:bg-accent/90 disabled:opacity-50"
              >
                {withdrawMutation.isPending ? 'Withdrawing...' : 'Withdraw'}
              </button>
            </div>
          )}

          {canBorrow && (
            <div className="card">
              <h3 className="mb-4 text-lg font-bold text-light">Borrow Against This Vault</h3>
              <p className="mb-4 text-sm text-light/60">
                Lock this vault as collateral and borrow USDC from the CreditLine pool, up to{' '}
                <span className="text-primary">50% LTV</span>.
              </p>
              <div className="mb-2 flex items-center justify-between text-xs text-light/60">
                <span>Max borrowable</span>
                <span className="font-mono text-primary">{formatUsdAmount(maxBorrowableAmount)}</span>
              </div>
              <input
                type="range"
                min="0"
                max={maxBorrowableAmount || 0}
                step="0.01"
                value={borrowAmount || '0'}
                onChange={(e) => setBorrowAmount(e.target.value)}
                className="mb-3 w-full accent-primary"
                disabled={borrowMutation.isPending || maxBorrowableAmount <= 0}
              />
              <input
                type="number"
                step="0.01"
                min="0"
                max={maxBorrowableAmount}
                value={borrowAmount}
                onChange={(e) => setBorrowAmount(e.target.value)}
                placeholder="Amount to borrow"
                className="input-field mb-2"
                disabled={borrowMutation.isPending || maxBorrowableAmount <= 0}
              />
              {borrowAmount && (
                <div className="mb-4 text-xs text-light/60">
                  Current LTV:{' '}
                  <span className="font-mono text-primary">
                    {maxBorrowableAmount > 0
                      ? `${Math.min(((parseFloat(borrowAmount) || 0) / (maxBorrowableAmount * 2)) * 100, 50).toFixed(1)}%`
                      : '0%'}
                  </span>{' '}
                  (cap 50%)
                </div>
              )}
              <button
                onClick={() => borrowMutation.mutate()}
                disabled={
                  !borrowAmount ||
                  parseFloat(borrowAmount) <= 0 ||
                  parseFloat(borrowAmount) > maxBorrowableAmount ||
                  borrowMutation.isPending
                }
                className="w-full rounded-lg bg-primary px-4 py-3 font-bold text-dark transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {borrowMutation.isPending ? 'Borrowing...' : 'Borrow USDC'}
              </button>
            </div>
          )}

          {hasActiveLoan && creditLineStatus && (
            <div className="card">
              <h3 className="mb-4 text-lg font-bold text-light">Repay Loan</h3>
              <p className="mb-4 text-sm text-light/60">
                Repay in full before maturity to unlock this vault&apos;s collateral.
              </p>
              <div className="mb-2 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-primary/10 bg-dark/20 p-3">
                  <div className="text-xs text-light/60">Principal</div>
                  <div className="font-mono text-primary">{formatUsdAmount(parseFloat(creditLineStatus.principal))}</div>
                </div>
                <div className="rounded-lg border border-primary/10 bg-dark/20 p-3">
                  <div className="text-xs text-light/60">Interest owed</div>
                  <div className="font-mono text-primary">{formatUsdAmount(parseFloat(creditLineStatus.interestOwed))}</div>
                </div>
              </div>
              <div className="mb-4 mt-3 rounded-lg border border-primary/20 bg-dark/30 p-3">
                <div className="text-xs text-light/60">Total owed</div>
                <div className="font-mono text-xl font-bold text-primary">
                  {formatUsdAmount(parseFloat(creditLineStatus.totalOwed))}
                </div>
              </div>
              <button
                onClick={() => repayMutation.mutate()}
                disabled={repayMutation.isPending}
                className="w-full rounded-lg bg-accent px-4 py-3 font-bold text-dark transition-colors hover:bg-accent/90 disabled:opacity-50"
              >
                {repayMutation.isPending ? 'Repaying...' : 'Approve & Repay'}
              </button>
            </div>
          )}
        </div>
      )}

      {vault.status === 'MATURE' && (
        <div className="card">
          <h3 className="mb-6 text-2xl font-bold text-light">Vault is Mature</h3>
          <p className="mb-6 text-light/60">Your vault has reached its unlock date. Claim your tokens now.</p>
          {inboundFundingMismatch && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
              This mature vault was bridged to a previous Arc TimeLockVault address and does not hold claimable funds on the current deployment.
              <div className="mt-2 space-y-1 font-mono text-xs text-red-200/80">
                <div>Source burn: {inboundRecipientMismatch?.txHash}</div>
                {inboundRecipientMismatchMetadata?.actualMintRecipient && (
                  <div>Minted to: {inboundRecipientMismatchMetadata.actualMintRecipient}</div>
                )}
                {inboundRecipientMismatchMetadata?.expectedMintRecipient && (
                  <div>Expected now: {inboundRecipientMismatchMetadata.expectedMintRecipient}</div>
                )}
              </div>
              <div className="mt-3 text-red-200/90">
                This one will not fix itself with more waiting. Please create a fresh vault with the current Arc contracts.
              </div>
            </div>
          )}
          {!inboundFundingMismatch && inboundFundingPending && (
            <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
              The vault record is mature, but Circle is still attesting the source-chain burn. Claiming unlocks as soon as the Arc mint transaction completes.
            </div>
          )}

          <select value={destChain} onChange={(e) => setDestChain(e.target.value)} className="input-field mb-3">
            {canClaimToSourceChain && (
              <option value={String(vault.sourceChain)}>
                Claim back to {getChainName(vault.sourceChain)}
              </option>
            )}
            <option value={String(ARC_CHAIN_ID)}>Claim to Arc Testnet</option>
          </select>
          <p className="mb-6 text-sm text-light/60">
            Claiming back to the source chain includes an extra Arc bridge step and may remain pending briefly while Circle attests the transfer.
          </p>

          <button
            onClick={() => claimMutation.mutate()}
            disabled={claimMutation.isPending || inboundFundingBlocked}
            className="w-full rounded-lg bg-green-500 px-6 py-4 text-lg font-bold text-dark transition-colors hover:bg-green-600 disabled:opacity-50"
          >
            {claimMutation.isPending ? 'Claiming...' : 'Claim Vault'}
          </button>
          {(claimStatusMessage || inboundFundingBlocked) && (
            <div className="mt-4 rounded-lg border border-primary/20 bg-dark/30 p-3 text-sm text-light/70">
              {claimStatusMessage ||
                (inboundFundingMismatch
                  ? 'Claim is blocked because this vault has a confirmed destination mismatch.'
                  : 'Claim is waiting for inbound funding to finish.')}
            </div>
          )}
        </div>
      )}

      {vault.status === 'CLAIMED' && (
        <div className="card border border-green-500/30 bg-green-500/10">
          <div className="text-lg font-bold text-green-400">{claimedCardTitle}</div>
          <p className="mt-2 text-light/70">
            {latestOutboundBridge && latestOutboundBridge.toChain !== ARC_CHAIN_ID && latestOutboundBridge.status !== 'COMPLETE'
              ? `${claimedCardTitle === 'Vault Closed' ? 'Your withdrawal' : 'Your claim'} completed on Arc and the bridge back to ${getChainName(latestOutboundBridge.toChain)} is still processing.`
              : claimedCardTitle === 'Vault Closed'
                ? 'Your flexible vault has been fully withdrawn and closed.'
                : 'Your tokens have been successfully claimed and returned to your wallet.'}
          </p>
          {vault.claimed_tx_hash && (
            <div className="mt-4 break-all font-mono text-xs text-green-400/80">
              TX: {vault.claimed_tx_hash}
            </div>
          )}
          {latestOutboundBridge && latestOutboundBridge.toChain !== ARC_CHAIN_ID && (
            <div className="mt-4 rounded-lg border border-primary/20 bg-dark/30 p-4">
              <div className="text-sm font-semibold text-light">
                Source-chain return to {getChainName(latestOutboundBridge.toChain)}
              </div>
              <div className="mt-2 text-sm text-light/70">
                Status: <span className={latestOutboundBridge.status === 'COMPLETE' ? 'text-green-400' : 'text-yellow-300'}>
                  {latestOutboundBridge.status === 'COMPLETE' ? 'Complete' : 'Pending attestation'}
                </span>
              </div>
              <div className="mt-2 break-all font-mono text-xs text-primary/80">
                Burn TX: {latestOutboundBridge.txHash}
              </div>
              {latestOutboundMetadata?.destinationTxHash && (
                <div className="mt-2 break-all font-mono text-xs text-green-400/80">
                  Mint TX: {latestOutboundMetadata.destinationTxHash}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {vault.splitAllocation && (
        <div className="card">
          <h3 className="mb-2 text-lg font-bold text-light">Smart Split Buckets</h3>
          <p className="mb-6 text-sm text-light/60">
            This vault auto-allocated its deposit into three buckets at creation. Each can be claimed independently once the vault is mature.
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {(['savings', 'yield', 'reserve'] as const).map((bucket) => {
              const info = vault.splitAllocation!.buckets[bucket];
              const bpsKey = `${bucket}Bps` as 'savingsBps' | 'yieldBps' | 'reserveBps';
              const canClaim =
                Math.floor(Date.now() / 1000) >= vault.unlockAt &&
                !info.claimed &&
                vault.status !== 'CLAIMED';

              return (
                <div key={bucket} className="rounded-lg border border-primary/20 bg-dark/30 p-4">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold capitalize text-light">{bucket}</div>
                    <div className="text-xs text-light/50">{(vault.splitAllocation![bpsKey] / 100).toFixed(1)}%</div>
                  </div>
                  <div className="mt-2 font-mono text-xl font-bold text-primary">{formatUsdAmount(info.amount)}</div>
                  {info.claimed ? (
                    <div className="mt-3 rounded bg-green-500/15 px-2 py-1 text-center text-xs text-green-300">Claimed</div>
                  ) : (
                    <button
                      onClick={() => claimBucketMutation.mutate(bucket)}
                      disabled={!canClaim || claimBucketMutation.isPending}
                      className="mt-3 w-full rounded-lg bg-primary px-3 py-2 text-sm font-bold text-dark transition-colors hover:bg-primary/90 disabled:opacity-50"
                    >
                      {claimBucketMutation.isPending ? 'Claiming...' : canClaim ? 'Claim' : 'Not mature yet'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {vault.streamingAllocation && (
        <div className="card">
          <h3 className="mb-2 text-lg font-bold text-light">Streaming Release Schedule</h3>
          <p className="mb-6 text-sm text-light/60">
            This vault releases its deposit over {vault.streamingAllocation.numTranches} equal tranches, one every{' '}
            {Math.round(vault.streamingAllocation.intervalSeconds / 60)} minutes.
          </p>

          <div className="mb-6 space-y-2">
            {vault.streamingAllocation.tranches.map((tranche) => (
              <div
                key={tranche.index}
                className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 rounded-lg border border-primary/10 bg-dark/20 p-3"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                  {tranche.index + 1}
                </div>
                <div className="text-sm text-light/60">
                  Matures {new Date(tranche.maturesAt * 1000).toLocaleString()}
                </div>
                <div className="font-mono text-sm font-bold text-primary">{formatUsdAmount(tranche.amount)}</div>
                <div className="text-xs">
                  {tranche.claimed ? (
                    <span className="rounded bg-green-500/15 px-2 py-1 text-green-300">Claimed</span>
                  ) : tranche.matured ? (
                    <span className="rounded bg-yellow-500/15 px-2 py-1 text-yellow-300">Ready</span>
                  ) : (
                    <span className="rounded bg-primary/10 px-2 py-1 text-light/50">Pending</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => claimTranchesMutation.mutate()}
            disabled={
              claimTranchesMutation.isPending ||
              vault.streamingAllocation.maturedTranches <= vault.streamingAllocation.claimedTranches
            }
            className="w-full rounded-lg bg-primary px-4 py-3 font-bold text-dark transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {claimTranchesMutation.isPending
              ? 'Claiming...'
              : vault.streamingAllocation.maturedTranches > vault.streamingAllocation.claimedTranches
                ? `Claim ${vault.streamingAllocation.maturedTranches - vault.streamingAllocation.claimedTranches} matured tranche(s)`
                : 'No new tranches matured yet'}
          </button>
        </div>
      )}

      <button
        onClick={() => router.replace('/dashboard')}
        className="rounded-lg border border-primary px-6 py-3 text-primary transition-colors hover:bg-primary/10"
      >
        Back to Dashboard
      </button>
    </div>
  );
}
