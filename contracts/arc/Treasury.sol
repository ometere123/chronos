// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @title Treasury
/// @notice Collects and manages protocol fees with multisig-controlled withdrawals
contract Treasury is Ownable, ReentrancyGuard {
    event FeeDeposited(uint256 amount, address indexed feeCollector);
    event FeeWithdrawn(uint256 amount, address indexed recipient);
    event MultisigThresholdUpdated(uint256 newThreshold);
    event SignerAdded(address indexed newSigner);
    event SignerRemoved(address indexed signer);

    uint256 public accumulatedFees;
    address[] public multisigSigners;
    uint256 public multisigThreshold;

    mapping(address => bool) public isMultisigSigner;

    constructor(address[] memory initialSigners, uint256 threshold) {
        require(initialSigners.length >= 3, "At least 3 signers required");
        require(threshold > 0 && threshold <= initialSigners.length, "Invalid threshold");

        for (uint256 i = 0; i < initialSigners.length; i++) {
            require(initialSigners[i] != address(0), "Invalid signer");
            multisigSigners.push(initialSigners[i]);
            isMultisigSigner[initialSigners[i]] = true;
        }
        multisigThreshold = threshold;
    }

    /// @notice Deposit fee to treasury
    /// @param amount Amount to deposit
    function depositFee(uint256 amount) external onlyOwner {
        require(amount > 0, "Amount must be > 0");
        accumulatedFees += amount;
        emit FeeDeposited(amount, msg.sender);
    }

    /// @notice Withdraw fee (multisig protected in production)
    /// @param amount Amount to withdraw
    /// @param destinationAddress Recipient address
    function withdrawFee(uint256 amount, address payable destinationAddress) external onlyOwner nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(amount <= accumulatedFees, "Insufficient fees");
        require(destinationAddress != address(0), "Invalid recipient");

        accumulatedFees -= amount;
        (bool success, ) = destinationAddress.call{value: amount}("");
        require(success, "Withdrawal failed");

        emit FeeWithdrawn(amount, destinationAddress);
    }

    /// @notice Get current fee balance
    function getBalance() external view returns (uint256) {
        return accumulatedFees;
    }

    /// @notice Get number of multisig signers
    function getSignerCount() external view returns (uint256) {
        return multisigSigners.length;
    }

    /// @notice Add multisig signer
    function addSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "Invalid signer");
        require(!isMultisigSigner[newSigner], "Signer already exists");

        multisigSigners.push(newSigner);
        isMultisigSigner[newSigner] = true;
        emit SignerAdded(newSigner);
    }

    /// @notice Remove multisig signer
    function removeSigner(address signer) external onlyOwner {
        require(isMultisigSigner[signer], "Signer not found");
        require(multisigSigners.length > multisigThreshold, "Cannot drop below threshold");

        isMultisigSigner[signer] = false;
        for (uint256 i = 0; i < multisigSigners.length; i++) {
            if (multisigSigners[i] == signer) {
                multisigSigners[i] = multisigSigners[multisigSigners.length - 1];
                multisigSigners.pop();
                break;
            }
        }
        emit SignerRemoved(signer);
    }

    /// @notice Update multisig threshold
    function setMultisigThreshold(uint256 newThreshold) external onlyOwner {
        require(newThreshold > 0 && newThreshold <= multisigSigners.length, "Invalid threshold");
        multisigThreshold = newThreshold;
        emit MultisigThresholdUpdated(newThreshold);
    }

    receive() external payable {
        accumulatedFees += msg.value;
    }
}
