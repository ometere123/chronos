'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { encodeFunctionData, formatUnits, parseUnits, getAddress } from 'viem';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import VaultStepper from '@/components/ui/VaultStepper';
import { vaultService } from '@/services/vaultService';
import { CONTRACT_ADDRESSES, DURATION_PRESETS, MIN_DURATION, MAX_DURATION } from '@/config/constants';
import { ARC_CCTP_DOMAIN, CHAINS, SOURCE_CHAINS, CANONICAL_CHAIN } from '@/config/chains';
import { useUIStore } from '@/store/uiStore';
import { useWallet } from '@/hooks/useWallet';
import {
  CCTP_FAST_FINALITY_THRESHOLD,
  CCTP_STANDARD_FINALITY_THRESHOLD,
  CCTP_TOKEN_MESSENGER_ABI,
  ERC20_APPROVE_ABI,
  ZERO_BYTES32,
  assertContractCode,
  getErc20Allowance,
  getTransactionErrorLog,
  getTransactionErrorMessage,
  simulateTransaction,
  toBytes32Address,
  waitForErc20Allowance,
  waitForWalletChain,
  waitForTransactionReceipt,
} from '@/lib/evm';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ClockIcon,
  LoaderIcon,
  ShieldIcon,
  SparklesIcon,
} from '@/components/ui/Icons';

type Step = 1 | 2 | 3 | 4 | 5 | 6;

interface ConditionData {
  enabled: boolean;
  oracleType: 'mock' | 'band' | '';
  threshold: string;
  above: boolean;
  useTreasuryCheck: boolean;
  treasuryThreshold: string;
}

type SmartFeature = 'NONE' | 'SPLIT' | 'STREAMING';

const STREAMING_PRESETS = [
  { label: '4 tranches, monthly', numTranches: 4, intervalSeconds: 30 * 24 * 60 * 60 },
  { label: '12 tranches, monthly', numTranches: 12, intervalSeconds: 30 * 24 * 60 * 60 },
  { label: '7 tranches, daily', numTranches: 7, intervalSeconds: 24 * 60 * 60 },
  { label: '4 tranches, weekly', numTranches: 4, intervalSeconds: 7 * 24 * 60 * 60 },
];

interface FormData {
  sourceChain: number;
  amount: string;
  duration: number;
  isCustomDuration: boolean;
  customDuration: string;
  vaultType: 'FIXED' | 'FLEXIBLE';
  destinationChain: number;
  bridgeProtocol: 'CCTP';
  tokenAddress: string;
  condition: ConditionData;
  smartFeature: SmartFeature;
  savingsBps: number;
  yieldBps: number;
  reserveBps: number;
  numTranches: number;
  intervalSeconds: number;
}

interface PendingCreateRecovery {
  amount: string;
  duration: number;
  sourceChain: number;
  destinationChain: number;
  bridgeProtocol: 'CCTP';
  tokenAddress: string;
  vaultType: 'FIXED' | 'FLEXIBLE';
  ownerAddress: string;
  sourceTxHash: string;
  cctpBurnAmount: string;
  cctpMaxFeeAmount: string;
  cctpFinalityThreshold: number;
  createdAt: number;
  condition?: ConditionData;
  splitConfig?: { savingsBps: number; yieldBps: number; reserveBps: number };
  streamingConfig?: { numTranches: number; intervalSeconds: number };
}

const initialCondition: ConditionData = {
  enabled: false,
  oracleType: '',
  threshold: '',
  above: true,
  useTreasuryCheck: false,
  treasuryThreshold: '',
};

const initialFormData: FormData = {
  sourceChain: 84532,
  amount: '',
  duration: 7 * 24 * 60 * 60 * 1000,
  isCustomDuration: false,
  customDuration: '',
  vaultType: 'FIXED',
  destinationChain: CANONICAL_CHAIN,
  bridgeProtocol: 'CCTP',
  tokenAddress: CHAINS[84532].usdc,
  condition: initialCondition,
  smartFeature: 'NONE',
  savingsBps: 5000,
  yieldBps: 3000,
  reserveBps: 2000,
  numTranches: STREAMING_PRESETS[0].numTranches,
  intervalSeconds: STREAMING_PRESETS[0].intervalSeconds,
};

const SPLIT_PIE_COLORS = ['#22d3ee', '#a78bfa', '#fbbf24'];

function conditionPayload(condition: ConditionData) {
  if (!condition.enabled || (!condition.oracleType && !condition.useTreasuryCheck)) {
    return undefined;
  }

  return {
    oracleType: condition.oracleType || undefined,
    threshold: condition.oracleType ? condition.threshold || '0' : undefined,
    above: condition.above,
    useTreasuryCheck: condition.useTreasuryCheck,
    treasuryThreshold: condition.useTreasuryCheck ? condition.treasuryThreshold || '0' : undefined,
  };
}

function buildSplitConfig(formData: FormData) {
  return {
    savingsBps: formData.savingsBps,
    yieldBps: formData.yieldBps,
    reserveBps: formData.reserveBps,
  };
}

function buildStreamingConfig(formData: FormData) {
  return {
    numTranches: formData.numTranches,
    intervalSeconds: formData.intervalSeconds,
  };
}

function formatDuration(durationMs: number) {
  const minutes = durationMs / (60 * 1000);
  const hours = durationMs / (60 * 60 * 1000);
  const days = durationMs / (24 * 60 * 60 * 1000);

  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  return `${days} day${days === 1 ? '' : 's'}`;
}

