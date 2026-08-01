// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./TimeLockVault.sol";

/// @title CreditLine
/// @notice Lets users borrow USDC against a locked TimeLockVault position (up to 50% LTV) from a
/// shared, protocol-owned liquidity pool funded by third-party lenders who earn a pro-rata share
/// of interest paid by borrowers. Repaying before the vault's maturity releases the collateral
/// lock. If unpaid by maturity, anyone can trigger auto-liquidation: the contract force-claims the
/// vault's balance, keeps enough to cover principal + interest, and returns the remainder to the
/// original vault owner.
contract CreditLine is Ownable, ReentrancyGuard {
    event LiquidityDeposited(address indexed lender, uint256 amount, uint256 shares);
    event LiquidityWithdrawn(address indexed lender, uint256 amount, uint256 interestPaid);
    event Borrowed(bytes32 indexed vaultId, address indexed borrower, uint256 principal, uint256 collateralValue);
    event Repaid(bytes32 indexed vaultId, address indexed borrower, uint256 principal, uint256 interest);
    event Liquidated(bytes32 indexed vaultId, address indexed borrower, uint256 collateralClaimed, uint256 owed, uint256 remainderToOwner);

    struct Loan {
        bytes32 vaultId;
        address borrower;
        uint256 principal;
        uint256 collateralValue;
        uint256 startTime;
        bool active;
    }

    /// @dev Basis points, out of 10000. Flat simple-interest rate charged on principal regardless
    /// of duration - "simple pro-rata accounting, not a full interest-rate curve" per spec.
    uint16 public constant INTEREST_BPS = 500; // 5%
    uint16 public constant MAX_LTV_BPS = 5000; // 50%
    uint256 private constant ACC_PRECISION = 1e18;

    IERC20 public immutable usdc;
    TimeLockVault public immutable timeLockVault;

    mapping(bytes32 => Loan) public loans;

    // Liquidity pool accounting (accumulator / MasterChef-style pro-rata interest distribution)
    mapping(address => uint256) public lpShares;
    mapping(address => uint256) public lpRewardDebt;
    uint256 public totalLpShares;
    uint256 public availableLiquidity; // USDC sitting in the pool, available to lend or withdraw
    uint256 public totalBorrowed;      // outstanding principal across all active loans
    uint256 public accInterestPerShare; // scaled by ACC_PRECISION

    constructor(address _usdc, address _timeLockVault) {
        require(_usdc != address(0), "Invalid USDC");
        require(_timeLockVault != address(0), "Invalid TimeLockVault");
        usdc = IERC20(_usdc);
        timeLockVault = TimeLockVault(_timeLockVault);
    }

    // ---------------------------------------------------------------------
    // Liquidity pool (lenders)
    // ---------------------------------------------------------------------

    function _pendingInterest(address lender) internal view returns (uint256) {
        return (lpShares[lender] * accInterestPerShare) / ACC_PRECISION - lpRewardDebt[lender];
    }

    /// @notice Deposit USDC into the shared lending pool. 1 share == 1 USDC unit at deposit time;
    /// interest accrues separately via the reward-debt accumulator so shares never need rebasing.
    function depositLiquidity(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");

        if (lpShares[msg.sender] > 0) {
            uint256 pending = _pendingInterest(msg.sender);
            if (pending > 0) {
                availableLiquidity -= pending;
                lpShares[msg.sender] += pending; // auto-compound pending interest into principal shares
                totalLpShares += pending;
            }
        }

        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        lpShares[msg.sender] += amount;
        totalLpShares += amount;
        availableLiquidity += amount;
        lpRewardDebt[msg.sender] = (lpShares[msg.sender] * accInterestPerShare) / ACC_PRECISION;

        emit LiquidityDeposited(msg.sender, amount, amount);
    }

    /// @notice Withdraw principal (+ any accrued pro-rata interest) from the pool.
    function withdrawLiquidity(uint256 amount) external nonReentrant {
        require(amount > 0 && amount <= lpShares[msg.sender], "Invalid amount");

        uint256 pending = _pendingInterest(msg.sender);
        uint256 payout = amount + pending;
        require(payout <= availableLiquidity, "Insufficient pool liquidity");

        lpShares[msg.sender] -= amount;
        totalLpShares -= amount;
        availableLiquidity -= payout;
        lpRewardDebt[msg.sender] = (lpShares[msg.sender] * accInterestPerShare) / ACC_PRECISION;

        require(usdc.transfer(msg.sender, payout), "Transfer failed");
        emit LiquidityWithdrawn(msg.sender, amount, pending);
    }

    function pendingInterest(address lender) external view returns (uint256) {
        return _pendingInterest(lender);
    }

    // ---------------------------------------------------------------------
    // Borrowing
    // ---------------------------------------------------------------------

    /// @notice Borrow USDC against a TimeLockVault position, up to 50% of its locked value.
    function borrow(bytes32 vaultId, uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(!loans[vaultId].active, "Existing loan on this vault");

        TimeLockVault.Vault memory vault = timeLockVault.getVault(vaultId);
        require(vault.owner == msg.sender, "Not vault owner");
        require(vault.status == TimeLockVault.VaultStatus.ACTIVE, "Vault not active");
        require(block.timestamp < vault.unlockAt, "Vault already matured");

        uint256 collateralValue = vault.totalAmount;
        uint256 maxBorrow = (collateralValue * MAX_LTV_BPS) / 10000;
        require(amount <= maxBorrow, "Exceeds max LTV (50%)");
        require(amount <= availableLiquidity, "Insufficient pool liquidity");

        // Lock collateral on TimeLockVault - reverts if already locked or vault missing.
        timeLockVault.lockVaultCollateral(vaultId);

        loans[vaultId] = Loan({
            vaultId: vaultId,
            borrower: msg.sender,
            principal: amount,
            collateralValue: collateralValue,
            startTime: block.timestamp,
            active: true
        });

        availableLiquidity -= amount;
        totalBorrowed += amount;

        require(usdc.transfer(msg.sender, amount), "Transfer failed");
        emit Borrowed(vaultId, msg.sender, amount, collateralValue);
    }

    function interestOwed(bytes32 vaultId) public view returns (uint256) {
        Loan memory loan = loans[vaultId];
        if (!loan.active) return 0;
        return (loan.principal * INTEREST_BPS) / 10000;
    }

    function totalOwed(bytes32 vaultId) public view returns (uint256) {
        Loan memory loan = loans[vaultId];
        if (!loan.active) return 0;
        return loan.principal + interestOwed(vaultId);
    }

    /// @notice Repay an active loan in full before the collateral vault matures, releasing the lock.
    function repay(bytes32 vaultId) external nonReentrant {
        Loan storage loan = loans[vaultId];
        require(loan.active, "No active loan");
        require(loan.borrower == msg.sender, "Not borrower");

        TimeLockVault.Vault memory vault = timeLockVault.getVault(vaultId);
        require(block.timestamp < vault.unlockAt, "Vault matured, must be liquidated");

        uint256 interest = interestOwed(vaultId);
        uint256 owed = loan.principal + interest;

        require(usdc.transferFrom(msg.sender, address(this), owed), "Transfer failed");

        availableLiquidity += owed;
        totalBorrowed -= loan.principal;

        if (totalLpShares > 0 && interest > 0) {
            accInterestPerShare += (interest * ACC_PRECISION) / totalLpShares;
        }

        loan.active = false;
        timeLockVault.unlockVaultCollateral(vaultId);

        emit Repaid(vaultId, msg.sender, loan.principal, interest);
    }

    /// @notice Auto-liquidate a defaulted loan once the collateral vault has matured unpaid.
    /// Callable by anyone. Pulls the vault's full claimable balance into the pool, keeps enough
    /// to cover principal + interest, and releases any remainder to the original vault owner.
    function liquidate(bytes32 vaultId) external nonReentrant {
        Loan storage loan = loans[vaultId];
        require(loan.active, "No active loan");

        TimeLockVault.Vault memory vault = timeLockVault.getVault(vaultId);
        require(block.timestamp >= vault.unlockAt, "Vault not matured yet");

        uint256 owed = loan.principal + interestOwed(vaultId);

        uint256 claimed = timeLockVault.liquidateVaultCollateral(vaultId, address(this));

        uint256 toPool = claimed >= owed ? owed : claimed;
        uint256 interestRecovered = toPool > loan.principal ? toPool - loan.principal : 0;
        uint256 remainder = claimed > owed ? claimed - owed : 0;

        availableLiquidity += toPool;
        totalBorrowed -= loan.principal;

        if (totalLpShares > 0 && interestRecovered > 0) {
            accInterestPerShare += (interestRecovered * ACC_PRECISION) / totalLpShares;
        }

        loan.active = false;

        if (remainder > 0) {
            require(usdc.transfer(vault.owner, remainder), "Transfer failed");
        }

        emit Liquidated(vaultId, loan.borrower, claimed, owed, remainder);
    }

    function getLoan(bytes32 vaultId) external view returns (Loan memory) {
        return loans[vaultId];
    }

    function maxBorrowable(bytes32 vaultId) external view returns (uint256) {
        TimeLockVault.Vault memory vault = timeLockVault.getVault(vaultId);
        return (vault.totalAmount * MAX_LTV_BPS) / 10000;
    }
}
