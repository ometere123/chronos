import express from 'express';
import { ethers } from 'ethers';
import { asyncHandler } from '../middleware/errorHandler.js';
import { contractAddresses } from '../config/contracts.js';
import logger from '../config/logger.js';

const router = express.Router();

const USDC_DECIMALS = 6;

// Read-only ABI for CreditLine - matches contracts/arc/CreditLine.sol exactly.
const CREDIT_LINE_ABI = [
  'function availableLiquidity() view returns (uint256)',
  'function totalBorrowed() view returns (uint256)',
  'function totalLpShares() view returns (uint256)',
  'function accInterestPerShare() view returns (uint256)',
  'function INTEREST_BPS() view returns (uint16)',
  'function MAX_LTV_BPS() view returns (uint16)',
  'function lpShares(address) view returns (uint256)',
  'function pendingInterest(address) view returns (uint256)',
  'function getLoan(bytes32) view returns (tuple(bytes32 vaultId, address borrower, uint256 principal, uint256 collateralValue, uint256 startTime, bool active))',
  'function interestOwed(bytes32) view returns (uint256)',
  'function totalOwed(bytes32) view returns (uint256)',
  'function maxBorrowable(bytes32) view returns (uint256)',
];

const TIMELOCK_VAULT_ABI = [
  'function vaultLocked(bytes32) view returns (bool)',
];

