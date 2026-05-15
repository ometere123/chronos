import '../config/env.js';
import axios from 'axios';
import logger from '../config/logger.js';

export const gasEstimationService = {
  // Get gas prices for chains
  async getGasPrices(fromChain, toChain) {
    try {
      const rpcMap = {
        5042002: process.env.ARC_TESTNET_RPC || 'https://rpc.testnet.arc.network',
        84532: process.env.BASE_SEPOLIA_RPC,
        421614: process.env.ARBITRUM_SEPOLIA_RPC,
        11155111: process.env.ETHEREUM_SEPOLIA_RPC,
        11155420: process.env.OP_SEPOLIA_RPC,
      };

      const fromRpc = rpcMap[fromChain];
      const toRpc = rpcMap[toChain];

      if (!fromRpc || !toRpc) {
        throw new Error('Invalid chain configuration');
      }

      // Get gas price from source chain
      const fromGasResponse = await axios.post(fromRpc, {
        jsonrpc: '2.0',
        method: 'eth_gasPrice',
        params: [],
        id: 1
      });

      const fromGasPrice = parseInt(fromGasResponse.data.result, 16);

      // Get gas price from destination chain
      const toGasResponse = await axios.post(toRpc, {
        jsonrpc: '2.0',
        method: 'eth_gasPrice',
        params: [],
        id: 1
      });

      const toGasPrice = parseInt(toGasResponse.data.result, 16);

      return {
        fromChain,
        toChain,
        fromGasPrice: (fromGasPrice / 1e9).toFixed(2), // Convert to Gwei
        toGasPrice: (toGasPrice / 1e9).toFixed(2),
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      logger.error('Error getting gas prices', { error: err.message });
      // Return fallback values
      return {
        fromChain,
        toChain,
        fromGasPrice: '20', // Fallback: 20 Gwei
        toGasPrice: '20',
        timestamp: new Date().toISOString(),
        fallback: true
      };
    }
  },

  // Estimate bridge fee
  async estimateBridgeFee(amount, bridgeProtocol, fromChain, toChain) {
    try {
      if (bridgeProtocol !== 'CCTP') {
        throw new Error(`Unsupported bridge protocol: ${bridgeProtocol}`);
      }

      // CCTP typically has lower fees (0.01-0.1%).
      const baseFee = parseFloat(amount) * 0.0005; // 0.05% placeholder

      // Add gas costs based on destination
      const gasCosts = parseFloat(amount) * 0.0001; // 0.01% placeholder for gas

      const totalFee = baseFee + gasCosts;

      return {
        amount,
        bridgeProtocol,
        fromChain,
        toChain,
        baseFee: totalFee.toFixed(6),
        gasCosts: gasCosts.toFixed(6),
        totalFee: totalFee.toFixed(6),
        percentage: ((totalFee / parseFloat(amount)) * 100).toFixed(4)
      };
    } catch (err) {
      logger.error('Error estimating bridge fee', { error: err.message });
      throw err;
    }
  },

  // Calculate final amount after fees
  async calculateFinalAmount(amount, vaultType, isEarlyWithdraw = false, bridgeFee = '0') {
    try {
      let deductions = parseFloat(bridgeFee);

      // Add early withdrawal penalty if applicable
      if (vaultType === 'FLEXIBLE' && isEarlyWithdraw) {
        const penalty = parseFloat(amount) * 0.005; // 0.5% penalty
        deductions += penalty;
      }

      const finalAmount = parseFloat(amount) - deductions;

      return {
        originalAmount: amount,
        vaultType,
        isEarlyWithdraw,
        bridgeFee: parseFloat(bridgeFee).toFixed(6),
        penalty: isEarlyWithdraw ? (parseFloat(amount) * 0.005).toFixed(6) : '0',
        totalDeductions: deductions.toFixed(6),
        finalAmount: finalAmount.toFixed(6),
        percentage: ((deductions / parseFloat(amount)) * 100).toFixed(4)
      };
    } catch (err) {
      logger.error('Error calculating final amount', { error: err.message });
      throw err;
    }
  },

  // Get dynamic gas estimate for transaction
  async getDynamicGasEstimate(txType, fromChain, toChain) {
    try {
      // Different transaction types have different gas costs
      const gasCosts = {
        'create-vault': 200000, // Approximate
        'add-to-vault': 100000,
        'claim-vault': 150000,
        'withdraw-flexible': 120000,
        'bridge-cctp': 300000,
      };

      const baseGas = gasCosts[txType] || 200000;

      // Adjust based on chain
      let multiplier = 1;
      if (toChain === 421614) multiplier = 1.2; // Arbitrum is slightly more expensive
      if (toChain === 11155111) multiplier = 1.5; // Ethereum mainnet would be much more
      if (toChain === 11155420) multiplier = 1.35; // OP Sepolia gas profile

      const estimatedGas = Math.ceil(baseGas * multiplier);

      // Get current gas price
      const gasPrices = await this.getGasPrices(fromChain, toChain);

      const estimatedCost = (estimatedGas * parseFloat(gasPrices.fromGasPrice) / 1e9).toFixed(6);

      return {
        txType,
        fromChain,
        toChain,
        estimatedGas,
        gasPrice: gasPrices.fromGasPrice,
        estimatedCost: estimatedCost,
        unit: 'ETH'
      };
    } catch (err) {
      logger.error('Error getting dynamic gas estimate', { error: err.message });
      throw err;
    }
  }
};
