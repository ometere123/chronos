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
    event SplitVaultCreated(bytes32 indexed vaultId, uint16 savingsBps, uint16 yieldBps, uint16 reserveBps);
    event BucketClaimed(bytes32 indexed vaultId, address indexed owner, Bucket bucket, uint256 amount);
    event VaultCollateralLocked(bytes32 indexed vaultId);
    event VaultCollateralUnlocked(bytes32 indexed vaultId);
    event VaultCollateralLiquidated(bytes32 indexed vaultId, address indexed recipient, uint256 amount);

    enum VaultType { FIXED, FLEXIBLE }
    enum VaultStatus { ACTIVE, MATURE, CLAIMED, FAILED }
    enum Bucket { SAVINGS, YIELD, RESERVE }

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

    /// @notice Split configuration for "smart" vaults that auto-allocate deposits into buckets
    struct SplitConfig {
        bool isSplit;
        uint16 savingsBps;
        uint16 yieldBps;
        uint16 reserveBps;
    }

    mapping(bytes32 => Vault) public vaults;
    mapping(bytes32 => Deposit[]) public vaultDeposits;
    mapping(address => bytes32[]) public userVaults;
    bytes32[] public allVaultIds;

    mapping(bytes32 => SplitConfig) public splitConfigs;
    // vaultId => bucket index (0=savings,1=yield,2=reserve) => unclaimed amount in that bucket
    mapping(bytes32 => uint256[3]) public splitBuckets;
    mapping(bytes32 => mapping(uint8 => bool)) public bucketClaimed;

    // Collateral locking for CreditLine integration
    mapping(bytes32 => bool) public vaultLocked;

    address public treasuryAddress;
    address public bridgeOrchestratorAddress;
    address public creditLineAddress;

    constructor(address _treasury) {
        treasuryAddress = _treasury;
    }

    /// @notice Set bridge orchestrator address
    function setBridgeOrchestrator(address _orchestrator) external onlyOwner {
        require(_orchestrator != address(0), "Invalid orchestrator");
        bridgeOrchestratorAddress = _orchestrator;
    }

    /// @notice Set the CreditLine contract allowed to lock/unlock/liquidate vault collateral
    function setCreditLine(address _creditLine) external onlyOwner {
        require(_creditLine != address(0), "Invalid credit line");
        creditLineAddress = _creditLine;
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
        allVaultIds.push(vaultId);

        emit VaultCreated(vaultId, owner, amount, unlockAt);
        return vaultId;
    }

    /// @notice Input params for depositFromBridgeSplit, bundled in a struct to avoid stack-too-deep.
    struct SplitDepositParams {
        uint256 amount;
        address owner;
        uint256 unlockAt;
        uint32 sourceChain;
        uint8 bridgeProtocol;
        address tokenAddress;
        VaultType vaultType;
        uint16 savingsBps;
        uint16 yieldBps;
        uint16 reserveBps;
    }

    /// @notice Create vault from bridge deposit with an optional deposit-time split config
    /// @dev One vault record, three named internal sub-balances (savings/yield/reserve).
    ///      Bps must sum to exactly 10000. All buckets share the parent vault's maturity.
    function depositFromBridgeSplit(SplitDepositParams calldata p) external returns (bytes32) {
        require(msg.sender == bridgeOrchestratorAddress, "Only bridge orchestrator");
        require(p.amount > 0, "Amount must be > 0");
        require(p.owner != address(0), "Invalid owner");
        require(p.unlockAt > block.timestamp, "Unlock time must be in future");
        require(uint256(p.savingsBps) + p.yieldBps + p.reserveBps == 10000, "Split bps must sum to 10000");

        bytes32 vaultId = keccak256(abi.encodePacked(p.owner, block.timestamp, p.amount, "split"));

        Vault storage vault = vaults[vaultId];
        vault.vaultId = vaultId;
        vault.owner = p.owner;
        vault.totalAmount = p.amount;
        vault.createdAt = block.timestamp;
        vault.unlockAt = p.unlockAt;
        vault.sourceChain = p.sourceChain;
        vault.bridgeProtocol = p.bridgeProtocol;
        vault.tokenAddress = p.tokenAddress;
        vault.vaultType = p.vaultType;
        vault.status = VaultStatus.ACTIVE;
        vault.bridgeTxHash = 0x0;

        vaultDeposits[vaultId].push(Deposit({
            amount: p.amount,
            depositedAt: block.timestamp,
            sourceChain: p.sourceChain,
            bridgeTxHash: 0x0
        }));

        userVaults[p.owner].push(vaultId);
        allVaultIds.push(vaultId);

        uint256 savingsAmount = (p.amount * p.savingsBps) / 10000;
        uint256 yieldAmount = (p.amount * p.yieldBps) / 10000;
        // remainder goes to reserve bucket so the three buckets always sum exactly to `amount`
        uint256 reserveAmount = p.amount - savingsAmount - yieldAmount;

        splitConfigs[vaultId] = SplitConfig({
            isSplit: true,
            savingsBps: p.savingsBps,
            yieldBps: p.yieldBps,
            reserveBps: p.reserveBps
        });
        splitBuckets[vaultId][0] = savingsAmount;
        splitBuckets[vaultId][1] = yieldAmount;
        splitBuckets[vaultId][2] = reserveAmount;

        emit VaultCreated(vaultId, p.owner, p.amount, p.unlockAt);
        emit SplitVaultCreated(vaultId, p.savingsBps, p.yieldBps, p.reserveBps);
        return vaultId;
    }

    /// @notice Claim a single bucket of a split vault once the parent vault has matured
    function claimBucket(bytes32 vaultId, Bucket bucket) external nonReentrant {
        Vault storage vault = vaults[vaultId];
        require(vault.owner == msg.sender, "Only owner can claim");
        require(splitConfigs[vaultId].isSplit, "Not a split vault");
        require(!vaultLocked[vaultId], "Vault locked as collateral");
        require(vault.status == VaultStatus.ACTIVE, "Vault not active");
        require(block.timestamp >= vault.unlockAt, "Vault not mature");

        uint8 idx = uint8(bucket);
        require(!bucketClaimed[vaultId][idx], "Bucket already claimed");
        uint256 amount = splitBuckets[vaultId][idx];
        require(amount > 0, "Nothing to claim");

        bucketClaimed[vaultId][idx] = true;
        splitBuckets[vaultId][idx] = 0;

        require(IERC20(vault.tokenAddress).transfer(msg.sender, amount), "Transfer failed");
        emit BucketClaimed(vaultId, msg.sender, bucket, amount);

        if (bucketClaimed[vaultId][0] && bucketClaimed[vaultId][1] && bucketClaimed[vaultId][2]) {
            vault.status = VaultStatus.CLAIMED;
            emit VaultStatusChanged(vaultId, VaultStatus.CLAIMED);
        }
    }

    /// @notice Get the three split bucket balances (savings, yield, reserve) for a vault
    function getSplitBuckets(bytes32 vaultId) external view returns (uint256[3] memory) {
        return splitBuckets[vaultId];
    }

    /// @notice Get split config for a vault
    function getSplitConfig(bytes32 vaultId) external view returns (SplitConfig memory) {
        return splitConfigs[vaultId];
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
        require(!vaultLocked[vaultId], "Vault locked as collateral");
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
        require(!vaultLocked[vaultId], "Vault locked as collateral");
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

    /// @notice Lock a vault as collateral (called by the CreditLine contract)
    function lockVaultCollateral(bytes32 vaultId) external {
        require(msg.sender == creditLineAddress, "Only credit line");
        require(vaults[vaultId].owner != address(0), "Vault not found");
        require(vaults[vaultId].status == VaultStatus.ACTIVE, "Vault not active");
        require(!vaultLocked[vaultId], "Already locked");
        vaultLocked[vaultId] = true;
        emit VaultCollateralLocked(vaultId);
    }

    /// @notice Unlock a vault's collateral lock (called by the CreditLine contract on repayment)
    function unlockVaultCollateral(bytes32 vaultId) external {
        require(msg.sender == creditLineAddress, "Only credit line");
        vaultLocked[vaultId] = false;
        emit VaultCollateralUnlocked(vaultId);
    }

    /// @notice Force-claim a locked vault's balance to the CreditLine contract for liquidation.
    /// Only callable by the CreditLine contract, and only once the vault has matured.
    function liquidateVaultCollateral(bytes32 vaultId, address recipient) external nonReentrant returns (uint256) {
        require(msg.sender == creditLineAddress, "Only credit line");
        require(recipient != address(0), "Invalid recipient");

        Vault storage vault = vaults[vaultId];
        require(vault.owner != address(0), "Vault not found");
        require(vault.status == VaultStatus.ACTIVE, "Vault not active");
        require(block.timestamp >= vault.unlockAt, "Vault not mature");

        uint256 amount = vault.totalAmount;
        require(amount > 0, "Nothing to liquidate");

        vault.status = VaultStatus.CLAIMED;
        vaultLocked[vaultId] = false;
        emit VaultStatusChanged(vaultId, VaultStatus.CLAIMED);

        require(IERC20(vault.tokenAddress).transfer(recipient, amount), "Transfer failed");

        emit VaultCollateralLiquidated(vaultId, recipient, amount);
        emit VaultClaimed(vaultId, vault.owner, amount, 0);
        return amount;
    }

    /// @notice Get all vault IDs ever created (used for live on-chain proof-of-reserves aggregation)
    function getAllVaultIds() external view returns (bytes32[] memory) {
        return allVaultIds;
    }

    /// @notice Get total number of vaults ever created
    function getVaultCount() external view returns (uint256) {
        return allVaultIds.length;
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
