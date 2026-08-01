// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @title CCTPReceiver
/// @notice Deployed on source chains (Base, Arbitrum, Ethereum)
/// @notice Receives CCTP messages from source chains, forwards to Arc Testnet
contract CCTPReceiver is Ownable, ReentrancyGuard {
    event BridgeInitiated(address indexed user, uint256 amount, address arcRecipient);
    event MessageReceived(bytes32 indexed messageHash);
    event MessageTransmitterUpdated(address indexed newTransmitter);

    address public cctpMessageTransmitter;
    address public cctpTokenMessenger;
    address public arcBridgeAddress;
    address public usdcToken;

    // Pending messages queue
    mapping(bytes32 => bytes) public pendingMessages;

    /// @notice Replay guard: messageHash => already processed. Once a CCTP message has been
    /// handled it can never be replayed through this contract again, even if the canonical
    /// MessageTransmitter were somehow tricked into resubmitting it.
    mapping(bytes32 => bool) public processedMessages;

    constructor(
        address _messageTransmitter,
        address _tokenMessenger,
        address _arcBridge,
        address _usdc
    ) {
        require(_messageTransmitter != address(0), "Invalid transmitter");
        require(_tokenMessenger != address(0), "Invalid messenger");
        require(_arcBridge != address(0), "Invalid arc bridge");
        require(_usdc != address(0), "Invalid USDC");

        cctpMessageTransmitter = _messageTransmitter;
        cctpTokenMessenger = _tokenMessenger;
        arcBridgeAddress = _arcBridge;
        usdcToken = _usdc;
    }

    /// @notice Receive CCTP message and attestation
    function handleReceiveMessage(
        bytes calldata message,
        bytes calldata attestation
    ) external returns (bool) {
        require(msg.sender == cctpMessageTransmitter, "Only CCTP transmitter");

        bytes32 messageHash = keccak256(message);
        require(!processedMessages[messageHash], "Message already processed");
        processedMessages[messageHash] = true;
        pendingMessages[messageHash] = attestation;

        emit MessageReceived(messageHash);
        return true;
    }

    /// @notice Update the canonical CCTP MessageTransmitter address that is authorized to call
    /// handleReceiveMessage. Only the owner may repoint this (e.g. after a CCTP contract upgrade).
    function setMessageTransmitter(address newTransmitter) external onlyOwner {
        require(newTransmitter != address(0), "Invalid transmitter");
        cctpMessageTransmitter = newTransmitter;
        emit MessageTransmitterUpdated(newTransmitter);
    }

    /// @notice Burn USDC and bridge to Arc
    function burnAndBridge_toArc(
        uint256 amount,
        address arcRecipient
    ) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(arcRecipient != address(0), "Invalid recipient");

        // Transfer USDC from user to contract
        require(
            IERC20(usdcToken).transferFrom(msg.sender, address(this), amount),
            "Transfer failed"
        );

        // Approve CCTP to burn
        require(
            IERC20(usdcToken).approve(cctpTokenMessenger, amount),
            "Approval failed"
        );

        // Initiate CCTP burn (actual CCTP integration would happen here)
        // This is a placeholder for the CCTP integration

        emit BridgeInitiated(msg.sender, amount, arcRecipient);
    }

    /// @notice Update Arc bridge address
    function setArcBridgeAddress(address newAddress) external onlyOwner {
        require(newAddress != address(0), "Invalid address");
        arcBridgeAddress = newAddress;
    }

    /// @notice Withdraw stranded tokens
    function withdrawToken(address token, uint256 amount) external onlyOwner nonReentrant {
        require(token != address(0), "Invalid token");
        require(amount > 0, "Amount must be > 0");
        require(IERC20(token).transfer(msg.sender, amount), "Withdrawal failed");
    }
}
