// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @title TimeLockVault
/// @notice Holds locked tokens, enforces unlock times, processes claims
contract TimeLockVault is Ownable, ReentrancyGuard {
    event VaultCreated(bytes32 indexed vaultId, address indexed owner, uint256 totalAmount, uint256 unlockAt);
    event DepositAdded(bytes32 indexed vaultId, uint256 amount, uint256 depositedAt);
    event VaultClaimed(bytes32 indexed vaultId, address indexed owner, uint256 amount, uint32 destinationChain);
    event FlexibleWithdrawal(bytes32 indexed vaultId, address indexed owner, uint256 amount, uint256 penalty);
    event VaultStatusChanged(bytes32 indexed vaultId, VaultStatus status);

    enum VaultType { FIXED, FLEXIBLE }
    enum VaultStatus { ACTIVE, MATURE, CLAIMED, FAILED }

    struct Vault {
        bytes32 vaultId;
        address owner;
        uint256 totalAmount;
        uint256 createdAt;
        uint256 unlockAt;
        uint32 sourceChain;
        uint8 bridgeProtocol;
        address tokenAddress;
        VaultType vaultType;
        VaultStatus status;
        bytes32 bridgeTxHash;
    }

    struct Deposit {
        uint256 amount;
        uint256 depositedAt;
        uint32 sourceChain;
        bytes32 bridgeTxHash;
    }

    mapping(bytes32 => Vault) public vaults;
    mapping(bytes32 => Deposit[]) public vaultDeposits;
    mapping(address => bytes32[]) public userVaults;

    address public treasuryAddress;
    address public bridgeOrchestratorAddress;

    constructor(address _treasury) {
        treasuryAddress = _treasury;
    }

    /// @notice Set bridge orchestrator address
    function setBridgeOrchestrator(address _orchestrator) external onlyOwner {
        require(_orchestrator != address(0), "Invalid orchestrator");
        bridgeOrchestratorAddress = _orchestrator;
    }

    /// @notice Create vault from bridge deposit
    function depositFromBridge(
        uint256 amount,
        address owner,
        uint256 unlockAt,
        uint32 sourceChain,
        uint8 bridgeProtocol,
        address tokenAddress,
        VaultType vaultType
    ) external returns (bytes32) {
        require(msg.sender == bridgeOrchestratorAddress, "Only bridge orchestrator");
        require(amount > 0, "Amount must be > 0");
        require(owner != address(0), "Invalid owner");
        require(unlockAt > block.timestamp, "Unlock time must be in future");

        bytes32 vaultId = keccak256(abi.encodePacked(owner, block.timestamp, amount));

        Vault storage vault = vaults[vaultId];
        vault.vaultId = vaultId;
        vault.owner = owner;
        vault.totalAmount = amount;
        vault.createdAt = block.timestamp;
        vault.unlockAt = unlockAt;
        vault.sourceChain = sourceChain;
        vault.bridgeProtocol = bridgeProtocol;
        vault.tokenAddress = tokenAddress;
        vault.vaultType = vaultType;
        vault.status = VaultStatus.ACTIVE;
        vault.bridgeTxHash = 0x0;

        vaultDeposits[vaultId].push(Deposit({
            amount: amount,
            depositedAt: block.timestamp,
            sourceChain: sourceChain,
            bridgeTxHash: 0x0
        }));

        userVaults[owner].push(vaultId);

        emit VaultCreated(vaultId, owner, amount, unlockAt);
        return vaultId;
    }

    /// @notice Add tokens to existing vault
    function addToVault(
        bytes32 vaultId,
        uint256 amount,
        uint32 sourceChain,
        uint8 bridgeProtocol,
        address tokenAddress
    ) external nonReentrant {
        require(msg.sender == bridgeOrchestratorAddress, "Only bridge orchestrator");
        require(amount > 0, "Amount must be > 0");

        Vault storage vault = vaults[vaultId];
        require(vault.owner != address(0), "Vault not found");
        require(vault.status == VaultStatus.ACTIVE, "Vault not active");
        require(block.timestamp < vault.unlockAt, "Vault already matured");
        require(sourceChain == vault.sourceChain, "Mismatched source chain");
        require(bridgeProtocol == vault.bridgeProtocol, "Mismatched bridge protocol");
        require(tokenAddress == vault.tokenAddress, "Mismatched token");

        vault.totalAmount += amount;
        vaultDeposits[vaultId].push(Deposit({
            amount: amount,
            depositedAt: block.timestamp,
            sourceChain: sourceChain,
            bridgeTxHash: 0x0
        }));

        emit DepositAdded(vaultId, amount, block.timestamp);
    }

    /// @notice Claim mature vault
    function claimVault(bytes32 vaultId, uint32 destinationChain) external nonReentrant {
        Vault storage vault = vaults[vaultId];
        require(vault.owner == msg.sender, "Only owner can claim");
        require(vault.status == VaultStatus.ACTIVE, "Vault not active");
        require(block.timestamp >= vault.unlockAt, "Vault not mature");

        uint256 claimAmount = vault.totalAmount;
        require(claimAmount > 0, "Nothing to claim");

        vault.status = VaultStatus.MATURE;
        emit VaultStatusChanged(vaultId, VaultStatus.MATURE);

        require(IERC20(vault.tokenAddress).transfer(msg.sender, claimAmount), "Transfer failed");

        vault.status = VaultStatus.CLAIMED;
        emit VaultStatusChanged(vaultId, VaultStatus.CLAIMED);
        emit VaultClaimed(vaultId, msg.sender, claimAmount, destinationChain);
    }

    /// @notice Withdraw from flexible vault (before unlock)
    function withdrawFlexible(bytes32 vaultId, uint256 amount) external nonReentrant {
        Vault storage vault = vaults[vaultId];
        require(vault.owner == msg.sender, "Only owner");
        require(vault.vaultType == VaultType.FLEXIBLE, "Not flexible vault");
        require(vault.status == VaultStatus.ACTIVE, "Vault not active");
        require(amount > 0 && amount <= vault.totalAmount, "Invalid amount");

        uint256 penalty = 0;
        if (block.timestamp < vault.unlockAt) {
            penalty = (amount * 5) / 1000; // 0.5% penalty
            require(treasuryAddress != address(0), "Treasury not set");
        }

        uint256 userAmount = amount - penalty;
        vault.totalAmount -= amount;

        if (penalty > 0) {
            IERC20(vault.tokenAddress).transfer(treasuryAddress, penalty);
        }
        IERC20(vault.tokenAddress).transfer(msg.sender, userAmount);

        emit FlexibleWithdrawal(vaultId, msg.sender, amount, penalty);

        if (vault.totalAmount == 0) {
            vault.status = VaultStatus.CLAIMED;
        }
    }

    /// @notice Check if vault is mature
    function isMatured(bytes32 vaultId) external view returns (bool) {
        return vaults[vaultId].unlockAt <= block.timestamp;
    }

    /// @notice Get remaining time until unlock
    function getRemainingTime(bytes32 vaultId) external view returns (uint256) {
        Vault storage vault = vaults[vaultId];
        if (block.timestamp >= vault.unlockAt) return 0;
        return vault.unlockAt - block.timestamp;
    }

    /// @notice Get vault details
    function getVault(bytes32 vaultId) external view returns (Vault memory) {
        return vaults[vaultId];
    }

    /// @notice Get deposits for vault
    function getDeposits(bytes32 vaultId) external view returns (Deposit[] memory) {
        return vaultDeposits[vaultId];
    }

    /// @notice Get user's vaults
    function getUserVaults(address user) external view returns (bytes32[] memory) {
        return userVaults[user];
    }
}