function getContext() {
  const { arcRpcUrl, creditLine, timeLockVault } = contractAddresses;

  if (!arcRpcUrl || !creditLine) {
    return null;
  }

  const provider = new ethers.JsonRpcProvider(arcRpcUrl);
  const creditLineContract = new ethers.Contract(creditLine, CREDIT_LINE_ABI, provider);
  const timeLockVaultContract = timeLockVault
    ? new ethers.Contract(timeLockVault, TIMELOCK_VAULT_ABI, provider)
    : null;

  return { provider, creditLineContract, timeLockVaultContract };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableRpcError(err) {
  const message = err?.shortMessage || err?.reason || err?.message || '';
  return (
    /request limit reached/i.test(message) ||
    /could not coalesce error/i.test(message) ||
    /timeout/i.test(message) ||
    /timed out/i.test(message) ||
    // Discovered live: Arc's rate-limited RPC gateway sometimes returns an empty/malformed
    // response under load instead of a proper rate-limit error, which ethers surfaces as
    // "missing revert data" - indistinguishable from a genuine missing-function revert except
    // that here it's intermittent on calls that succeed moments later. Retrying is safe because
    // a truly missing function fails identically on every attempt and still exhausts the retry
    // budget into a real error.
    /missing revert data/i.test(message)
  );
}

// Arc's testnet RPC has shown real, repeated rate-limiting under load ("request limit reached")
// during live testing - hitting several getter calls at once via Promise.all reliably triggers
// it. Runs calls one at a time with a short gap and retries transient failures, instead of
// firing them all simultaneously.
async function readAllWithRetry(readFns, maxAttempts = 4) {
  const results = [];
  for (const readFn of readFns) {
    let attempt = 0;
    let lastError = null;
    while (attempt < maxAttempts) {
      try {
        results.push(await readFn());
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        attempt += 1;
        if (!isRetryableRpcError(err) || attempt >= maxAttempts) {
          throw err;
        }
        await sleep(attempt * 1000);
      }
    }
    if (lastError) {
      throw lastError;
    }
    await sleep(150);
  }
  return results;
}

function notConfiguredResponse(res) {
  return res.status(503).json({
    error: {
      message: 'CreditLine is not configured (missing RPC URL or ARC_CREDIT_LINE_ADDRESS).',
    },
  });
}

// Pool / lender stats - total liquidity, outstanding borrows, and effective interest rate.
router.get('/pool', asyncHandler(async (req, res) => {
  const ctx = getContext();
  if (!ctx) {
    return notConfiguredResponse(res);
  }

  try {
    const { creditLineContract } = ctx;

    const [availableLiquidity, totalBorrowed, totalLpShares, interestBps, maxLtvBps] = await readAllWithRetry([
      () => creditLineContract.availableLiquidity(),
      () => creditLineContract.totalBorrowed(),
      () => creditLineContract.totalLpShares(),
      () => creditLineContract.INTEREST_BPS(),
      () => creditLineContract.MAX_LTV_BPS(),
    ]);

    const totalPool = availableLiquidity + totalBorrowed;
    const utilizationBps = totalPool > 0n ? Number((totalBorrowed * 10000n) / totalPool) : 0;

    res.json({
      source: 'on-chain-live',
      contracts: {
        creditLine: contractAddresses.creditLine,
        usdc: contractAddresses.usdc,
      },
      availableLiquidityRaw: availableLiquidity.toString(),
      totalBorrowedRaw: totalBorrowed.toString(),
      totalPoolRaw: totalPool.toString(),
      totalLpSharesRaw: totalLpShares.toString(),
      availableLiquidity: ethers.formatUnits(availableLiquidity, USDC_DECIMALS),
      totalBorrowed: ethers.formatUnits(totalBorrowed, USDC_DECIMALS),
      totalPool: ethers.formatUnits(totalPool, USDC_DECIMALS),
      totalLpShares: ethers.formatUnits(totalLpShares, USDC_DECIMALS),
      utilizationBps,
      interestBps: Number(interestBps),
      maxLtvBps: Number(maxLtvBps),
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Error reading CreditLine pool stats', { error: err.message });
    res.status(502).json({ error: { message: 'Failed to read CreditLine pool stats', detail: err.message } });
  }
}));

// A lender's position: shares (principal) + pending pro-rata interest.
router.get('/lender/:address', asyncHandler(async (req, res) => {
  const ctx = getContext();
  if (!ctx) {
    return notConfiguredResponse(res);
  }

  const { address } = req.params;
  if (!ethers.isAddress(address)) {
    return res.status(400).json({ error: { message: 'Invalid lender address' } });
  }

  try {
    const { creditLineContract } = ctx;
    const [shares, pending] = await readAllWithRetry([
      () => creditLineContract.lpShares(address),
      () => creditLineContract.pendingInterest(address),
    ]);

    res.json({
      address: ethers.getAddress(address),
      sharesRaw: shares.toString(),
      pendingInterestRaw: pending.toString(),
      shares: ethers.formatUnits(shares, USDC_DECIMALS),
      pendingInterest: ethers.formatUnits(pending, USDC_DECIMALS),
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Error reading CreditLine lender position', { error: err.message, address });
    res.status(502).json({ error: { message: 'Failed to read lender position', detail: err.message } });
  }
}));

// A specific vault's credit line status - borrowed amount, LTV, collateral lock state.
router.get('/vault/:vaultId', asyncHandler(async (req, res) => {
  const ctx = getContext();
  if (!ctx) {
    return notConfiguredResponse(res);
  }

  const { vaultId } = req.params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(vaultId)) {
    return res.status(400).json({ error: { message: 'Invalid vaultId (expected bytes32 hex string)' } });
  }

  try {
    const { creditLineContract, timeLockVaultContract } = ctx;

    const [loan, maxBorrowable, locked] = await readAllWithRetry([
      () => creditLineContract.getLoan(vaultId),
      () => creditLineContract.maxBorrowable(vaultId).catch(() => 0n),
      () => (timeLockVaultContract ? timeLockVaultContract.vaultLocked(vaultId) : Promise.resolve(false)),
    ]);

    const active = Boolean(loan.active);
    const principal = loan.principal ?? 0n;
    const collateralValue = loan.collateralValue ?? 0n;

    let interestOwed = 0n;
    let totalOwed = 0n;
    if (active) {
      [interestOwed, totalOwed] = await readAllWithRetry([
        () => creditLineContract.interestOwed(vaultId),
        () => creditLineContract.totalOwed(vaultId),
      ]);
    }

    const ltvBps = collateralValue > 0n ? Number((principal * 10000n) / collateralValue) : 0;

    res.json({
      vaultId,
      hasActiveLoan: active,
      locked,
      borrower: active ? loan.borrower : null,
      principalRaw: principal.toString(),
      collateralValueRaw: collateralValue.toString(),
      interestOwedRaw: interestOwed.toString(),
      totalOwedRaw: totalOwed.toString(),
      maxBorrowableRaw: maxBorrowable.toString(),
      principal: ethers.formatUnits(principal, USDC_DECIMALS),
      collateralValue: ethers.formatUnits(collateralValue, USDC_DECIMALS),
      interestOwed: ethers.formatUnits(interestOwed, USDC_DECIMALS),
      totalOwed: ethers.formatUnits(totalOwed, USDC_DECIMALS),
      maxBorrowable: ethers.formatUnits(maxBorrowable, USDC_DECIMALS),
      ltvBps,
      startTime: active ? Number(loan.startTime) : null,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Error reading CreditLine vault status', { error: err.message, vaultId });
    res.status(502).json({ error: { message: 'Failed to read vault credit line status', detail: err.message } });
  }
}));

export default router;
