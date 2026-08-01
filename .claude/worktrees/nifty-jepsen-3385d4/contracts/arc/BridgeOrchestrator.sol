// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./TimeLockVault.sol";

/// @title BridgeOrchestrator
/// @notice Coordinates CCTP inbound/outbound, handles attestations
contract BridgeOrchestrator is Ownable, ReentrancyGuard {
    event BridgeInitiated(bytes32 indexed vaultId, uint256 amount);
    event AttestationReceived(bytes32 indexed vaultId, bytes32 attestationHash);
    event BridgeCompleted(bytes32 indexed vaultId, uint256 amount);
    event BridgeFailed(bytes32 indexed vaultId, string reason);
    event CCTPConfigured(address indexed messenger, address indexed transmitter);

    enum BridgeState {
        DEPOSIT_INITIATED,
        BURNING,
        ATTESTING,
        MINTING,
        VAULT_CREATED,
        CLAIM_INITIATED,
        USER_RECEIVED,
        FAILED
    }

    struct BridgeTransaction {
        bytes32 vaultId;
        uint8 direction; // 0 = inbound, 1 = outbound
        uint256 amount;
        address token;
        address owner;
        BridgeState state;
        uint256 createdAt;
        uint256 completedAt;
        bytes attestationData;
    }

    mapping(bytes32 => BridgeTransaction) public bridgeTransactions;
    mapping(bytes32 => uint8) public bridgeStates; // vaultId -> BridgeState

    TimeLockVault public timeLockVault;
    address public usdcToken;
    address public cctpTokenMessenger;
    address public cctpMessageTransmitter;

    constructor(address _timeLockVault, address _usdcToken) {
        require(_timeLockVault != address(0), "Invalid TimeLockVault");
        require(_usdcToken != address(0), "Invalid USDC");
        timeLockVault = TimeLockVault(_timeLockVault);
        usdcToken = _usdcToken;
    }

    /// @notice Configure CCTP contracts
    function configureCCTP(address messenger, address transmitter) external onlyOwner {
        require(messenger != address(0) && transmitter != address(0), "Invalid addresses");
        cctpTokenMessenger = messenger;
        cctpMessageTransmitter = transmitter;
        emit CCTPConfigured(messenger, transmitter);
    }

    /// @notice Receive bridged USDC via CCTP
    function receiveBridgedUSDC_CCTP(
        uint256 amount,
        uint32 sourceChain,
        address owner,
        uint256 unlockAt,
        uint32 destinationChain,
        uint256 customDuration,
        TimeLockVault.VaultType vaultType
    ) external returns (bytes32) {
        require(msg.sender == cctpMessageTransmitter, "Only CCTP transmitter");
        require(amount > 0, "Invalid amount");

        bytes32 vaultId = timeLockVault.depositFromBridge(
            amount,
            owner,
            unlockAt > 0 ? unlockAt : block.timestamp + customDuration,
            sourceChain,
            0, // CCTP protocol
            usdcToken,
            vaultType
        );

        bridgeStates[vaultId] = uint8(BridgeState.VAULT_CREATED);
        emit BridgeCompleted(vaultId, amount);

        return vaultId;
    }

    /// @notice Receive an additional bridged USDC deposit for an existing vault
    function receiveAdditionalBridgedUSDC_CCTP(
        bytes32 vaultId,
        uint256 amount,
        uint32 sourceChain,
        address owner
    ) external returns (bytes32) {
        require(msg.sender == cctpMessageTransmitter, "Only CCTP transmitter");
        require(amount > 0, "Invalid amount");

        TimeLockVault.Vault memory vault = timeLockVault.getVault(vaultId);
        require(vault.owner != address(0), "Vault not found");
        require(vault.owner == owner, "Owner mismatch");
        require(vault.status == TimeLockVault.VaultStatus.ACTIVE, "Vault not active");
        require(vault.tokenAddress == usdcToken, "Unsupported token");

        timeLockVault.addToVault(
            vaultId,
            amount,
            sourceChain,
            0, // CCTP protocol
            usdcToken
        );

        bridgeStates[vaultId] = uint8(BridgeState.VAULT_CREATED);
        emit BridgeCompleted(vaultId, amount);

        return vaultId;
    }

    /// @notice Initiate CCTP claim
    function initiateClaim_CCTP(bytes32 vaultId, uint32 destinationChain) external {
        require(msg.sender == address(timeLockVault), "Only TimeLockVault");
        bridgeStates[vaultId] = uint8(BridgeState.CLAIM_INITIATED);
        emit BridgeInitiated(vaultId, 0);
    }

    /// @notice Receive CCTP attestation
    function receiveAttestation_CCTP(bytes calldata attestationData) external {
        require(msg.sender == cctpMessageTransmitter, "Only CCTP");
        // Process attestation logic here
    }

    /// @notice Retry failed bridge
    function retryFailedBridge(bytes32 vaultId, bytes calldata attestationData) external onlyOwner {
        bridgeStates[vaultId] = uint8(BridgeState.ATTESTING);
        emit AttestationReceived(vaultId, keccak256(attestationData));
    }

    /// @notice Get bridge state
    function getBridgeState(bytes32 vaultId) external view returns (BridgeState) {
        return BridgeState(bridgeStates[vaultId]);
    }

    /// @notice Get bridge transaction
    function getBridgeTransaction(bytes32 vaultId) external view returns (BridgeTransaction memory) {
        return bridgeTransactions[vaultId];
    }
}
