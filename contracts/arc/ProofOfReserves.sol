// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./TimeLockVault.sol";
import "./VaultFactory.sol";

/// @title ProofOfReserves
/// @notice Provides real-time reserve transparency and verification
contract ProofOfReserves is Ownable {
    event ReservesVerified(uint256 totalLocked, uint256 totalVaults, bool verified);

    TimeLockVault public timeLockVault;
    VaultFactory public vaultFactory;
    address public usdcToken;

    constructor(address _timeLockVault, address _vaultFactory, address _usdc) {
        require(_timeLockVault != address(0), "Invalid TimeLockVault");
        require(_vaultFactory != address(0), "Invalid VaultFactory");
        require(_usdc != address(0), "Invalid USDC");

        timeLockVault = TimeLockVault(_timeLockVault);
        vaultFactory = VaultFactory(_vaultFactory);
        usdcToken = _usdc;
    }

    /// @notice Get total USDC locked
    function getTotalUSDCLocked() external view returns (uint256) {
        return vaultFactory.getTotalLockedByToken(usdcToken);
    }

    /// @notice Get total tokens locked (any token)
    function getTotalTokenLocked(address tokenAddress) external view returns (uint256) {
        return vaultFactory.getTotalLockedByToken(tokenAddress);
    }

    /// @notice Get locked amount by chain
    function getLockedByChain(uint32 chainId) external view returns (uint256) {
        return vaultFactory.getTotalLockedByChain(chainId);
    }

    /// @notice Get locked amount for user
    function getLockedByUser(address userAddress) external view returns (uint256 total) {
        bytes32[] memory vaultIds = timeLockVault.getUserVaults(userAddress);
        for (uint256 i = 0; i < vaultIds.length; i++) {
            TimeLockVault.Vault memory vault = timeLockVault.getVault(vaultIds[i]);
            if (vault.status == TimeLockVault.VaultStatus.ACTIVE) {
                total += vault.totalAmount;
            }
        }
    }

    /// @notice Check if reserves are fully backed
    function isFullyReserved() external view returns (bool) {
        uint256 contractBalance = IERC20(usdcToken).balanceOf(address(timeLockVault));
        uint256 totalLocked = vaultFactory.getTotalLocked();
        return contractBalance >= totalLocked;
    }

    /// @notice Get complete reserve details
    function getReserveDetails() external view returns (
        uint256 totalLocked,
        uint256 totalVaults,
        uint256 totalUsers,
        bool verified
    ) {
        totalLocked = vaultFactory.getTotalLocked();
        totalVaults = vaultFactory.getTotalVaults();

        // Note: totalUsers would require tracking, simplified here
        totalUsers = 0;

        uint256 contractBalance = IERC20(usdcToken).balanceOf(address(timeLockVault));
        verified = contractBalance >= totalLocked;
    }

    /// @notice Verify reserves and emit event
    function verifyReserves() external returns (bool) {
        uint256 totalLocked = vaultFactory.getTotalLocked();
        uint256 totalVaults = vaultFactory.getTotalVaults();
        uint256 contractBalance = IERC20(usdcToken).balanceOf(address(timeLockVault));

        bool isVerified = contractBalance >= totalLocked;
        emit ReservesVerified(totalLocked, totalVaults, isVerified);

        return isVerified;
    }
}
