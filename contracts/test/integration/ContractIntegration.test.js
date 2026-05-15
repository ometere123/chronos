import { expect } from 'chai';
import { describe, it, beforeEach } from 'node:test';
import hre from "hardhat";
const { ethers } = hre;


import { time } from '@nomicfoundation/hardhat-network-helpers';

describe('Contract Integration Tests', () => {
  let timeLockVault;
  let vaultFactory;
  let treasury;
  let bridgeOrchestrator;
  let proofOfReserves;
  let timelock;
  let mockToken;
  let owner, user1, user2, attacker;

  beforeEach(async () => {
    [owner, user1, user2, attacker] = await ethers.getSigners();

    // Deploy mock ERC20
    const MockERC20 = await ethers.getContractFactory('MockERC20');
    mockToken = await MockERC20.deploy('USDC', 'USDC', ethers.parseEther('1000000'));

    // Deploy Treasury
    const Treasury = await ethers.getContractFactory('Treasury');
    treasury = await Treasury.deploy([user1.address, user2.address, owner.address], 2);

    // Deploy TimeLockVault
    const TimeLockVault = await ethers.getContractFactory('TimeLockVault');
    timeLockVault = await TimeLockVault.deploy(treasury.address);

    // Deploy VaultFactory
    const VaultFactory = await ethers.getContractFactory('VaultFactory');
    vaultFactory = await VaultFactory.deploy(timeLockVault.address);

    // Deploy BridgeOrchestrator
    const BridgeOrchestrator = await ethers.getContractFactory('BridgeOrchestrator');
    bridgeOrchestrator = await BridgeOrchestrator.deploy(timeLockVault.address);

    // Deploy ProofOfReserves
    const ProofOfReserves = await ethers.getContractFactory('ProofOfReserves');
    proofOfReserves = await ProofOfReserves.deploy(
      timeLockVault.address,
      vaultFactory.address,
      mockToken.address
    );

    // Deploy GovernanceTimelock
    const GovernanceTimelock = await ethers.getContractFactory('GovernanceTimelock');
    timelock = await GovernanceTimelock.deploy();

    // Setup connections
    await timeLockVault.setBridgeOrchestrator(bridgeOrchestrator.address);
    await bridgeOrchestrator.configureCCTP(user1.address, owner.address);
    await bridgeOrchestrator.configureLayerZero(owner.address);

    // Transfer tokens
    await mockToken.transfer(timeLockVault.address, ethers.parseEther('500000'));
    await mockToken.transfer(user1.address, ethers.parseEther('10000'));
  });

  describe('Complete Vault Lifecycle', () => {
    it('should complete full create → deposit → claim flow', async () => {
      const amount = ethers.parseEther('100');
      const duration = 7 * 24 * 60 * 60;

      // 1. Create vault via factory
      const createTx = await vaultFactory.connect(user1).createVault(
        amount,
        duration,
        84532,
        26,
        0,
        mockToken.address,
        0 // FIXED
      );

      const createReceipt = await createTx.wait();
      const createEvent = createReceipt.events.find(e => e.event === 'VaultCreated');
      const vaultId = createEvent.args.vaultId;

      // 2. Verify vault created in TimeLockVault
      const vault = await timeLockVault.getVault(vaultId);
      expect(vault.owner).to.equal(user1.address);
      expect(vault.totalAmount).to.equal(amount);

      // 3. Verify stats updated
      expect(await vaultFactory.getTotalVaults()).to.equal(1);
      expect(await vaultFactory.getTotalLocked()).to.equal(amount);

      // 4. Check ProofOfReserves
      const reserves = await proofOfReserves.getReserveDetails();
      expect(reserves.totalLocked).to.equal(amount);
      expect(reserves.totalVaults).to.equal(1);

      // 5. Add deposit via bridge
      await bridgeOrchestrator.configureCCTP(user1.address, owner.address);
      const addTx = await bridgeOrchestrator.receiveBridgedUSDC_CCTP(
        ethers.parseEther('50'),
        84532,
        user1.address,
        vault.unlockAt,
        26,
        duration,
        0
      );

      const addReceipt = await addTx.wait();
      expect(addReceipt.events.some(e => e.event === 'BridgeCompleted')).to.be.true;

      // 6. Wait for vault to mature
      await time.increase(duration + 1);

      // 7. Claim vault
      const claimTx = await timeLockVault.connect(user1).claimVault(vaultId, 26);
      await expect(claimTx).to.emit(timeLockVault, 'VaultClaimed');

      // 8. Verify final state
      const claimedVault = await timeLockVault.getVault(vaultId);
      expect(claimedVault.status).to.equal(2); // CLAIMED

      // 9. Verify reserves updated
      const finalReserves = await proofOfReserves.getReserveDetails();
      expect(finalReserves.totalLocked).to.be.lessThan(reserves.totalLocked);
    });

    it('should handle multiple vaults in parallel', async () => {
      const amount = ethers.parseEther('100');
      const duration = 7 * 24 * 60 * 60;
      const vaultIds = [];

      // Create 5 vaults
      for (let i = 0; i < 5; i++) {
        const tx = await vaultFactory.connect(user1).createVault(
          amount,
          duration,
          84532,
          26,
          0,
          mockToken.address,
          0
        );

        const receipt = await tx.wait();
        const event = receipt.events.find(e => e.event === 'VaultCreated');
        vaultIds.push(event.args.vaultId);
      }

      // Verify all created
      expect(await vaultFactory.getTotalVaults()).to.equal(5);
      expect(await vaultFactory.getTotalLocked()).to.equal(ethers.parseEther('500'));

      // Verify user has all vaults
      const userVaults = await vaultFactory.getUserVaults(user1.address);
      expect(userVaults.length).to.equal(5);

      // Claim first vault after maturity
      await time.increase(duration + 1);
      const firstVault = await timeLockVault.getVault(vaultIds[0]);

      await timeLockVault.connect(user1).claimVault(vaultIds[0], 26);
      const claimedVault = await timeLockVault.getVault(vaultIds[0]);
      expect(claimedVault.status).to.equal(2); // CLAIMED

      // Other vaults still active
      for (let i = 1; i < 5; i++) {
        const vault = await timeLockVault.getVault(vaultIds[i]);
        expect(vault.status).to.equal(0); // ACTIVE
      }
    });

    it('should handle flexible vault with early withdrawal', async () => {
      const amount = ethers.parseEther('100');
      const duration = 7 * 24 * 60 * 60;

      // Create flexible vault
      const tx = await vaultFactory.connect(user1).createVault(
        amount,
        duration,
        84532,
        26,
        0,
        mockToken.address,
        1 // FLEXIBLE
      );

      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === 'VaultCreated');
      const vaultId = event.args.vaultId;

      // Verify initial state
      const vault = await timeLockVault.getVault(vaultId);
      expect(vault.vaultType).to.equal(1); // FLEXIBLE

      // Withdraw early (with penalty)
      const withdrawAmount = ethers.parseEther('50');
      const withdrawTx = await timeLockVault.connect(user1).withdrawFlexible(
        vaultId,
        withdrawAmount
      );

      await expect(withdrawTx).to.emit(timeLockVault, 'FlexibleWithdrawal');

      // Verify vault reduced
      const updatedVault = await timeLockVault.getVault(vaultId);
      expect(updatedVault.totalAmount).to.equal(ethers.parseEther('50'));

      // Verify stats reduced
      expect(await vaultFactory.getTotalLocked()).to.equal(ethers.parseEther('50'));
    });
  });

  describe('Bridge Integration (CCTP → Vault → Claim)', () => {
    it('should flow: CCTP inbound → vault creation → maturity → claim', async () => {
      const amount = ethers.parseEther('100');
      const duration = 3 * 24 * 60 * 60;
      const unlockAt = Math.floor(Date.now() / 1000) + duration;

      // 1. Bridge USDC via CCTP
      const bridgeTx = await bridgeOrchestrator.receiveBridgedUSDC_CCTP(
        amount,
        84532, // Base
        user1.address,
        unlockAt,
        26, // Arc
        duration,
        0 // FIXED
      );

      const bridgeReceipt = await bridgeTx.wait();
      expect(bridgeReceipt.events.some(e => e.event === 'BridgeCompleted')).to.be.true;

      // 2. Verify vault created
      const userVaults = await timeLockVault.getUserVaults(user1.address);
      expect(userVaults.length).to.equal(1);

      const vaultId = userVaults[0];
      const vault = await timeLockVault.getVault(vaultId);
      expect(vault.owner).to.equal(user1.address);
      expect(vault.totalAmount).to.equal(amount);
      expect(vault.sourceChain).to.equal(84532);

      // 3. Verify reserves
      const reserves = await proofOfReserves.getReserveDetails();
      expect(reserves.totalLocked).to.equal(amount);
      expect(reserves.verified).to.be.true;

      // 4. Fast forward to maturity
      await time.increase(duration + 1);

      // 5. Claim vault
      const claimTx = await timeLockVault.connect(user1).claimVault(vaultId, 84532);
      await expect(claimTx).to.emit(timeLockVault, 'VaultClaimed');

      // 6. Verify final state
      const claimedVault = await timeLockVault.getVault(vaultId);
      expect(claimedVault.status).to.equal(2); // CLAIMED
    });

    it('should flow: LayerZero inbound → vault creation → maturity → claim', async () => {
      const amount = ethers.parseEther('100');
      const duration = 3 * 24 * 60 * 60;
      const unlockAt = Math.floor(Date.now() / 1000) + duration;

      // 1. Bridge token via LayerZero
      const bridgeTx = await bridgeOrchestrator.receiveBridgedToken_LayerZero(
        amount,
        84532, // Base
        user1.address,
        unlockAt,
        mockToken.address,
        26, // Arc
        duration,
        0 // FIXED
      );

      const bridgeReceipt = await bridgeTx.wait();
      expect(bridgeReceipt.events.some(e => e.event === 'BridgeCompleted')).to.be.true;

      // 2. Verify vault created
      const userVaults = await timeLockVault.getUserVaults(user1.address);
      const vaultId = userVaults[0];

      const vault = await timeLockVault.getVault(vaultId);
      expect(vault.tokenAddress).to.equal(mockToken.address);
      expect(vault.sourceChain).to.equal(84532);

      // 3. Fast forward and claim
      await time.increase(duration + 1);
      await timeLockVault.connect(user1).claimVault(vaultId, 84532);

      const claimedVault = await timeLockVault.getVault(vaultId);
      expect(claimedVault.status).to.equal(2); // CLAIMED
    });

    it('should handle multiple bridge protocols in sequence', async () => {
      const amount = ethers.parseEther('100');
      const duration = 3 * 24 * 60 * 60;
      const unlockAt = Math.floor(Date.now() / 1000) + duration;

      // 1. Bridge via CCTP
      const cctpTx = await bridgeOrchestrator.receiveBridgedUSDC_CCTP(
        amount,
        84532,
        user1.address,
        unlockAt,
        26,
        duration,
        0
      );
      await expect(cctpTx).to.emit(bridgeOrchestrator, 'BridgeCompleted');

      // 2. Bridge via LayerZero
      const lzTx = await bridgeOrchestrator.receiveBridgedToken_LayerZero(
        amount,
        421614,
        user1.address,
        unlockAt,
        mockToken.address,
        26,
        duration,
        0
      );
      await expect(lzTx).to.emit(bridgeOrchestrator, 'BridgeCompleted');

      // 3. Verify both vaults created
      const userVaults = await timeLockVault.getUserVaults(user1.address);
      expect(userVaults.length).to.equal(2);

      // 4. Verify stats
      expect(await vaultFactory.getTotalVaults()).to.equal(2);
      expect(await vaultFactory.getTotalLocked()).to.equal(ethers.parseEther('200'));
    });
  });

  describe('Reserve Verification Integration', () => {
    it('should verify reserves across multiple vaults', async () => {
      const duration = 7 * 24 * 60 * 60;
      const unlockAt = Math.floor(Date.now() / 1000) + duration;

      // Create multiple vaults
      for (let i = 0; i < 3; i++) {
        await bridgeOrchestrator.receiveBridgedUSDC_CCTP(
          ethers.parseEther('100'),
          84532,
          user1.address,
          unlockAt,
          26,
          duration,
          0
        );
      }

      // Verify reserves
      const verified = await proofOfReserves.verifyReserves();
      expect(verified).to.be.true;

      const details = await proofOfReserves.getReserveDetails();
      expect(details.totalLocked).to.equal(ethers.parseEther('300'));
      expect(details.totalVaults).to.equal(3);
      expect(details.verified).to.be.true;
    });

    it('should track locked amounts by chain', async () => {
      const duration = 7 * 24 * 60 * 60;
      const unlockAt = Math.floor(Date.now() / 1000) + duration;

      // Create vaults on different chains
      await bridgeOrchestrator.receiveBridgedUSDC_CCTP(
        ethers.parseEther('100'),
        84532, // Base
        user1.address,
        unlockAt,
        26,
        duration,
        0
      );

      await bridgeOrchestrator.receiveBridgedUSDC_CCTP(
        ethers.parseEther('50'),
        421614, // Arbitrum
        user1.address,
        unlockAt,
        26,
        duration,
        0
      );

      // Verify locked by chain
      const baseLocked = await proofOfReserves.getLockedByChain(84532);
      const arbitrumLocked = await proofOfReserves.getLockedByChain(421614);

      expect(baseLocked).to.equal(ethers.parseEther('100'));
      expect(arbitrumLocked).to.equal(ethers.parseEther('50'));

      // Verify total
      expect(baseLocked + arbitrumLocked).to.equal(ethers.parseEther('150'));
    });

    it('should track locked amounts by token', async () => {
      const duration = 7 * 24 * 60 * 60;
      const unlockAt = Math.floor(Date.now() / 1000) + duration;

      // Create another token
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const token2 = await MockERC20.deploy('TOKEN2', 'T2', ethers.parseEther('1000000'));
      await token2.transfer(timeLockVault.address, ethers.parseEther('500000'));

      // Create vaults with different tokens
      await bridgeOrchestrator.receiveBridgedUSDC_CCTP(
        ethers.parseEther('100'),
        84532,
        user1.address,
        unlockAt,
        26,
        duration,
        0
      );

      // LayerZero with token2
      await bridgeOrchestrator.receiveBridgedToken_LayerZero(
        ethers.parseEther('75'),
        84532,
        user1.address,
        unlockAt,
        token2.address,
        26,
        duration,
        0
      );

      // Verify locked by token
      const usdcLocked = await proofOfReserves.getTotalTokenLocked(mockToken.address);
      const token2Locked = await proofOfReserves.getTotalTokenLocked(token2.address);

      expect(usdcLocked).to.equal(ethers.parseEther('100'));
      expect(token2Locked).to.equal(ethers.parseEther('75'));
    });
  });

  describe('Governance Integration', () => {
    it('should schedule and execute upgrade with 7-day delay', async () => {
      const MockImpl = await ethers.getContractFactory('MockImplementation');
      const impl = await MockImpl.deploy();

      const callData = impl.interface.encodeFunctionData('setValue', [42]);

      // 1. Schedule upgrade
      const scheduleTx = await timelock.scheduleUpgrade(impl.address, callData);
      await expect(scheduleTx).to.emit(timelock, 'UpgradeScheduled');

      const receipt = await scheduleTx.wait();
      const event = receipt.events.find(e => e.event === 'UpgradeScheduled');
      const proposalId = event.args.proposalId;

      // 2. Attempt execution before delay
      await expect(
        timelock.executeUpgrade(proposalId)
      ).to.be.revertedWith('Timelock not ready');

      // 3. Advance time past 7 days
      await time.increase(7 * 24 * 60 * 60 + 1);

      // 4. Execute upgrade
      const executeTx = await timelock.executeUpgrade(proposalId);
      await expect(executeTx).to.emit(timelock, 'UpgradeExecuted');

      // 5. Verify execution
      const proposal = await timelock.getProposal(proposalId);
      expect(proposal.executed).to.be.true;
    });

    it('should cancel and reschedule upgrade', async () => {
      const MockImpl = await ethers.getContractFactory('MockImplementation');
      const impl = await MockImpl.deploy();

      const callData = impl.interface.encodeFunctionData('setValue', [42]);

      // 1. Schedule initial upgrade
      const tx1 = await timelock.scheduleUpgrade(impl.address, callData);
      const receipt1 = await tx1.wait();
      const proposalId1 = receipt1.events.find(e => e.event === 'UpgradeScheduled').args.proposalId;

      // 2. Cancel it
      const cancelTx = await timelock.cancelUpgrade(proposalId1);
      await expect(cancelTx).to.emit(timelock, 'UpgradeCancelled');

      // 3. Reschedule
      const tx2 = await timelock.scheduleUpgrade(impl.address, callData);
      const receipt2 = await tx2.wait();
      const proposalId2 = receipt2.events.find(e => e.event === 'UpgradeScheduled').args.proposalId;

      // 4. Verify old is cancelled, new is ready
      const prop1 = await timelock.getProposal(proposalId1);
      const prop2 = await timelock.getProposal(proposalId2);

      expect(prop1.cancelled).to.be.true;
      expect(prop2.cancelled).to.be.false;
    });
  });

  describe('Multi-User Interaction', () => {
    it('should handle vaults from multiple users independently', async () => {
      const amount1 = ethers.parseEther('100');
      const amount2 = ethers.parseEther('75');
      const duration = 7 * 24 * 60 * 60;

      // User1 creates vault
      const tx1 = await vaultFactory.connect(user1).createVault(
        amount1,
        duration,
        84532,
        26,
        0,
        mockToken.address,
        0
      );

      // User2 creates vault
      const tx2 = await vaultFactory.connect(user2).createVault(
        amount2,
        duration,
        84532,
        26,
        0,
        mockToken.address,
        0
      );

      // Verify independent vaults
      const user1Vaults = await vaultFactory.getUserVaults(user1.address);
      const user2Vaults = await vaultFactory.getUserVaults(user2.address);

      expect(user1Vaults.length).to.equal(1);
      expect(user2Vaults.length).to.equal(1);

      const user1Vault = await timeLockVault.getVault(user1Vaults[0]);
      const user2Vault = await timeLockVault.getVault(user2Vaults[0]);

      expect(user1Vault.owner).to.equal(user1.address);
      expect(user2Vault.owner).to.equal(user2.address);
      expect(user1Vault.totalAmount).to.equal(amount1);
      expect(user2Vault.totalAmount).to.equal(amount2);

      // Verify total stats
      expect(await vaultFactory.getTotalVaults()).to.equal(2);
      expect(await vaultFactory.getTotalLocked()).to.equal(amount1 + amount2);
    });

    it('should enforce access control across users', async () => {
      const amount = ethers.parseEther('100');
      const duration = 7 * 24 * 60 * 60;

      // User1 creates vault
      const tx = await vaultFactory.connect(user1).createVault(
        amount,
        duration,
        84532,
        26,
        0,
        mockToken.address,
        0
      );

      const receipt = await tx.wait();
      const vaultId = receipt.events.find(e => e.event === 'VaultCreated').args.vaultId;

      // User2 cannot claim user1's vault
      await time.increase(duration + 1);

      await expect(
        timeLockVault.connect(user2).claimVault(vaultId, 26)
      ).to.be.revertedWith('Only owner can claim');

      // User1 can claim
      const claimTx = await timeLockVault.connect(user1).claimVault(vaultId, 26);
      await expect(claimTx).to.emit(timeLockVault, 'VaultClaimed');
    });
  });

  describe('Treasury Integration', () => {
    it('should collect penalties in treasury', async () => {
      const amount = ethers.parseEther('100');
      const duration = 7 * 24 * 60 * 60;

      // Create flexible vault
      const tx = await vaultFactory.connect(user1).createVault(
        amount,
        duration,
        84532,
        26,
        0,
        mockToken.address,
        1 // FLEXIBLE
      );

      const receipt = await tx.wait();
      const vaultId = receipt.events.find(e => e.event === 'VaultCreated').args.vaultId;

      // Withdraw early (with penalty)
      const withdrawAmount = ethers.parseEther('100');
      const expectedPenalty = withdrawAmount.mul(5).div(1000); // 0.5%

      const withdrawTx = await timeLockVault.connect(user1).withdrawFlexible(
        vaultId,
        withdrawAmount
      );

      const withdrawReceipt = await withdrawTx.wait();
      const event = withdrawReceipt.events.find(e => e.event === 'FlexibleWithdrawal');

      // Verify penalty in event
      expect(event.args.penalty).to.equal(expectedPenalty);
    });
  });

  describe('Error Recovery', () => {
    it('should recover from invalid bridge state', async () => {
      const amount = ethers.parseEther('100');
      const duration = 7 * 24 * 60 * 60;
      const unlockAt = Math.floor(Date.now() / 1000) + duration;

      // Attempt bridge with missing configuration
      const unconfiguredBridge = new ethers.Contract(
        bridgeOrchestrator.address,
        bridgeOrchestrator.interface,
        owner
      );

      // Create new orchestrator without proper setup
      const BridgeOrchestrator = await ethers.getContractFactory('BridgeOrchestrator');
      const newBridge = await BridgeOrchestrator.deploy(timeLockVault.address);

      // Attempt LayerZero without configuration
      await expect(
        newBridge.receiveBridgedToken_LayerZero(
          amount,
          84532,
          user1.address,
          unlockAt,
          mockToken.address,
          26,
          duration,
          0
        )
      ).to.be.revertedWith('Only LayerZero endpoint');

      // Reconfigure correctly
      await newBridge.configureLayerZero(owner.address);

      const tx = await newBridge.receiveBridgedToken_LayerZero(
        amount,
        84532,
        user1.address,
        unlockAt,
        mockToken.address,
        26,
        duration,
        0
      );

      await expect(tx).to.emit(newBridge, 'BridgeCompleted');
    });
  });
});
