'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { encodeFunctionData, formatUnits, getAddress, parseUnits } from 'viem';
import CountdownTimer from '@/components/ui/CountdownTimer';
import { ARC_CCTP_DOMAIN, ARC_CHAIN_ID, CHAINS, getChainName } from '@/config/chains';
import { CONTRACT_ADDRESSES } from '@/config/constants';
import { useInjectedWallet } from '@/hooks/useInjectedWallet';
import {
  CCTP_FAST_FINALITY_THRESHOLD,
  CCTP_STANDARD_FINALITY_THRESHOLD,
  CCTP_TOKEN_MESSENGER_ABI,
  ERC20_APPROVE_ABI,
  TIMELOCK_VAULT_ABI,
  ZERO_BYTES32,
  getTransactionErrorLog,
  getTransactionErrorMessage,
  simulateTransaction,
  toBytes32Address,
  waitForErc20Allowance,
  waitForTransactionReceipt,
} from '@/lib/evm';
import { vaultService } from '@/services/vaultService';
import { useUIStore } from '@/store/uiStore';
import type { BridgeTransaction, Vault } from '@/types';

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
  const currentLocked = relevantTransactions.length > 0
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
  const { address, connect, switchChain } = useInjectedWallet();

  const [addAmount, setAddAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
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
        activeAddress = await connect();
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

      const activeProvider = window.ethereum;
      if (!activeProvider) {
        throw new Error('No injected wallet provider found.');
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
          sourceConfig.cctpDomain,
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
        activeAddress = await connect();
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

      const activeProvider = window.ethereum;
      if (!activeProvider) {
        throw new Error('No injected wallet provider found.');
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
        activeAddress = await connect();
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

      const activeProvider = window.ethereum;
      if (!activeProvider) {
        throw new Error('No injected wallet provider found.');
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
          sourceConfig.cctpDomain,
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

      <button
        onClick={() => router.replace('/dashboard')}
        className="rounded-lg border border-primary px-6 py-3 text-primary transition-colors hover:bg-primary/10"
      >
        Back to Dashboard
      </button>
    </div>
  );
}
