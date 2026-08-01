// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Treasury
/// @notice Collects and manages protocol fees (in USDC) with multisig-controlled withdrawals
contract Treasury is Ownable, ReentrancyGuard {
    event FeeDeposited(uint256 amount, address indexed feeCollector);
    event FeeWithdrawn(uint256 amount, address indexed recipient);
    event MultisigThresholdUpdated(uint256 newThreshold);
    event SignerAdded(address indexed newSigner);
    event SignerRemoved(address indexed signer);
    event ScheduledPaymentAddressUpdated(address indexed newAddress);
    event FundsReleased(address indexed recipient, uint256 amount);

    IERC20 public immutable usdc;
    uint256 public accumulatedFees;
    address[] public multisigSigners;
    uint256 public multisigThreshold;

    mapping(address => bool) public isMultisigSigner;

    /// @notice The single ScheduledPayment contract authorized to pull funds via releaseFunds.
    /// Mirrors how TimeLockVault gates its bridge-only functions to bridgeOrchestratorAddress.
    address public scheduledPaymentAddress;

    constructor(address usdcAddress, address[] memory initialSigners, uint256 threshold) {
        require(usdcAddress != address(0), "Invalid USDC address");
        require(initialSigners.length >= 3, "At least 3 signers required");
        require(threshold > 0 && threshold <= initialSigners.length, "Invalid threshold");

        usdc = IERC20(usdcAddress);

        for (uint256 i = 0; i < initialSigners.length; i++) {
            require(initialSigners[i] != address(0), "Invalid signer");
            multisigSigners.push(initialSigners[i]);
            isMultisigSigner[initialSigners[i]] = true;
        }
        multisigThreshold = threshold;
    }

    /// @notice Deposit fee to treasury. Caller must approve this contract for `amount` USDC first.
    /// @param amount Amount to deposit
    function depositFee(uint256 amount) external onlyOwner {
        require(amount > 0, "Amount must be > 0");
        accumulatedFees += amount;
        require(usdc.transferFrom(msg.sender, address(this), amount), "USDC transferFrom failed");
        emit FeeDeposited(amount, msg.sender);
    }

    /// @notice Withdraw fee (multisig protected in production)
    /// @param amount Amount to withdraw
    /// @param destinationAddress Recipient address
    function withdrawFee(uint256 amount, address destinationAddress) external onlyOwner nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(amount <= accumulatedFees, "Insufficient fees");
        require(destinationAddress != address(0), "Invalid recipient");

        accumulatedFees -= amount;
        require(usdc.transfer(destinationAddress, amount), "USDC transfer failed");

        emit FeeWithdrawn(amount, destinationAddress);
    }

    /// @notice Set the ScheduledPayment contract authorized to call releaseFunds
    function setScheduledPaymentAddress(address newAddress) external onlyOwner {
        require(newAddress != address(0), "Invalid address");
        scheduledPaymentAddress = newAddress;
        emit ScheduledPaymentAddressUpdated(newAddress);
    }

    /// @notice Release USDC directly from the Treasury's on-chain balance (not accumulatedFees
    /// accounting) to a recipient. Only callable by the configured ScheduledPayment contract, which
    /// itself enforces the payment schedule and the post-payout balance threshold guard.
    function releaseFunds(address recipient, uint256 amount) external nonReentrant {
        require(msg.sender == scheduledPaymentAddress, "Only scheduled payment contract");
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be > 0");

        require(usdc.transfer(recipient, amount), "USDC transfer failed");
        emit FundsReleased(recipient, amount);
    }

    /// @notice Get current fee balance (accounting balance)
    function getBalance() external view returns (uint256) {
        return accumulatedFees;
    }

    /// @notice Get actual on-chain USDC balance held by this contract
    function getUsdcBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
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
}
