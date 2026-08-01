// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./TimeLockVault.sol";

/// @title VaultFactory
/// @notice Creates new vaults, manages vault registry, maintains statistics
contract VaultFactory is Ownable, ReentrancyGuard {
    event VaultCreated(
        bytes32 indexed vaultId,
        address indexed owner,
        uint256 amount,
        uint256 unlockAt,
        TimeLockVault.VaultType vaultType
    );
    event StatsUpdated(uint256 totalLocked, uint256 totalVaults);

    uint256 public constant MIN_DURATION = 30 minutes;
    uint256 public constant MAX_DURATION = 365 days;

    TimeLockVault public timeLockVault;

    mapping(address => bytes32[]) public userVaults;
    mapping(bytes32 => TimeLockVault.Vault) public vaultRegistry;
    mapping(uint32 => uint256) public lockedByChain;
    mapping(address => uint256) public lockedByToken;

    uint256 public totalLocked;
    uint256 public totalVaults;

    constructor(address _timeLockVault) {
        require(_timeLockVault != address(0), "Invalid TimeLockVault");
        timeLockVault = TimeLockVault(_timeLockVault);
    }

    /// @notice Create new vault
    function createVault(
        uint256 amount,
        uint256 customDuration,
        uint32 sourceChain,
        uint32 destinationChain,
        uint8 bridgeProtocol,
        address tokenAddress,
        TimeLockVault.VaultType vaultType
    ) external returns (bytes32) {
        require(amount > 0, "Amount must be > 0");
        require(customDuration >= MIN_DURATION && customDuration <= MAX_DURATION, "Invalid duration");
        require(tokenAddress != address(0), "Invalid token");

        uint256 unlockAt = block.timestamp + customDuration;

        bytes32 vaultId = keccak256(abi.encodePacked(msg.sender, block.timestamp, amount));

        TimeLockVault.Vault memory vault = TimeLockVault.Vault({
            vaultId: vaultId,
            owner: msg.sender,
            totalAmount: amount,
            createdAt: block.timestamp,
            unlockAt: unlockAt,
            sourceChain: sourceChain,
            bridgeProtocol: bridgeProtocol,
            tokenAddress: tokenAddress,
            vaultType: vaultType,
            status: TimeLockVault.VaultStatus.ACTIVE,
            bridgeTxHash: 0x0,
            conditionOracle: address(0),
            conditionThreshold: 0,
            conditionAbove: false,
            treasuryBalanceCheck: address(0),
            treasuryBalanceThreshold: 0,
            numTranches: 0,
            claimedTranches: 0,
            intervalSeconds: 0
        });

        vaultRegistry[vaultId] = vault;
        userVaults[msg.sender].push(vaultId);

        totalLocked += amount;
        totalVaults++;
        lockedByChain[sourceChain] += amount;
        lockedByToken[tokenAddress] += amount;

        emit VaultCreated(vaultId, msg.sender, amount, unlockAt, vaultType);
        emit StatsUpdated(totalLocked, totalVaults);

        return vaultId;
    }

    /// @notice Get vault details
    function getVault(bytes32 vaultId) external view returns (TimeLockVault.Vault memory) {
        return vaultRegistry[vaultId];
    }

    /// @notice Get user's vaults
    function getUserVaults(address userAddress) external view returns (bytes32[] memory) {
        return userVaults[userAddress];
    }

    /// @notice Get total locked amount
    function getTotalLocked() external view returns (uint256) {
        return totalLocked;
    }

    /// @notice Get locked amount by chain
    function getTotalLockedByChain(uint32 chainId) external view returns (uint256) {
        return lockedByChain[chainId];
    }

    /// @notice Get locked amount by token
    function getTotalLockedByToken(address tokenAddress) external view returns (uint256) {
        return lockedByToken[tokenAddress];
    }

    /// @notice Get total vault count
    function getTotalVaults() external view returns (uint256) {
        return totalVaults;
    }

    /// @notice Update locked stats (called by vault operations)
    function updateStats(uint256 amountChange, bool isIncrease) external onlyOwner {
        if (isIncrease) {
            totalLocked += amountChange;
        } else {
            totalLocked -= amountChange;
        }
        emit StatsUpdated(totalLocked, totalVaults);
    }
}
