// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @title GovernanceTimelock
/// @notice Enforces 7-day delay for all protocol upgrades
contract GovernanceTimelock is Ownable, ReentrancyGuard {
    event UpgradeScheduled(uint256 indexed proposalId, address newImplementation, uint256 executionTime);
    event UpgradeExecuted(uint256 indexed proposalId, address newImplementation);
    event UpgradeCancelled(uint256 indexed proposalId);

    uint256 public constant TIMELOCK_DELAY = 7 days;
    uint256 public proposalCounter;

    struct Proposal {
        address newImplementation;
        bytes callData;
        bool executed;
        bool cancelled;
    }

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => uint256) public executionTime;

    constructor() {}

    /// @notice Schedule an upgrade with 7-day delay
    /// @param newImplementation Address of new implementation
    /// @param callData Encoded function call
    /// @return proposalId The ID of the scheduled proposal
    function scheduleUpgrade(address newImplementation, bytes calldata callData) external onlyOwner returns (uint256) {
        require(newImplementation != address(0), "Invalid implementation");

        uint256 proposalId = proposalCounter++;
        uint256 execTime = block.timestamp + TIMELOCK_DELAY;

        proposals[proposalId] = Proposal({
            newImplementation: newImplementation,
            callData: callData,
            executed: false,
            cancelled: false
        });

        executionTime[proposalId] = execTime;

        emit UpgradeScheduled(proposalId, newImplementation, execTime);
        return proposalId;
    }

    /// @notice Execute a scheduled upgrade
    /// @param proposalId The proposal ID
    function executeUpgrade(uint256 proposalId) external onlyOwner nonReentrant {
        Proposal storage proposal = proposals[proposalId];
        require(!proposal.executed, "Already executed");
        require(!proposal.cancelled, "Proposal cancelled");
        require(block.timestamp >= executionTime[proposalId], "Timelock not ready");

        proposal.executed = true;

        (bool success, ) = proposal.newImplementation.call(proposal.callData);
        require(success, "Execution failed");

        emit UpgradeExecuted(proposalId, proposal.newImplementation);
    }

    /// @notice Cancel a scheduled upgrade
    /// @param proposalId The proposal ID
    function cancelUpgrade(uint256 proposalId) external onlyOwner {
        Proposal storage proposal = proposals[proposalId];
        require(!proposal.executed, "Already executed");
        require(!proposal.cancelled, "Already cancelled");

        proposal.cancelled = true;
        emit UpgradeCancelled(proposalId);
    }

    /// @notice Get proposal details
    function getProposal(uint256 proposalId) external view returns (
        address newImplementation,
        bool executed,
        bool cancelled,
        uint256 execTime
    ) {
        Proposal storage proposal = proposals[proposalId];
        return (proposal.newImplementation, proposal.executed, proposal.cancelled, executionTime[proposalId]);
    }

    /// @notice Check if proposal is ready for execution
    function isReady(uint256 proposalId) external view returns (bool) {
        return block.timestamp >= executionTime[proposalId];
    }
}
