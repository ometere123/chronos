'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { encodeFunctionData, getAddress, parseUnits } from 'viem';
import { ARC_CHAIN_ID, CHAINS } from '@/config/chains';
import { CONTRACT_ADDRESSES } from '@/config/constants';
import { useWallet } from '@/hooks/useWallet';
import {
  CREDIT_LINE_ABI,
  ERC20_APPROVE_ABI,
  getTransactionErrorMessage,
  simulateTransaction,
  waitForErc20Allowance,
  waitForTransactionReceipt,
} from '@/lib/evm';
import { creditLineService } from '@/services/creditLineService';
import { useUIStore } from '@/store/uiStore';

function formatUsdAmount(value: number) {
  return `$${Math.max(value, 0).toFixed(2)}`;
}

export default function LendPage() {
  const queryClient = useQueryClient();
  const { showNotification } = useUIStore();
  const { address, getProvider, switchChain } = useWallet();

  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');

  const creditLineAddress = CONTRACT_ADDRESSES.CREDIT_LINE;

  const { data: poolStats, isLoading: poolLoading } = useQuery({
    queryKey: ['creditLinePool'],
    queryFn: () => creditLineService.getPoolStats(),
    enabled: !!creditLineAddress,
    refetchInterval: 10000,
  });

  const { data: lenderPosition, isLoading: positionLoading } = useQuery({
    queryKey: ['creditLineLender', address],
    queryFn: () => creditLineService.getLenderPosition(address as string),
    enabled: !!creditLineAddress && !!address,
    refetchInterval: 10000,
  });

  const depositMutation = useMutation({
    mutationFn: async () => {
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
      const amountUnits = parseUnits(depositAmount, 6);

      showNotification('Approving USDC for the lending pool. Confirm it in your wallet.', 'info');
      const approveData = encodeFunctionData({
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [creditLineAddr, amountUnits],
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
      await waitForErc20Allowance(activeProvider, activeAddress, arcUsdc, creditLineAddr, amountUnits);

      const depositData = encodeFunctionData({
        abi: CREDIT_LINE_ABI,
        functionName: 'depositLiquidity',
        args: [amountUnits],
      });

      const depositTx = {
        from: activeAddress,
        to: creditLineAddr,
        data: depositData,
        value: '0x0',
      } as const;

      await simulateTransaction(activeProvider, depositTx, 'Deposit liquidity');

      showNotification('Submitting deposit transaction. Confirm it in your wallet.', 'info');
      const depositHash = (await activeProvider.request({
        method: 'eth_sendTransaction',
        params: [depositTx],
      })) as `0x${string}`;

      await waitForTransactionReceipt(activeProvider, depositHash, 'Deposit liquidity');

      return { depositHash };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['creditLinePool'] });
      await queryClient.invalidateQueries({ queryKey: ['creditLineLender', address] });
      showNotification('Deposit successful! You are now earning pro-rata interest.', 'success');
      setDepositAmount('');
    },
    onError: (error: any) =>
      showNotification(getTransactionErrorMessage(error, 'Failed to deposit'), 'error'),
  });

  const withdrawMutation = useMutation({
    mutationFn: async () => {
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

      const creditLineAddr = getAddress(creditLineAddress);
      const amountUnits = parseUnits(withdrawAmount, 6);

      const withdrawData = encodeFunctionData({
        abi: CREDIT_LINE_ABI,
        functionName: 'withdrawLiquidity',
        args: [amountUnits],
      });

      const withdrawTx = {
        from: activeAddress,
        to: creditLineAddr,
        data: withdrawData,
        value: '0x0',
      } as const;

      await simulateTransaction(activeProvider, withdrawTx, 'Withdraw liquidity');

      showNotification('Submitting withdrawal transaction. Confirm it in your wallet.', 'info');
      const withdrawHash = (await activeProvider.request({
        method: 'eth_sendTransaction',
        params: [withdrawTx],
      })) as `0x${string}`;

      await waitForTransactionReceipt(activeProvider, withdrawHash, 'Withdraw liquidity');

      return { withdrawHash };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['creditLinePool'] });
      await queryClient.invalidateQueries({ queryKey: ['creditLineLender', address] });
      showNotification('Withdrawal successful!', 'success');
      setWithdrawAmount('');
    },
    onError: (error: any) =>
      showNotification(getTransactionErrorMessage(error, 'Failed to withdraw'), 'error'),
  });

  const lenderShares = parseFloat(lenderPosition?.shares || '0');
  const lenderPending = parseFloat(lenderPosition?.pendingInterest || '0');
  const maxWithdrawable = lenderShares;

  if (!creditLineAddress) {
    return (
      <div className="card border-amber-500/30 bg-amber-500/10">
        <div className="font-semibold text-amber-300">CreditLine is not configured</div>
        <p className="mt-2 text-light/60">
          Set NEXT_PUBLIC_CREDIT_LINE in the frontend environment to enable lending.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-light">Lend USDC</h1>
        <p className="mt-1 text-light/60">
          Deposit USDC into the CreditLine pool and earn a pro-rata share of interest paid by borrowers.
        </p>
      </div>

      <div className="card">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div>
            <div className="mb-2 text-sm text-light/60">Total Pool Liquidity</div>
            <div className="text-2xl font-bold text-primary">
              {poolLoading ? '...' : formatUsdAmount(parseFloat(poolStats?.totalPool || '0'))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-sm text-light/60">Available to Borrow</div>
            <div className="text-2xl font-bold text-light">
              {poolLoading ? '...' : formatUsdAmount(parseFloat(poolStats?.availableLiquidity || '0'))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-sm text-light/60">Interest Rate</div>
            <div className="text-2xl font-bold text-light">
              {poolLoading ? '...' : `${((poolStats?.interestBps || 0) / 100).toFixed(2)}%`}
            </div>
            <div className="mt-1 text-xs text-light/40">flat, per loan</div>
          </div>
        </div>
      </div>

      {address && (
        <div className="card">
          <h3 className="mb-4 text-lg font-bold text-light">Your Position</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-primary/10 bg-dark/20 p-4">
              <div className="text-xs text-light/60">Deposited</div>
              <div className="mt-2 font-mono text-xl font-bold text-primary">
                {positionLoading ? '...' : formatUsdAmount(lenderShares)}
              </div>
            </div>
            <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-4">
              <div className="text-xs text-light/60">Pending Interest</div>
              <div className="mt-2 font-mono text-xl font-bold text-green-300">
                {positionLoading ? '...' : formatUsdAmount(lenderPending)}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="card">
          <h3 className="mb-4 text-lg font-bold text-light">Deposit</h3>
          <p className="mb-4 text-sm text-light/60">
            Deposit USDC to start earning interest. Interest auto-compounds into your principal.
          </p>
          <input
            type="number"
            step="0.01"
            min="0"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            placeholder="Amount to deposit"
            className="input-field mb-4"
            disabled={depositMutation.isPending}
          />
          <button
            onClick={() => depositMutation.mutate()}
            disabled={!depositAmount || parseFloat(depositAmount) <= 0 || depositMutation.isPending}
            className="w-full rounded-lg bg-primary px-4 py-3 font-bold text-dark transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {depositMutation.isPending ? 'Depositing...' : 'Deposit USDC'}
          </button>
        </div>

        <div className="card">
          <h3 className="mb-4 text-lg font-bold text-light">Withdraw</h3>
          <p className="mb-4 text-sm text-light/60">
            Withdraw your principal plus any accrued interest. Limited by available pool liquidity.
          </p>
          <input
            type="number"
            step="0.01"
            min="0"
            max={maxWithdrawable}
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            placeholder="Amount to withdraw"
            className="input-field mb-4"
            disabled={withdrawMutation.isPending || maxWithdrawable <= 0}
          />
          <button
            onClick={() => withdrawMutation.mutate()}
            disabled={
              !withdrawAmount ||
              parseFloat(withdrawAmount) <= 0 ||
              parseFloat(withdrawAmount) > maxWithdrawable ||
              withdrawMutation.isPending
            }
            className="w-full rounded-lg bg-accent px-4 py-3 font-bold text-dark transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {withdrawMutation.isPending ? 'Withdrawing...' : 'Withdraw'}
          </button>
        </div>
      </div>
    </div>
  );
}
