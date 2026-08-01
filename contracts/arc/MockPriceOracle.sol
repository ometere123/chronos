// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockPriceOracle
/// @notice DEMO MOCK — replace with real Arc oracle (Band Protocol has a confirmed Arc testnet
/// integration per docs.arc.io) when available. docs.arc.io/arc/references/contract-addresses
/// does not currently list a concrete Band/Chainlink/Stork feed address for Arc testnet, so this
/// simple admin-settable price feed stands in for oracle-gated unlock conditions (Item 5/6).
contract MockPriceOracle is Ownable {
    event PriceUpdated(uint256 newPrice, uint256 updatedAt);

    uint256 public price;
    uint256 public updatedAt;

    constructor(uint256 initialPrice) {
        price = initialPrice;
        updatedAt = block.timestamp;
    }

    /// @notice Admin-settable price. In production this would be replaced by a real oracle feed.
    function setPrice(uint256 newPrice) external onlyOwner {
        price = newPrice;
        updatedAt = block.timestamp;
        emit PriceUpdated(newPrice, block.timestamp);
    }

    /// @notice Current price (mock)
    function getPrice() external view returns (uint256) {
        return price;
    }
}