function recoveryStorageKey(address?: string) {
  return `chronos_pending_create:${address || 'unknown'}`;
}

export default function CreateVaultPage() {
  const router = useRouter();
  const { address, getProvider, connect, switchChain } = useWallet();
  const { showNotification } = useUIStore();

  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingRecovery, setPendingRecovery] = useState<PendingCreateRecovery | null>(null);
  const [manualRecoveryTxHash, setManualRecoveryTxHash] = useState('');

  const walletAddress = address?.toLowerCase() ?? undefined;

  useEffect(() => {
    if (!walletAddress) {
      return;
    }

    const stored = localStorage.getItem(recoveryStorageKey(walletAddress));
    if (!stored) {
      setPendingRecovery(null);
      return;
    }

    try {
      setPendingRecovery(JSON.parse(stored));
    } catch {
      localStorage.removeItem(recoveryStorageKey(walletAddress));
      setPendingRecovery(null);
    }
  }, [walletAddress]);

  const savePendingRecovery = (recovery: PendingCreateRecovery) => {
    localStorage.setItem(recoveryStorageKey(recovery.ownerAddress), JSON.stringify(recovery));
    setPendingRecovery(recovery);
  };

  const clearPendingRecovery = (ownerAddress?: string) => {
    if (ownerAddress) {
      localStorage.removeItem(recoveryStorageKey(ownerAddress));
    }
    setPendingRecovery(null);
  };

  const handleCreateResult = (data: any, ownerAddress?: string) => {
    if (data?.status === 'PROCESSING') {
      showNotification(
        'The burn is still settling on Arc. Keep this recovery card open and retry shortly if the vault does not appear.',
        'info',
        12000
      );
      return;
    }

    clearPendingRecovery(ownerAddress || walletAddress);
    showNotification('Vault recovered from submitted burn.', 'success');
    if (data?.vaultId) {
      router.replace(`/dashboard/${data.vaultId}?created=1`);
    } else {
      router.replace('/dashboard');
    }
  };

  const mutation = useMutation({
    mutationFn: async () => {
      console.log('[create-vault] Starting vault creation...', { formData, walletAddress });

      const activeAddress = walletAddress;
      if (!activeAddress) {
        connect();
        throw new Error('No wallet connected. Please connect a wallet first.');
      }

      const preflight = await vaultService.getCreateVaultPreflight();
      if (!preflight.arcSettlement.ready) {
        throw new Error(
          preflight.arcSettlement.reason ||
            'Arc settlement is not ready. Redeploy or reconfigure the Arc contracts before creating a vault.'
        );
      }

      const sourceConfig = CHAINS[formData.sourceChain];
      const timelockVaultAddress = CONTRACT_ADDRESSES.TIMELOCK_VAULT;

      console.log('[create-vault] Checking config:', {
        sourceConfig,
        timelockVaultAddress,
        cctpTokenMessenger: sourceConfig?.cctpTokenMessenger,
      });

      if (!sourceConfig?.cctpTokenMessenger) {
        throw new Error('CCTP is not configured for the selected source chain.');
      }

      if (!timelockVaultAddress) {
        throw new Error('Destination vault contract address is missing. Check NEXT_PUBLIC_TIMELOCK_VAULT in .env');
      }

      const rawTokenAddress = sourceConfig.usdc;
      if (!rawTokenAddress || rawTokenAddress === '0x...') {
        throw new Error('Source chain token address is not configured.');
      }

      // Normalize all addresses to EIP-55 checksum format (viem is strict about this)
      const tokenAddress = getAddress(rawTokenAddress);
      const cctpTokenMessenger = getAddress(sourceConfig.cctpTokenMessenger);
      const normalizedTimelockVault = getAddress(timelockVaultAddress);

      const lockAmountUnits = parseUnits(formData.amount, 6);
      const mintRecipient = toBytes32Address(normalizedTimelockVault);

      // Privy providers are bound to the wallet's active chain. Switch first, then
      // acquire a fresh EIP-1193 provider for source-chain transactions.
      console.log('[create-vault] Switching chain to:', formData.sourceChain);
      await switchChain(formData.sourceChain);

      const activeProvider = await getProvider();
      if (!activeProvider) {
        throw new Error('No wallet provider found.');
      }

      await waitForWalletChain(activeProvider, formData.sourceChain, sourceConfig.name);
      await assertContractCode(activeProvider, tokenAddress, `${sourceConfig.name} USDC`);
      await assertContractCode(activeProvider, cctpTokenMessenger, `${sourceConfig.name} CCTP TokenMessenger`);

      console.log('[create-vault] Got provider, sending approve tx...');

      let maxFeeAmount = 0n;
      let finalityThreshold = CCTP_STANDARD_FINALITY_THRESHOLD;
      try {
        const feeQuote = await vaultService.getCctpTransferFee(
          formData.sourceChain,
          CANONICAL_CHAIN,
          formData.amount,
          CCTP_FAST_FINALITY_THRESHOLD
        );
        maxFeeAmount = BigInt(feeQuote.maxFee || '0');
        finalityThreshold = feeQuote.finalityThreshold || CCTP_FAST_FINALITY_THRESHOLD;
      } catch (feeError) {
        console.warn(
          '[create-vault] CCTP fast fee quote unavailable; using standard finality.',
          getTransactionErrorLog(feeError, 'Could not quote CCTP fee')
        );
      }

      const burnAmountUnits = lockAmountUnits + maxFeeAmount;
      const burnAmount = formatUnits(burnAmountUnits, 6);

      const currentAllowance = await getErc20Allowance(
        activeProvider,
        activeAddress,
        tokenAddress,
        cctpTokenMessenger
      );

      if (currentAllowance < burnAmountUnits) {
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

        console.log('[create-vault] Approve tx sent:', approveHash);
        await waitForTransactionReceipt(activeProvider, approveHash, 'USDC approval');
        await waitForErc20Allowance(
          activeProvider,
          activeAddress,
          tokenAddress,
          cctpTokenMessenger,
          burnAmountUnits
        );
      }

      showNotification('Submitting CCTP bridge transaction...', 'info');
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

      console.log('[create-vault] Burn tx sent:', burnHash);
      await waitForTransactionReceipt(activeProvider, burnHash, 'CCTP bridge');

      const duration =
        formData.isCustomDuration
          ? parseInt(formData.customDuration)
          : formData.duration;
      const recoveryPayload: PendingCreateRecovery = {
        amount: formData.amount,
        duration,
        sourceChain: formData.sourceChain,
        destinationChain: CANONICAL_CHAIN,
        bridgeProtocol: formData.bridgeProtocol,
        tokenAddress,
        vaultType: formData.vaultType,
        ownerAddress: activeAddress,
        sourceTxHash: burnHash,
        cctpBurnAmount: burnAmount,
        cctpMaxFeeAmount: maxFeeAmount.toString(),
        cctpFinalityThreshold: finalityThreshold,
        createdAt: Date.now(),
        condition: formData.condition,
        splitConfig: formData.smartFeature === 'SPLIT' ? buildSplitConfig(formData) : undefined,
        streamingConfig: formData.smartFeature === 'STREAMING' ? buildStreamingConfig(formData) : undefined,
      };
      savePendingRecovery(recoveryPayload);

      console.log('[create-vault] Calling backend to create vault...');
      return vaultService.createVault(
        formData.amount,
        duration,
        formData.sourceChain,
        CANONICAL_CHAIN,
        formData.bridgeProtocol,
        tokenAddress,
        formData.vaultType,
        activeAddress,
        burnHash,
        burnAmount,
        maxFeeAmount.toString(),
        finalityThreshold,
        {
          condition: conditionPayload(formData.condition),
          splitConfig: formData.smartFeature === 'SPLIT' ? buildSplitConfig(formData) : undefined,
          streamingConfig: formData.smartFeature === 'STREAMING' ? buildStreamingConfig(formData) : undefined,
        }
      );
    },
    onSuccess: (data) => {
      console.log('[create-vault] Success:', data);
      if (data?.status === 'PROCESSING') {
        handleCreateResult(data);
        return;
      }

      clearPendingRecovery(walletAddress);
      showNotification('Vault created successfully!', 'success');
      router.replace(data?.vaultId ? `/dashboard/${data.vaultId}?created=1` : '/dashboard');
    },
    onError: (error: any) => {
      const message = getTransactionErrorMessage(error, 'Failed to create vault');
      console.error('[create-vault] Error:', getTransactionErrorLog(error, 'Failed to create vault'));
      showNotification(message, 'error');
    },
  });

  const recoveryMutation = useMutation({
    mutationFn: async (recovery: PendingCreateRecovery) => {
      showNotification('Recovering vault from submitted burn transaction...', 'info', 10000);
      try {
        const existingBridge = await vaultService.getBridgeStatus(recovery.sourceTxHash);
        if (existingBridge?.vaultId) {
          return {
            vaultId: existingBridge.vaultId,
            status: 'RECOVERED_EXISTING',
            bridgeTxHash: existingBridge.txHash,
            bridgeStatus: {
              state: existingBridge.status === 'COMPLETE' ? 'COMPLETE' : 'PENDING_ATTESTATION',
            },
          };
        }
      } catch (lookupError: any) {
        if (lookupError?.response?.status && lookupError.response.status !== 404) {
          console.warn(
            '[create-vault:recover] Existing bridge lookup failed; falling back to recovery.',
            getTransactionErrorLog(lookupError, 'Bridge lookup failed')
          );
        }
      }

      return vaultService.createVault(
        recovery.amount,
        recovery.duration,
        recovery.sourceChain,
        recovery.destinationChain,
        recovery.bridgeProtocol,
        recovery.tokenAddress,
        recovery.vaultType,
        recovery.ownerAddress,
        recovery.sourceTxHash,
        recovery.cctpBurnAmount,
        recovery.cctpMaxFeeAmount,
        recovery.cctpFinalityThreshold,
        {
          condition: recovery.condition ? conditionPayload(recovery.condition) : undefined,
          splitConfig: recovery.splitConfig,
          streamingConfig: recovery.streamingConfig,
        }
      );
    },
    onSuccess: (data, recovery) => {
      handleCreateResult(data, recovery.ownerAddress);
    },
    onError: (error: any) => {
      const message = getTransactionErrorMessage(error, 'Failed to recover vault');
      console.error('[create-vault:recover] Error:', getTransactionErrorLog(error, 'Failed to recover vault'));
      showNotification(message, 'error', 12000);
    },
  });

  const handleManualRecovery = () => {
    if (!walletAddress) {
      showNotification('Connect your wallet before recovering a submitted burn.', 'error');
      return;
    }

    if (!manualRecoveryTxHash.startsWith('0x')) {
      showNotification('Paste the source-chain burn transaction hash first.', 'error');
      return;
    }

    if (!formData.amount || Number(formData.amount) <= 0) {
      showNotification('Enter the vault amount before recovering.', 'error');
      return;
    }

    const recovery: PendingCreateRecovery = {
      amount: formData.amount,
      duration: formData.isCustomDuration ? parseInt(formData.customDuration) : formData.duration,
      sourceChain: formData.sourceChain,
      destinationChain: CANONICAL_CHAIN,
      bridgeProtocol: formData.bridgeProtocol,
      tokenAddress: getAddress(CHAINS[formData.sourceChain].usdc),
      vaultType: formData.vaultType,
      ownerAddress: walletAddress,
      sourceTxHash: manualRecoveryTxHash,
      cctpBurnAmount: formData.amount,
      cctpMaxFeeAmount: '0',
      cctpFinalityThreshold: CCTP_STANDARD_FINALITY_THRESHOLD,
      createdAt: Date.now(),
      splitConfig: formData.smartFeature === 'SPLIT' ? buildSplitConfig(formData) : undefined,
      streamingConfig: formData.smartFeature === 'STREAMING' ? buildStreamingConfig(formData) : undefined,
    };

    savePendingRecovery(recovery);
    recoveryMutation.mutate(recovery);
  };

  const validateStep = (step: Step): boolean => {
    const newErrors: Record<string, string> = {};

    if (step === 1) {
      if (!formData.sourceChain) {
        newErrors.sourceChain = 'Please select a source chain';
      }
    }

    if (step === 2) {
      if (!formData.amount || parseFloat(formData.amount) <= 0) {
        newErrors.amount = 'Amount must be greater than 0';
      }
      if (
        formData.isCustomDuration &&
        (!formData.customDuration ||
          parseInt(formData.customDuration) < MIN_DURATION ||
          parseInt(formData.customDuration) > MAX_DURATION)
      ) {
        newErrors.customDuration = `Duration must be between ${MIN_DURATION / 1000 / 60} mins and ${MAX_DURATION / 1000 / 60 / 60 / 24} days`;
      }
    }

    if (step === 4) {
      if (formData.smartFeature === 'SPLIT') {
        const sum = formData.savingsBps + formData.yieldBps + formData.reserveBps;
        if (sum !== 10000) {
          newErrors.split = `Savings + Yield + Reserve must sum to 100% (currently ${(sum / 100).toFixed(2)}%)`;
        }
      }
      if (formData.smartFeature === 'STREAMING') {
        if (!formData.numTranches || formData.numTranches < 2 || formData.numTranches > 60) {
          newErrors.streaming = 'Number of tranches must be between 2 and 60';
        }
        if (!formData.intervalSeconds || formData.intervalSeconds <= 0) {
          newErrors.streaming = 'Tranche interval must be greater than 0';
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      if (currentStep < 6) {
        setCurrentStep((currentStep + 1) as Step);
      }
    }
  };

  const handlePrev = () => {
    if (currentStep > 1) {
      setCurrentStep((currentStep - 1) as Step);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('[create-vault] handleSubmit fired', {
      currentStep,
      walletAddress,
      hasWallet: !!walletAddress,
      formData,
    });

    if (!validateStep(currentStep)) {
      console.warn('[create-vault] Validation failed at step', currentStep);
      return;
    }

    if (!walletAddress) {
      console.warn('[create-vault] No wallet detected', { walletAddress });
      showNotification('No wallet connected. Please connect a wallet and try again.', 'error');
      return;
    }

    console.log('[create-vault] Triggering mutation.mutate()');
    mutation.mutate();
  };

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold text-light mb-2">Create New Vault</h1>
      <p className="text-light/60 mb-8">Lock your tokens for discipline. Choose your terms. Test mode currently allows 5-minute vaults.</p>

      <form onSubmit={handleSubmit}>
        <VaultStepper currentStep={currentStep} totalSteps={6} />

        {pendingRecovery && (
          <div className="card mb-6 border-yellow-500/30 bg-yellow-500/10">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="font-semibold text-yellow-200">Submitted burn waiting for vault recovery</div>
                <div className="mt-1 break-all font-mono text-xs text-light/70">
                  {pendingRecovery.sourceTxHash}
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => recoveryMutation.mutate(pendingRecovery)}
                  disabled={recoveryMutation.isPending || mutation.isPending}
                  className="rounded-lg bg-primary px-4 py-2 font-bold text-dark transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {recoveryMutation.isPending ? 'Recovering...' : 'Recover Vault'}
                </button>
                <button
                  type="button"
                  onClick={() => clearPendingRecovery(pendingRecovery.ownerAddress)}
                  disabled={recoveryMutation.isPending}
                  className="rounded-lg border border-primary/40 px-4 py-2 text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 1: Source Chain */}
        {currentStep === 1 && (
          <div className="card mb-8">
            <h2 className="text-xl font-bold text-light mb-6">Step 1: Select Source Chain</h2>
            <p className="text-light/60 mb-6">Which chain will you deposit from?</p>

            <div className="space-y-3">
              {SOURCE_CHAINS.map((chainId) => (
                <label key={chainId} className="flex items-center p-4 border border-primary/20 rounded-lg hover:bg-primary/5 cursor-pointer transition-colors">
                  <input
                    type="radio"
                    name="sourceChain"
                    value={chainId}
                    checked={formData.sourceChain === chainId}
                    onChange={(e) => {
                      const nextChainId = parseInt(e.target.value, 10);
                      setFormData({
                        ...formData,
                        sourceChain: nextChainId,
                        destinationChain: CANONICAL_CHAIN,
                        tokenAddress: CHAINS[nextChainId].usdc,
                      });
                    }}
                    className="w-4 h-4"
                  />
                  <div className="ml-4">
                    <div className="font-semibold text-light">{CHAINS[chainId].name}</div>
                    <div className="text-sm text-light/60">{CHAINS[chainId].rpc}</div>
                  </div>
                </label>
              ))}
            </div>
            {errors.sourceChain && <div className="text-red-400 text-sm mt-4">{errors.sourceChain}</div>}
          </div>
        )}

        {/* Step 2: Amount & Duration */}
        {currentStep === 2 && (
          <div className="card mb-8 space-y-6">
            <h2 className="text-xl font-bold text-light">Step 2: Amount & Duration</h2>

            {/* Amount */}
            <div>
              <label className="block text-light font-semibold mb-2">Amount (USDC)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                placeholder="Enter amount"
                className="input-field"
              />
              {errors.amount && <div className="text-red-400 text-sm mt-1">{errors.amount}</div>}
            </div>

            {/* Duration */}
            <div>
              <label className="block text-light font-semibold mb-2">Lock Duration</label>

              {!formData.isCustomDuration ? (
                <>
                  <select
                    value={formData.duration}
                    onChange={(e) => setFormData({ ...formData, duration: parseInt(e.target.value) })}
                    className="input-field mb-3"
                  >
                    {DURATION_PRESETS.map((preset) => (
                      <option key={preset.value} value={preset.value}>
                        {preset.label}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, isCustomDuration: true })}
                    className="text-primary text-sm hover:underline"
                  >
                    Set custom duration
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="number"
                    min={MIN_DURATION}
                    max={MAX_DURATION}
                    value={formData.customDuration}
                    onChange={(e) => setFormData({ ...formData, customDuration: e.target.value })}
                    placeholder="Duration in milliseconds (min 300000)"
                    className="input-field mb-3"
                  />
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, isCustomDuration: false })}
                    className="text-primary text-sm hover:underline"
                  >
                    Use presets
                  </button>
                  {errors.customDuration && <div className="text-red-400 text-sm mt-1">{errors.customDuration}</div>}
                </>
              )}
            </div>
          </div>
        )}

        {/* Step 3: Vault Type */}
        {currentStep === 3 && (
          <div className="card mb-8">
            <h2 className="text-xl font-bold text-light mb-6">Step 3: Vault Type</h2>

            <div className="space-y-4">
              <label className="flex items-start p-6 border-2 border-primary/30 rounded-lg hover:bg-primary/5 cursor-pointer transition-all">
                <input
                  type="radio"
                  name="vaultType"
                  value="FIXED"
                  checked={formData.vaultType === 'FIXED'}
                  onChange={() => setFormData({ ...formData, vaultType: 'FIXED' })}
                  className="w-5 h-5 mt-1"
                />
                <div className="ml-4">
                  <div className="inline-flex items-center gap-2 text-lg font-bold text-primary">
                    <ClockIcon className="h-5 w-5" />
                    FIXED Vault
                  </div>
                  <div className="text-light/70 mt-2">
                    Immutable unlock date. No early withdrawals. Zero penalty. Maximum discipline.
                  </div>
                  <div className="text-primary text-sm mt-3 font-mono">0% penalty • Always</div>
                </div>
              </label>

              <label className="flex items-start p-6 border-2 border-accent/30 rounded-lg hover:bg-accent/5 cursor-pointer transition-all">
                <input
                  type="radio"
                  name="vaultType"
                  value="FLEXIBLE"
                  checked={formData.vaultType === 'FLEXIBLE'}
                  onChange={() => setFormData({ ...formData, vaultType: 'FLEXIBLE' })}
                  className="w-5 h-5 mt-1"
                />
                <div className="ml-4">
                  <div className="inline-flex items-center gap-2 text-lg font-bold text-accent">
                    <ShieldIcon className="h-5 w-5" />
                    FLEXIBLE Vault
                  </div>
                  <div className="text-light/70 mt-2">
                    Withdraw anytime. 0.5% penalty if before unlock. 0% penalty at unlock.
                  </div>
                  <div className="text-accent text-sm mt-3 font-mono">0.5% penalty (early) • 0% at unlock</div>
                </div>
              </label>
            </div>
          </div>
        )}

        {/* Step 4: Conditional Unlock (optional) + Smart Features (optional Smart Split or Streaming release) */}
        {currentStep === 4 && (
          <div className="card mb-8 space-y-6">
            <div>
              <h2 className="text-xl font-bold text-light mb-2">Step 4: Conditional Unlock (Optional)</h2>
              <p className="text-light/60">
                On top of the time lock, you can require an oracle price condition and/or a
                treasury-balance guard before the vault can be claimed. Both are AND'd with the
                time unlock and with each other.
              </p>
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.condition.enabled}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    condition: { ...formData.condition, enabled: e.target.checked },
                  })
                }
                className="w-5 h-5"
              />
              <span className="font-semibold text-light">Add an unlock condition</span>
            </label>

            {formData.condition.enabled && (
              <div className="space-y-6 border-t border-primary/10 pt-6">
                <div>
                  <label className="block text-light font-semibold mb-2">Oracle price condition</label>
                  <select
                    value={formData.condition.oracleType}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        condition: { ...formData.condition, oracleType: e.target.value as ConditionData['oracleType'] },
                      })
                    }
                    className="input-field mb-3"
                  >
                    <option value="">None</option>
                    <option value="mock">Mock Price Oracle (demo, admin-settable)</option>
                    <option value="band">Band Protocol (live Arc testnet feed, USDC/USD)</option>
                  </select>

                  {formData.condition.oracleType && (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <label className="block text-light/70 text-sm mb-1">
                          Threshold (raw oracle units{formData.condition.oracleType === 'band' ? ', 18 decimals' : ''})
                        </label>
                        <input
                          type="text"
                          value={formData.condition.threshold}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              condition: { ...formData.condition, threshold: e.target.value },
                            })
                          }
                          placeholder="e.g. 100"
                          className="input-field"
                        />
                      </div>
                      <div>
                        <label className="block text-light/70 text-sm mb-1">Direction</label>
                        <select
                          value={formData.condition.above ? 'above' : 'below'}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              condition: { ...formData.condition, above: e.target.value === 'above' },
                            })
                          }
                          className="input-field"
                        >
                          <option value="above">Price must be &gt;= threshold</option>
                          <option value="below">Price must be &lt;= threshold</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="flex items-center gap-3 cursor-pointer mb-3">
                    <input
                      type="checkbox"
                      checked={formData.condition.useTreasuryCheck}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          condition: { ...formData.condition, useTreasuryCheck: e.target.checked },
                        })
                      }
                      className="w-5 h-5"
                    />
                    <span className="font-semibold text-light">Require a minimum Treasury USDC balance</span>
                  </label>

                  {formData.condition.useTreasuryCheck && (
                    <div>
                      <label className="block text-light/70 text-sm mb-1">Minimum Treasury balance (USDC)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={formData.condition.treasuryThreshold}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            condition: { ...formData.condition, treasuryThreshold: e.target.value },
                          })
                        }
                        placeholder="e.g. 1000"
                        className="input-field"
                      />
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-light/70">
                  Conditioned vaults are created via a backend-relayer write path (the deployed
                  BridgeOrchestrator does not yet expose oracle/treasury params). This is a
                  documented hackathon-timeline tradeoff - see arcSettlementService.settleVaultAdvanced.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 4b: Smart Features (optional) */}
        {currentStep === 4 && (
          <div className="card mb-8">
            <h2 className="text-xl font-bold text-light mb-2">Smart Features</h2>
            <p className="text-light/60 mb-6">
              Optional. Choose at most one: auto-allocate the deposit into savings/yield/reserve buckets, or release it gradually over multiple tranches.
            </p>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 mb-6">
              <label
                className={`flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer transition-all ${
                  formData.smartFeature === 'NONE' ? 'border-primary/60 bg-primary/5' : 'border-primary/20 hover:bg-primary/5'
                }`}
              >
                <input
                  type="radio"
                  name="smartFeature"
                  value="NONE"
                  checked={formData.smartFeature === 'NONE'}
                  onChange={() => setFormData({ ...formData, smartFeature: 'NONE' })}
                  className="w-4 h-4 mt-1"
                />
                <div>
                  <div className="font-semibold text-light">Standard</div>
                  <div className="text-xs text-light/60 mt-1">Single lump-sum unlock at maturity.</div>
                </div>
              </label>

              <label
                className={`flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer transition-all ${
                  formData.smartFeature === 'SPLIT' ? 'border-primary/60 bg-primary/5' : 'border-primary/20 hover:bg-primary/5'
                }`}
              >
                <input
                  type="radio"
                  name="smartFeature"
                  value="SPLIT"
                  checked={formData.smartFeature === 'SPLIT'}
                  onChange={() => setFormData({ ...formData, smartFeature: 'SPLIT' })}
                  className="w-4 h-4 mt-1"
                />
                <div>
                  <div className="font-semibold text-light">Smart Split</div>
                  <div className="text-xs text-light/60 mt-1">Auto-allocate into savings / yield / reserve buckets, claimable separately at maturity.</div>
                </div>
              </label>

              <label
                className={`flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer transition-all ${
                  formData.smartFeature === 'STREAMING' ? 'border-primary/60 bg-primary/5' : 'border-primary/20 hover:bg-primary/5'
                }`}
              >
                <input
                  type="radio"
                  name="smartFeature"
                  value="STREAMING"
                  checked={formData.smartFeature === 'STREAMING'}
                  onChange={() => setFormData({ ...formData, smartFeature: 'STREAMING' })}
                  className="w-4 h-4 mt-1"
                />
                <div>
                  <div className="font-semibold text-light">Streaming Release</div>
                  <div className="text-xs text-light/60 mt-1">Release the deposit gradually over N equal tranches at a fixed interval.</div>
                </div>
              </label>
            </div>

            {formData.smartFeature === 'SPLIT' && (
              <div className="border border-primary/20 rounded-lg p-5">
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 items-center">
                  <div className="space-y-5">
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-light/70">Savings</span>
                        <span className="font-mono text-primary">{(formData.savingsBps / 100).toFixed(1)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={10000}
                        step={100}
                        value={formData.savingsBps}
                        onChange={(e) => {
                          const savingsBps = parseInt(e.target.value, 10);
                          const remaining = 10000 - savingsBps;
                          const yieldShare = formData.yieldBps + formData.reserveBps || 1;
                          const yieldBps = Math.round((remaining * formData.yieldBps) / yieldShare);
                          const reserveBps = remaining - yieldBps;
                          setFormData({ ...formData, savingsBps, yieldBps, reserveBps });
                        }}
                        className="w-full accent-[#22d3ee]"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-light/70">Yield</span>
                        <span className="font-mono text-primary">{(formData.yieldBps / 100).toFixed(1)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={10000}
                        step={100}
                        value={formData.yieldBps}
                        onChange={(e) => {
                          const yieldBps = parseInt(e.target.value, 10);
                          const remaining = 10000 - yieldBps;
                          const otherShare = formData.savingsBps + formData.reserveBps || 1;
                          const savingsBps = Math.round((remaining * formData.savingsBps) / otherShare);
                          const reserveBps = remaining - savingsBps;
                          setFormData({ ...formData, savingsBps, yieldBps, reserveBps });
                        }}
                        className="w-full accent-[#a78bfa]"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-light/70">Reserve</span>
                        <span className="font-mono text-primary">{(formData.reserveBps / 100).toFixed(1)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={10000}
                        step={100}
                        value={formData.reserveBps}
                        onChange={(e) => {
                          const reserveBps = parseInt(e.target.value, 10);
                          const remaining = 10000 - reserveBps;
                          const otherShare = formData.savingsBps + formData.yieldBps || 1;
                          const savingsBps = Math.round((remaining * formData.savingsBps) / otherShare);
                          const yieldBps = remaining - savingsBps;
                          setFormData({ ...formData, savingsBps, yieldBps, reserveBps });
                        }}
                        className="w-full accent-[#fbbf24]"
                      />
                    </div>
                    <div className="text-xs text-light/50">
                      Total: {((formData.savingsBps + formData.yieldBps + formData.reserveBps) / 100).toFixed(1)}% (must equal 100%)
                    </div>
                  </div>

                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Savings', value: formData.savingsBps },
                            { name: 'Yield', value: formData.yieldBps },
                            { name: 'Reserve', value: formData.reserveBps },
                          ]}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={2}
                        >
                          {SPLIT_PIE_COLORS.map((color) => (
                            <Cell key={color} fill={color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => `${(value / 100).toFixed(1)}%`} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                {errors.split && <div className="text-red-400 text-sm mt-4">{errors.split}</div>}
              </div>
            )}

            {formData.smartFeature === 'STREAMING' && (
              <div className="border border-primary/20 rounded-lg p-5 space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {STREAMING_PRESETS.map((preset) => {
                    const isSelected =
                      formData.numTranches === preset.numTranches && formData.intervalSeconds === preset.intervalSeconds;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() =>
                          setFormData({
                            ...formData,
                            numTranches: preset.numTranches,
                            intervalSeconds: preset.intervalSeconds,
                          })
                        }
                        className={`p-3 rounded-lg border text-left transition-colors ${
                          isSelected
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-primary/20 text-light/70 hover:bg-primary/5'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-light/70 text-sm mb-2">Number of tranches</label>
                    <input
                      type="number"
                      min={2}
                      max={60}
                      value={formData.numTranches}
                      onChange={(e) => setFormData({ ...formData, numTranches: parseInt(e.target.value, 10) || 0 })}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="block text-light/70 text-sm mb-2">Interval between tranches (seconds)</label>
                    <input
                      type="number"
                      min={1}
                      value={formData.intervalSeconds}
                      onChange={(e) => setFormData({ ...formData, intervalSeconds: parseInt(e.target.value, 10) || 0 })}
                      className="input-field"
                    />
                  </div>
                </div>

                <div className="text-xs text-light/50">
                  Each tranche releases ~{(100 / (formData.numTranches || 1)).toFixed(2)}% of the deposit, roughly every{' '}
                  {formatDuration(formData.intervalSeconds * 1000)}.
                </div>
                {errors.streaming && <div className="text-red-400 text-sm">{errors.streaming}</div>}
              </div>
            )}
          </div>
        )}

        {/* Step 5: Review */}
        {currentStep === 5 && (
          <div className="card mb-8">
            <h2 className="text-xl font-bold text-light mb-6">Step 5: Review Details</h2>

            <div className="space-y-4">
              <div className="flex justify-between items-center py-3 border-b border-primary/10">
                <div className="text-light/60">Amount</div>
                <div className="font-bold text-primary text-lg">${parseFloat(formData.amount || '0').toFixed(2)}</div>
              </div>

              <div className="flex justify-between items-center py-3 border-b border-primary/10">
                <div className="text-light/60">Source Chain</div>
                <div className="font-semibold">{CHAINS[formData.sourceChain].name}</div>
              </div>

              <div className="flex justify-between items-center py-3 border-b border-primary/10">
                <div className="text-light/60">Vault Settlement</div>
                <div className="text-right">
                  <div className="font-semibold">{CHAINS[CANONICAL_CHAIN].name}</div>
                  <div className="text-xs text-light/50">Claim or withdraw destination is chosen later</div>
                </div>
              </div>

              <div className="flex justify-between items-center py-3 border-b border-primary/10">
                <div className="text-light/60">Vault Type</div>
                <div className="font-semibold">
                  {formData.vaultType === 'FIXED' ? (
                    <span className="inline-flex items-center gap-2">
                      <ClockIcon className="h-4 w-4" />
                      FIXED
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <ShieldIcon className="h-4 w-4" />
                      FLEXIBLE
                    </span>
                  )}
                </div>
              </div>

              <div className="flex justify-between items-center py-3 border-b border-primary/10">
                <div className="text-light/60">Lock Duration</div>
                <div className="font-semibold">
                  {formData.isCustomDuration
                    ? formatDuration(parseInt(formData.customDuration || '0', 10))
                    : formatDuration(formData.duration)}
                </div>
              </div>

              <div className="flex justify-between items-center py-3 border-b border-primary/10">
                <div className="text-light/60">Bridge Protocol</div>
                <div className="font-semibold">{formData.bridgeProtocol}</div>
              </div>

              <div className="flex justify-between items-center py-3 border-b border-primary/10">
                <div className="text-light/60">Unlock Condition</div>
                <div className="text-right font-semibold">
                  {!formData.condition.enabled ? (
                    <span className="text-light/50">None (time-lock only)</span>
                  ) : (
                    <div className="space-y-1 text-sm">
                      {formData.condition.oracleType && (
                        <div>
                          {formData.condition.oracleType === 'mock' ? 'Mock Oracle' : 'Band Protocol'} price{' '}
                          {formData.condition.above ? '>=' : '<='} {formData.condition.threshold || '0'}
                        </div>
                      )}
                      {formData.condition.useTreasuryCheck && (
                        <div>Treasury balance &gt;= ${formData.condition.treasuryThreshold || '0'}</div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-between items-center py-3 border-b border-primary/10">
                <div className="text-light/60">Smart Feature</div>
                <div className="text-right">
                  {formData.smartFeature === 'NONE' && <span className="font-semibold">Standard</span>}
                  {formData.smartFeature === 'SPLIT' && (
                    <div className="font-semibold">
                      Smart Split
                      <div className="text-xs text-light/50 font-normal mt-1">
                        Savings {(formData.savingsBps / 100).toFixed(1)}% · Yield {(formData.yieldBps / 100).toFixed(1)}% · Reserve {(formData.reserveBps / 100).toFixed(1)}%
                      </div>
                    </div>
                  )}
                  {formData.smartFeature === 'STREAMING' && (
                    <div className="font-semibold">
                      Streaming Release
                      <div className="text-xs text-light/50 font-normal mt-1">
                        {formData.numTranches} tranches, every {formatDuration(formData.intervalSeconds * 1000)}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-between items-center py-3">
                <div className="text-light/60">Fee</div>
                <div className="font-semibold text-green-400">Free (Testnet)</div>
              </div>
            </div>
          </div>
        )}

        {/* Step 6: Confirm */}
        {currentStep === 6 && (
          <div className="card mb-8">
            <h2 className="text-xl font-bold text-light mb-6">Step 6: Confirm & Create</h2>
            <p className="text-light/70 mb-6">
              By clicking "Create Vault", you agree to lock your tokens on Arc Testnet according to the terms specified above.
              {formData.vaultType === 'FIXED' && ' FIXED vaults cannot be withdrawn from early.'}
              {formData.vaultType === 'FLEXIBLE' && ' FLEXIBLE vaults charge a 0.5% penalty for early withdrawals.'}
              {' You can choose Arc or the source chain when claiming or withdrawing.'}
            </p>

            <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 mb-6">
              <div className="inline-flex items-center gap-2 text-primary font-semibold">
                <CheckIcon className="h-4 w-4" />
                Ready to create vault
              </div>
              <div className="text-light/70 text-sm mt-2">All details confirmed. No changes allowed after creation.</div>
            </div>

            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
              <div className="font-semibold text-yellow-200">Recover a submitted burn</div>
              <div className="mt-1 text-sm text-light/70">
                Use this if your wallet burn succeeded but the backend timed out before showing a vault.
              </div>
              <div className="mt-4 flex flex-col gap-3 md:flex-row">
                <input
                  type="text"
                  value={manualRecoveryTxHash}
                  onChange={(event) => setManualRecoveryTxHash(event.target.value.trim())}
                  placeholder="0x source-chain burn tx hash"
                  className="input-field flex-1"
                />
                <button
                  type="button"
                  onClick={handleManualRecovery}
                  disabled={recoveryMutation.isPending || mutation.isPending}
                  className="rounded-lg border border-primary px-4 py-3 font-bold text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                >
                  {recoveryMutation.isPending ? 'Recovering...' : 'Recover'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Navigation Buttons */}
        <div className="flex gap-4 justify-between">
          <button
            type="button"
            onClick={handlePrev}
            disabled={currentStep === 1}
            className="px-6 py-3 border border-primary text-primary rounded-lg hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="inline-flex items-center gap-2">
              <ArrowLeftIcon className="h-4 w-4" />
              Back
            </span>
          </button>

          {currentStep < 6 ? (
            <button
              type="button"
              onClick={handleNext}
              className="px-6 py-3 bg-primary text-dark font-bold rounded-lg hover:bg-primary/90 transition-colors"
            >
              <span className="inline-flex items-center gap-2">
                Next
                <ArrowRightIcon className="h-4 w-4" />
              </span>
            </button>
          ) : (
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-8 py-3 bg-green-500 text-dark font-bold rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {mutation.isPending ? (
                <span className="inline-flex items-center gap-2">
                  <LoaderIcon className="h-4 w-4 animate-spin" />
                  Creating...
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <SparklesIcon className="h-4 w-4" />
                  Create Vault
                </span>
              )}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
