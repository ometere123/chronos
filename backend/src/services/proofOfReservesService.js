import { pool } from '../config/database.js';
import logger from '../config/logger.js';
import { ethers } from 'ethers';
import { contractAddresses, getExplorerAddressUrl } from '../config/contracts.js';

// verifyLiveReserves() recomputes directly from TimeLockVault's on-chain storage (every vault,
// summed live) rather than getReserveDetails()'s reliance on VaultFactory's counters - those
// counters are never populated in practice, since deposits are created directly on TimeLockVault
// via BridgeOrchestrator and never go through VaultFactory. getReserveDetails() doesn't error,
// it just silently returns 0s - confirmed live. verifyLiveReserves() is the reliable source.
const PROOF_OF_RESERVES_ABI = [
  'function verifyLiveReserves() view returns (uint256 usdcBalance, uint256 activeLocked, uint256 activeVaultCount, bool fullyReserved)',
];

const USDC_DECIMALS = 6;

function formatUsdc(value) {
  return ethers.formatUnits(value || 0n, USDC_DECIMALS);
}

function getContractMetadata() {
  return {
    arcChainId: contractAddresses.arcChainId,
    explorerBaseUrl: contractAddresses.explorerBaseUrl,
    usdc: contractAddresses.usdc,
    timeLockVault: contractAddresses.timeLockVault,
    vaultFactory: contractAddresses.vaultFactory,
    bridgeOrchestrator: contractAddresses.bridgeOrchestrator,
    treasury: contractAddresses.treasury,
    proofOfReserves: contractAddresses.proofOfReserves,
    links: {
      usdc: getExplorerAddressUrl(contractAddresses.usdc),
      timeLockVault: getExplorerAddressUrl(contractAddresses.timeLockVault),
      vaultFactory: getExplorerAddressUrl(contractAddresses.vaultFactory),
      bridgeOrchestrator: getExplorerAddressUrl(contractAddresses.bridgeOrchestrator),
      treasury: getExplorerAddressUrl(contractAddresses.treasury),
      proofOfReserves: getExplorerAddressUrl(contractAddresses.proofOfReserves),
    },
  };
}

async function getDatabaseReserveData() {
  const statsResult = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN status IN ('ACTIVE', 'MATURE') THEN total_amount ELSE 0 END), 0) as total_locked,
      COUNT(*) as total_vaults,
      COUNT(DISTINCT owner_address) as total_users,
      COALESCE(SUM(CASE WHEN status = 'CLAIMED' THEN total_amount ELSE 0 END), 0) as total_claimed
    FROM vaults
  `);

  const stats = statsResult.rows[0];

  const byChainResult = await pool.query(`
    SELECT source_chain, COALESCE(SUM(total_amount), 0) as amount
    FROM vaults
    WHERE status IN ('ACTIVE', 'MATURE')
    GROUP BY source_chain
  `);

  const byChain = {};
  byChainResult.rows.forEach(row => {
    byChain[row.source_chain] = row.amount.toString();
  });

  const byTokenResult = await pool.query(`
    SELECT token_address, COALESCE(SUM(total_amount), 0) as amount
    FROM vaults
    WHERE status IN ('ACTIVE', 'MATURE')
    GROUP BY token_address
  `);

  const byToken = {};
  byTokenResult.rows.forEach(row => {
    byToken[row.token_address || 'USDC'] = row.amount.toString();
  });

  return {
    totalLocked: stats.total_locked.toString(),
    byChain,
    byToken,
    totalVaults: parseInt(stats.total_vaults, 10),
    totalUsers: parseInt(stats.total_users, 10),
    totalClaimed: stats.total_claimed.toString(),
  };
}

async function getOnChainReserveData() {
  const {
    arcRpcUrl,
    proofOfReserves,
    timeLockVault,
    usdc,
  } = contractAddresses;

  if (!arcRpcUrl || !proofOfReserves || !timeLockVault || !usdc) {
    throw new Error('Proof of reserves contract, TimeLockVault, USDC, or Arc RPC is not configured');
  }

  const provider = new ethers.JsonRpcProvider(arcRpcUrl);
  const proofContract = new ethers.Contract(proofOfReserves, PROOF_OF_RESERVES_ABI, provider);

  const [usdcBalanceRaw, activeLockedRaw, activeVaultCount, fullyReserved] =
    await proofContract.verifyLiveReserves();

  return {
    proofContractTotalLockedRaw: activeLockedRaw,
    timeLockVaultBalanceRaw: usdcBalanceRaw,
    proofContractTotalLocked: formatUsdc(activeLockedRaw),
    proofContractTotalVaults: Number(activeVaultCount),
    proofContractTotalUsers: null,
    proofContractVerified: Boolean(fullyReserved),
    timeLockVaultBalance: formatUsdc(usdcBalanceRaw),
  };
}

export const proofOfReservesService = {
  // Get proof of reserves data
  async getProofOfReserves() {
    try {
      const databaseReserves = await getDatabaseReserveData();
      const contracts = getContractMetadata();
      let onChain = null;
      let source = 'database';
      let verified = false;
      let timeLockVaultBalance = databaseReserves.totalLocked;

      let onChainLiabilities = databaseReserves.totalLocked;

      try {
        const chainReserves = await getOnChainReserveData();
        // Trust the contract's own live-computed fullyReserved / activeLocked entirely - not a
        // comparison against database totals, which is exactly the unreliable dependency this
        // was meant to remove. verifyLiveReserves() already recomputes both sides on-chain.
        verified = chainReserves.proofContractVerified;
        timeLockVaultBalance = chainReserves.timeLockVaultBalance;
        onChainLiabilities = chainReserves.proofContractTotalLocked;
        onChain = {
          proofContractTotalLocked: chainReserves.proofContractTotalLocked,
          proofContractTotalVaults: chainReserves.proofContractTotalVaults,
          proofContractTotalUsers: chainReserves.proofContractTotalUsers,
          proofContractVerified: chainReserves.proofContractVerified,
          timeLockVaultBalance: chainReserves.timeLockVaultBalance,
        };
        source = 'on-chain';
      } catch (chainErr) {
        logger.warn('On-chain proof of reserves unavailable, using database totals', {
          error: chainErr.message,
        });
        verified = false;
        onChain = {
          error: chainErr.message,
        };
        source = 'database-fallback';
      }

      return {
        ...databaseReserves,
        verified,
        verificationDetails: {
          timeLockVaultBalance,
          userLiabilities: onChainLiabilities,
          match: verified
        },
        source,
        contracts,
        onChain,
        updatedAt: new Date().toISOString()
      };
    } catch (err) {
      logger.error('Error generating proof of reserves', { error: err.message });
      throw err;
    }
  },

  // Save proof of reserves to history
  async saveProofOfReserves(proofData) {
    try {
      const result = await pool.query(
        `INSERT INTO protocol_stats (total_locked, total_vaults, total_users, total_claimed)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [proofData.totalLocked, proofData.totalVaults, proofData.totalUsers, proofData.totalClaimed]
      );
      return result.rows[0];
    } catch (err) {
      logger.error('Error saving proof of reserves', { error: err.message });
      throw err;
    }
  },

  // Get proof of reserves history
  async getProofOfReservesHistory(limit = 100) {
    try {
      const result = await pool.query(
        'SELECT * FROM protocol_stats ORDER BY updated_at DESC LIMIT $1',
        [limit]
      );
      return result.rows;
    } catch (err) {
      logger.error('Error fetching proof of reserves history', { error: err.message });
      throw err;
    }
  }
};
