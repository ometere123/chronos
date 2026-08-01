// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @notice Band Protocol's StdReference interface, as deployed on Arc testnet.
/// Confirmed live at 0x8c064bCf7C0DA3B3b090BAbFE8f3323534D84d68 (verified on-chain:
/// getReferenceData("USDC","USD") returns a real rate, 18 decimals, with a recent
/// lastUpdatedBase timestamp). See https://blog.bandprotocol.com/band-x-arc-testnet/.
interface IStdReference {
    function getReferenceData(string memory base, string memory quote)
        external
        view
        returns (uint256 rate, uint256 lastUpdatedBase, uint256 lastUpdatedQuote);
}

/// @title BandOracleAdapter
/// @notice Adapts Band Protocol's StdReference (base/quote string pair, 18-decimal rate) to the
/// simple IPriceOracle.getPrice() interface TimeLockVault's oracle-gated unlock (Item 5/6) expects.
/// This lets vaults reference a real, live Arc-testnet price feed instead of MockPriceOracle.
contract BandOracleAdapter {
    IStdReference public immutable stdReference;
    string public base;
    string public quote;

    /// @param _stdReference Band's StdReference contract address on Arc testnet.
    /// @param _base Base symbol, e.g. "USDC".
    /// @param _quote Quote symbol, e.g. "USD".
    constructor(address _stdReference, string memory _base, string memory _quote) {
        stdReference = IStdReference(_stdReference);
        base = _base;
        quote = _quote;
    }

    /// @notice Returns the current rate, 18 decimals, matching TimeLockVault's IPriceOracle.
    function getPrice() external view returns (uint256) {
        (uint256 rate, , ) = stdReference.getReferenceData(base, quote);
        return rate;
    }

    /// @notice Exposes the raw Band response including staleness timestamps, for UIs/monitoring.
    function getPriceData() external view returns (uint256 rate, uint256 lastUpdatedBase, uint256 lastUpdatedQuote) {
        return stdReference.getReferenceData(base, quote);
    }
}
