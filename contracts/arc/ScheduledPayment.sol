// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @notice Minimal interface onto Treasury's controlled release function and live USDC balance.
interface ITreasuryRelease {
    function releaseFunds(address recipient, uint256 amount) external;
    function getUsdcBalance() external view returns (uint256);
}

/// @title ScheduledPayment
/// @notice Treasury payroll / recurring-payment schedules. Each schedule defines a recipient,
/// a fixed USDC amount, an ordered list of release timestamps ("slots"), and a minimum Treasury
/// balance that must still be held AFTER the payout executes. Funds are pulled from Treasury.sol
/// via its releaseFunds() function, which is gated to only this contract's address (see
/// Treasury.scheduledPaymentAddress), the same pattern TimeLockVault uses to gate
/// bridgeOrchestratorAddress-only functions.
///
/// IMPORTANT - hackathon-timeline tradeoff: there is no on-chain keeper/automation network
/// live on Arc Testnet yet, so due payments are NOT self-executing. An off-chain cron job
/// (backend/src/services/scheduledPaymentService.js) acts as a centralized keeper that calls
/// executePayment() once a slot is due. This is a deliberate, documented centralization
/// tradeoff for the hackathon timeline. To decentralize later: swap the cron keeper for
/// Chainlink Automation (or an equivalent decentralized keeper network) once available on Arc,
/// pointing its upkeep at executePayment() with the same due-slot / threshold-guard logic
/// enforced on-chain exactly as it is today - no contract changes required, only who calls it.
contract ScheduledPayment is Ownable, ReentrancyGuard {
    event PaymentScheduleCreated(
        uint256 indexed scheduleId,
        address indexed recipient,
        uint256 amount,
        uint256 minTreasuryBalanceAfter,
        uint256 slotCount
    );
    event PaymentExecuted(uint256 indexed scheduleId, uint256 indexed slotIndex, address indexed recipient, uint256 amount);
    event PaymentBlocked(uint256 indexed scheduleId, uint256 indexed slotIndex, string reason);
    event PaymentScheduleCancelled(uint256 indexed scheduleId);

    struct Schedule {
        address recipient;
        uint256 amount;
        uint256 minTreasuryBalanceAfter;
        uint256[] releaseTimestamps;
        bool active;
    }

    ITreasuryRelease public treasury;

    uint256 public nextScheduleId;
    mapping(uint256 => Schedule) private schedules;
    // scheduleId => slotIndex => executed
    mapping(uint256 => mapping(uint256 => bool)) public slotExecuted;

    constructor(address _treasury) {
        require(_treasury != address(0), "Invalid treasury");
        treasury = ITreasuryRelease(_treasury);
    }

    /// @notice Create a new payment schedule.
    /// @param recipient Who receives each payout.
    /// @param amount USDC amount (6 decimals) paid per slot.
    /// @param minTreasuryBalanceAfter Minimum Treasury USDC balance that must remain AFTER payout.
    /// @param releaseTimestamps Ordered list of unix timestamps at which a payout becomes due.
    function createSchedule(
        address recipient,
        uint256 amount,
        uint256 minTreasuryBalanceAfter,
        uint256[] calldata releaseTimestamps
    ) external onlyOwner returns (uint256 scheduleId) {
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be > 0");
        require(releaseTimestamps.length > 0, "Need at least one release slot");

        for (uint256 i = 1; i < releaseTimestamps.length; i++) {
            require(releaseTimestamps[i] > releaseTimestamps[i - 1], "Timestamps must be strictly increasing");
        }

        scheduleId = nextScheduleId++;
        Schedule storage schedule = schedules[scheduleId];
        schedule.recipient = recipient;
        schedule.amount = amount;
        schedule.minTreasuryBalanceAfter = minTreasuryBalanceAfter;
        schedule.releaseTimestamps = releaseTimestamps;
        schedule.active = true;

        emit PaymentScheduleCreated(scheduleId, recipient, amount, minTreasuryBalanceAfter, releaseTimestamps.length);
    }

    /// @notice Execute a due, not-yet-executed payment slot. Called by the off-chain keeper
    /// (see scheduledPaymentService.js) once block.timestamp >= releaseTimestamps[slotIndex].
    /// Reverts if not due, already executed, or if paying out would drop the Treasury's USDC
    /// balance below minTreasuryBalanceAfter.
    function executePayment(uint256 scheduleId, uint256 slotIndex) external nonReentrant {
        Schedule storage schedule = schedules[scheduleId];
        require(schedule.active, "Schedule not active");
        require(slotIndex < schedule.releaseTimestamps.length, "Invalid slot index");
        require(!slotExecuted[scheduleId][slotIndex], "Slot already executed");
        require(block.timestamp >= schedule.releaseTimestamps[slotIndex], "Payment not due yet");

        uint256 currentBalance = treasury.getUsdcBalance();
        require(currentBalance >= schedule.amount, "Treasury balance insufficient for payout");

        uint256 balanceAfter = currentBalance - schedule.amount;
        require(balanceAfter >= schedule.minTreasuryBalanceAfter, "Payout would breach treasury balance guard");

        // Mark executed before the external call (checks-effects-interactions).
        slotExecuted[scheduleId][slotIndex] = true;

        treasury.releaseFunds(schedule.recipient, schedule.amount);

        emit PaymentExecuted(scheduleId, slotIndex, schedule.recipient, schedule.amount);
    }

    /// @notice View helper for the keeper: is this slot currently executable?
    function isSlotDue(uint256 scheduleId, uint256 slotIndex) external view returns (bool due, string memory reason) {
        Schedule storage schedule = schedules[scheduleId];
        if (!schedule.active) return (false, "Schedule not active");
        if (slotIndex >= schedule.releaseTimestamps.length) return (false, "Invalid slot index");
        if (slotExecuted[scheduleId][slotIndex]) return (false, "Slot already executed");
        if (block.timestamp < schedule.releaseTimestamps[slotIndex]) return (false, "Not due yet");

        uint256 currentBalance = treasury.getUsdcBalance();
        if (currentBalance < schedule.amount) return (false, "Treasury balance insufficient");
        if (currentBalance - schedule.amount < schedule.minTreasuryBalanceAfter) {
            return (false, "Would breach treasury balance guard");
        }

        return (true, "");
    }

    function getSchedule(uint256 scheduleId)
        external
        view
        returns (
            address recipient,
            uint256 amount,
            uint256 minTreasuryBalanceAfter,
            uint256[] memory releaseTimestamps,
            bool active
        )
    {
        Schedule storage schedule = schedules[scheduleId];
        return (
            schedule.recipient,
            schedule.amount,
            schedule.minTreasuryBalanceAfter,
            schedule.releaseTimestamps,
            schedule.active
        );
    }

    function cancelSchedule(uint256 scheduleId) external onlyOwner {
        require(schedules[scheduleId].active, "Schedule not active");
        schedules[scheduleId].active = false;
        emit PaymentScheduleCancelled(scheduleId);
    }
}
