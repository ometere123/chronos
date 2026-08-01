// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @notice Minimal price oracle interface (see MockPriceOracle.sol - DEMO MOCK, replace with a
/// real Arc oracle such as Band Protocol when a confirmed testnet feed address is available).
interface IPriceOracle {
    function getPrice() external view returns (uint256);
}

/// @notice Minimal interface onto Treasury's live USDC balance, used for the optional
/// treasury-balance-guard unlock condition (Item 6).
interface ITreasuryBalanceView {
    function getUsdcBalance() external view returns (uint256);
}

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
    event ConditionSet(bytes32 indexed vaultId, address conditionOracle, uint256 conditionThreshold, bool conditionAbove, address treasuryAddressCheck, uint256 treasuryBalanceThreshold);
    event StreamingVaultCreated(bytes32 indexed vaultId, uint32 numTranches, uint256 intervalSeconds);
    event TrancheClaimed(bytes32 indexed vaultId, address indexed owner, uint32 trancheIndex, uint256 amount);

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
        // --- Optional oracle-gated unlock condition (Item 5). Zero address == disabled. ---
        address conditionOracle;
        uint256 conditionThreshold;
        bool conditionAbove; // true: price must be >= threshold, false: price must be <= threshold
        // --- Optional treasury-balance-guard condition (Item 6). Zero address == disabled. ---
        address treasuryBalanceCheck;
        uint256 treasuryBalanceThreshold;
        // --- Optional recurring/streaming release schedule (Item 7). numTranches == 0 == disabled. ---
        uint32 numTranches;
        uint32 claimedTranches;
        uint256 intervalSeconds;
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

    /// @notice Optional per-vault delegate the owner can authorize to call claimVault() on
    /// their behalf (Item 14: vault-maintenance agent). This is claim-only authorization, not
    /// a transfer of ownership. The claimed amount always goes to vault.owner, EXCEPT for a
    /// small agentFeeBps cut paid to the delegate itself when a delegate (not the owner)
    /// triggers the claim (Item 15: agent self-payment for autonomous service) - the owner
    /// never pays this fee unless they explicitly opted into agent management via
    /// setVaultDelegate(). Zero delegate address (the default) == no delegate set.
    mapping(bytes32 => address) public vaultDelegate;
    event VaultDelegateSet(bytes32 indexed vaultId, address indexed delegate);

    /// @notice Fee (basis points, 1 = 0.01%) paid to a delegate when it triggers a claim on the
    /// owner's behalf. Owner-triggered claims never pay this fee. Capped low and owner-settable.
    uint16 public agentFeeBps = 10; // 0.10% default
    event AgentFeeBpsUpdated(uint16 newFeeBps);

    function setAgentFeeBps(uint16 newFeeBps) external onlyOwner {
        require(newFeeBps <= 100, "Agent fee capped at 1%");
        agentFeeBps = newFeeBps;
        emit AgentFeeBpsUpdated(newFeeBps);
    }

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

    /// @notice Vault owner authorizes (or revokes, via address(0)) an address - e.g. the
    /// CHRONOS vault-maintenance agent's Circle Wallet - to call claimVault() on their behalf.
    /// Payout always goes to vault.owner regardless of who calls claimVault(), so this only
    /// grants "trigger the claim" rights, never redirects funds.
    function setVaultDelegate(bytes32 vaultId, address delegate) external {
        require(vaults[vaultId].owner == msg.sender, "Only owner can set delegate");
        vaultDelegate[vaultId] = delegate;
        emit VaultDelegateSet(vaultId, delegate);
    }

    function _isOwnerOrDelegate(Vault storage vault) internal view returns (bool) {
        return msg.sender == vault.owner ||
            (vaultDelegate[vault.vaultId] != address(0) && msg.sender == vaultDelegate[vault.vaultId]);
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

    /// @notice Input params for depositFromBridgeAdvanced (Items 5/6/7), bundled in a struct to
    /// avoid stack-too-deep. All condition/streaming fields are optional and default to disabled.
    struct AdvancedDepositParams {
        uint256 amount;
        address owner;
        uint256 unlockAt;
        uint32 sourceChain;
        uint8 bridgeProtocol;
        address tokenAddress;
        VaultType vaultType;
        // Item 5: oracle-gated unlock. conditionOracle == address(0) disables this check.
        address conditionOracle;
        uint256 conditionThreshold;
        bool conditionAbove;
        // Item 6: treasury-balance guard. treasuryBalanceCheck == address(0) disables this check.
        address treasuryBalanceCheck;
        uint256 treasuryBalanceThreshold;
        // Item 7: streaming/recurring release. numTranches == 0 disables streaming (single unlock).
        uint32 numTranches;
        uint256 intervalSeconds;
    }

    /// @notice Create a vault from a bridge deposit with optional oracle/treasury unlock
    /// conditions and/or a recurring release schedule. Backward compatible: vaults created via
    /// the plain `depositFromBridge` above always have every optional field disabled/zeroed.
    function depositFromBridgeAdvanced(AdvancedDepositParams calldata p) external returns (bytes32) {
        require(msg.sender == bridgeOrchestratorAddress, "Only bridge orchestrator");
        require(p.amount > 0, "Amount must be > 0");
        require(p.owner != address(0), "Invalid owner");
        require(p.unlockAt > block.timestamp, "Unlock time must be in future");
        if (p.numTranches > 0) {
            require(p.intervalSeconds > 0, "Invalid interval");
        }

        bytes32 vaultId = keccak256(abi.encodePacked(p.owner, block.timestamp, p.amount, "advanced"));

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

        vault.conditionOracle = p.conditionOracle;
        vault.conditionThreshold = p.conditionThreshold;
        vault.conditionAbove = p.conditionAbove;

        vault.treasuryBalanceCheck = p.treasuryBalanceCheck;
        vault.treasuryBalanceThreshold = p.treasuryBalanceThreshold;

        vault.numTranches = p.numTranches;
        vault.claimedTranches = 0;
        vault.intervalSeconds = p.intervalSeconds;

        vaultDeposits[vaultId].push(Deposit({
            amount: p.amount,
            depositedAt: block.timestamp,
            sourceChain: p.sourceChain,
            bridgeTxHash: 0x0
        }));

        userVaults[p.owner].push(vaultId);
        allVaultIds.push(vaultId);

        emit VaultCreated(vaultId, p.owner, p.amount, p.unlockAt);
        if (p.conditionOracle != address(0) || p.treasuryBalanceCheck != address(0)) {
            emit ConditionSet(vaultId, p.conditionOracle, p.conditionThreshold, p.conditionAbove, p.treasuryBalanceCheck, p.treasuryBalanceThreshold);
        }
        if (p.numTranches > 0) {
            emit StreamingVaultCreated(vaultId, p.numTranches, p.intervalSeconds);
        }
        return vaultId;
    }

    /// @dev Checks the optional oracle-gated (Item 5) and treasury-balance-guard (Item 6)
    /// conditions for a vault. Returns true if both disabled or both satisfied.
    function _extraConditionsMet(Vault storage vault) internal view returns (bool) {
        if (vault.conditionOracle != address(0)) {
            uint256 price = IPriceOracle(vault.conditionOracle).getPrice();
            if (vault.conditionAbove) {
                if (price < vault.conditionThreshold) return false;
            } else {
                if (price > vault.conditionThreshold) return false;
            }
        }
        if (vault.treasuryBalanceCheck != address(0)) {
            uint256 bal = ITreasuryBalanceView(vault.treasuryBalanceCheck).getUsdcBalance();
            if (bal < vault.treasuryBalanceThreshold) return false;
        }
        return true;
    }

    /// @notice Whether a vault's optional oracle/treasury unlock conditions are currently met
    /// (independent of the time-based unlockAt check).
    function conditionsMet(bytes32 vaultId) external view returns (bool) {
        return _extraConditionsMet(vaults[vaultId]);
    }

    /// @notice Number of tranches currently matured (elapsed-time based) for a streaming vault.
    /// Returns 0 for non-streaming vaults.
    function maturedTrancheCount(bytes32 vaultId) public view returns (uint32) {
        Vault storage vault = vaults[vaultId];
        if (vault.numTranches == 0) return 0;
        if (block.timestamp < vault.createdAt) return 0;
        uint256 elapsed = block.timestamp - vault.createdAt;
        uint256 matured = elapsed / vault.intervalSeconds;
        if (matured > vault.numTranches) matured = vault.numTranches;
        return uint32(matured);
    }

    /// @notice Claim all newly-matured, not-yet-claimed tranches of a streaming vault.
    /// Equal amounts of totalAmount / numTranches per tranche, with any rounding remainder
    /// folded into the final tranche so the sum of all tranche payouts equals totalAmount exactly.
    function claimStreamingTranches(bytes32 vaultId) external nonReentrant {
        Vault storage vault = vaults[vaultId];
        require(vault.owner == msg.sender, "Only owner can claim");
        require(vault.numTranches > 0, "Not a streaming vault");
        require(!vaultLocked[vaultId], "Vault locked as collateral");
        require(vault.status == VaultStatus.ACTIVE, "Vault not active");
        require(_extraConditionsMet(vault), "Unlock conditions not met");

        uint32 matured = maturedTrancheCount(vaultId);
        require(matured > vault.claimedTranches, "No new tranches matured");

        uint256 perTranche = vault.totalAmount / vault.numTranches;
        uint32 fromIdx = vault.claimedTranches;
        uint256 totalPayout = 0;

        for (uint32 i = fromIdx; i < matured; i++) {
            uint256 trancheAmount = perTranche;
            if (i == vault.numTranches - 1) {
                // Final tranche absorbs the rounding remainder.
                trancheAmount = vault.totalAmount - (perTranche * (vault.numTranches - 1));
            }
            totalPayout += trancheAmount;
            emit TrancheClaimed(vaultId, msg.sender, i, trancheAmount);
        }

        vault.claimedTranches = matured;

        if (matured == vault.numTranches) {
            vault.status = VaultStatus.CLAIMED;
            emit VaultStatusChanged(vaultId, VaultStatus.CLAIMED);
        }

        require(IERC20(vault.tokenAddress).transfer(msg.sender, totalPayout), "Transfer failed");
        emit VaultClaimed(vaultId, msg.sender, totalPayout, 0);
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
        require(_extraConditionsMet(vault), "Unlock conditions not met");

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
        require(_isOwnerOrDelegate(vault), "Only owner or delegate can claim");
        require(!vaultLocked[vaultId], "Vault locked as collateral");
        require(vault.status == VaultStatus.ACTIVE, "Vault not active");
        require(vault.numTranches == 0, "Use claimStreamingTranches for streaming vaults");
        require(block.timestamp >= vault.unlockAt, "Vault not mature");
        require(_extraConditionsMet(vault), "Unlock conditions not met");

        uint256 claimAmount = vault.totalAmount;
        require(claimAmount > 0, "Nothing to claim");

        vault.status = VaultStatus.MATURE;
        emit VaultStatusChanged(vaultId, VaultStatus.MATURE);

        // Owner-triggered claims: full amount to owner, no fee. Delegate-triggered claims:
        // a small agentFeeBps cut to the delegate (Item 15), remainder to owner. A delegate
        // can never redirect the owner's share to itself - only the capped fee.
        if (msg.sender != vault.owner) {
            uint256 agentFee = (claimAmount * agentFeeBps) / 10000;
            uint256 ownerAmount = claimAmount - agentFee;
            if (agentFee > 0) {
                require(IERC20(vault.tokenAddress).transfer(msg.sender, agentFee), "Agent fee transfer failed");
            }
            require(IERC20(vault.tokenAddress).transfer(vault.owner, ownerAmount), "Transfer failed");
        } else {
            require(IERC20(vault.tokenAddress).transfer(vault.owner, claimAmount), "Transfer failed");
        }

        vault.status = VaultStatus.CLAIMED;
        emit VaultStatusChanged(vaultId, VaultStatus.CLAIMED);
        emit VaultClaimed(vaultId, vault.owner, claimAmount, destinationChain);
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
