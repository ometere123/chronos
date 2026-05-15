'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { encodeFunctionData, formatUnits, parseUnits, getAddress } from 'viem';
import VaultStepper from '@/components/ui/VaultStepper';
import { vaultService } from '@/services/vaultService';
import { CONTRACT_ADDRESSES, DURATION_PRESETS, MIN_DURATION, MAX_DURATION } from '@/config/constants';
import { ARC_CCTP_DOMAIN, CHAINS, SOURCE_CHAINS, CANONICAL_CHAIN } from '@/config/chains';
import { useUIStore } from '@/store/uiStore';
import { useInjectedWallet } from '@/hooks/useInjectedWallet';
import {
  CCTP_FAST_FINALITY_THRESHOLD,
  CCTP_STANDARD_FINALITY_THRESHOLD,
  CCTP_TOKEN_MESSENGER_ABI,
  ERC20_APPROVE_ABI,
  ZERO_BYTES32,
  assertContractCode,
  getTransactionErrorLog,
  getTransactionErrorMessage,
  simulateTransaction,
  toBytes32Address,
  waitForErc20Allowance,
  waitForWalletChain,
  waitForTransactionReceipt,
} from '@/lib/evm';

type Step = 1 | 2 | 3 | 4 | 5;

interface FormData {
  sourceChain: number;
  amount: string;
  duration: number;
  isCustomDuration: boolean;
  customDuration: string;
  vaultType: 'FIXED' | 'FLEXIBLE';
  destinationChain: number;
  bridgeProtocol: 'CCTP' | 'LayerZero';
  tokenAddress: string;
}

interface PendingCreateRecovery {
  amount: string;
  duration: number;
  sourceChain: number;
  destinationChain: number;
  bridgeProtocol: 'CCTP' | 'LayerZero';
  tokenAddress: string;
  vaultType: 'FIXED' | 'FLEXIBLE';
  ownerAddress: string;
  sourceTxHash: string;
  cctpBurnAmount: string;
  cctpMaxFeeAmount: string;
  cctpFinalityThreshold: number;
  createdAt: number;
}

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
};

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
  const { address, provider, connect, switchChain } = useInjectedWallet();
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

      let activeAddress = walletAddress;
      if (!activeAddress) {
        activeAddress = await connect();
      }

      if (!activeAddress) {
        throw new Error('No wallet connected. Please connect a wallet first.');
      }

      const preflight = await vaultService.getCreateVaultPreflight();
      if (!preflight.arcSettlement.ready) {
        throw new Error(
          preflight.arcSettlement.reason ||
            'Arc settlement is not ready. Redeploy or reconfigure the Arc contracts before creating a vault.'
        );
      }

      const activeProvider = window.ethereum;
      if (!activeProvider) {
        throw new Error('No injected wallet provider found.');
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

      // Switch chain on the injected wallet before source-chain transactions.
      console.log('[create-vault] Switching chain to:', formData.sourceChain);
      await switchChain(formData.sourceChain);
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
        finalityThreshold
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
        recovery.cctpFinalityThreshold
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

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      if (currentStep < 5) {
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
      hasProvider: !!provider,
      formData,
    });

    if (!validateStep(currentStep)) {
      console.warn('[create-vault] Validation failed at step', currentStep);
      return;
    }

    if (!walletAddress && !provider) {
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
        <VaultStepper currentStep={currentStep} totalSteps={5} />

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
                  <div className="text-lg font-bold text-primary">⏰ FIXED Vault</div>
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
                  <div className="text-lg font-bold text-accent">🛡️ FLEXIBLE Vault</div>
                  <div className="text-light/70 mt-2">
                    Withdraw anytime. 0.5% penalty if before unlock. 0% penalty at unlock.
                  </div>
                  <div className="text-accent text-sm mt-3 font-mono">0.5% penalty (early) • 0% at unlock</div>
                </div>
              </label>
            </div>
          </div>
        )}

        {/* Step 4: Review */}
        {currentStep === 4 && (
          <div className="card mb-8">
            <h2 className="text-xl font-bold text-light mb-6">Step 4: Review Details</h2>

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
                <div className="font-semibold">{formData.vaultType === 'FIXED' ? '⏰ FIXED' : '🛡️ FLEXIBLE'}</div>
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

              <div className="flex justify-between items-center py-3">
                <div className="text-light/60">Fee</div>
                <div className="font-semibold text-green-400">Free (Testnet)</div>
              </div>
            </div>
          </div>
        )}

        {/* Step 5: Confirm */}
        {currentStep === 5 && (
          <div className="card mb-8">
            <h2 className="text-xl font-bold text-light mb-6">Step 5: Confirm & Create</h2>
            <p className="text-light/70 mb-6">
              By clicking "Create Vault", you agree to lock your tokens on Arc Testnet according to the terms specified above.
              {formData.vaultType === 'FIXED' && ' FIXED vaults cannot be withdrawn from early.'}
              {formData.vaultType === 'FLEXIBLE' && ' FLEXIBLE vaults charge a 0.5% penalty for early withdrawals.'}
              {' You can choose Arc or the source chain when claiming or withdrawing.'}
            </p>

            <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 mb-6">
              <div className="text-primary font-semibold">✅ Ready to create vault</div>
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
            ← Back
          </button>

          {currentStep < 5 ? (
            <button
              type="button"
              onClick={handleNext}
              className="px-6 py-3 bg-primary text-dark font-bold rounded-lg hover:bg-primary/90 transition-colors"
            >
              Next →
            </button>
          ) : (
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-8 py-3 bg-green-500 text-dark font-bold rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {mutation.isPending ? '⏳ Creating...' : '🎉 Create Vault'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
