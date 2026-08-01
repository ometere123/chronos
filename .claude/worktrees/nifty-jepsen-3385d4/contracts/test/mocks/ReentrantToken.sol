// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../arc/TimeLockVault.sol";

contract ReentrantToken is ERC20 {
    TimeLockVault public vault;
    uint256 public reentryCount = 0;

    constructor(address _vault) ERC20("Reentrant", "RENT") {
        vault = TimeLockVault(_vault);
        _mint(msg.sender, 1000000 * 10 ** 18);
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        // Attempt reentrancy on transfer
        if (reentryCount == 0) {
            reentryCount++;
            // This would trigger reentrancy if not protected
            // bytes32 vaultId = keccak256(abi.encodePacked(msg.sender, block.timestamp, amount));
            // vault.withdrawFlexible(vaultId, amount);
            reentryCount--;
        }
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        // Attempt reentrancy on transferFrom
        if (reentryCount == 0) {
            reentryCount++;
            // Reentrancy attempt here
            reentryCount--;
        }
        return super.transferFrom(from, to, amount);
    }
}
