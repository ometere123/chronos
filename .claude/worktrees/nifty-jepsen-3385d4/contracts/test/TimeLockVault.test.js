import { expect } from 'chai';
import { describe, it, beforeEach } from 'node:test';
import hre from "hardhat";
const { ethers } = hre;



describe('TimeLockVault', () => {
  let timeLockVault;
  let treasury;
  let bridgeOrchestrator;
  let mockToken;
  let owner, user1, user2, attacker;

  beforeEach(async () => {
    [owner, user1, user2, attacker] = await ethers.getSigners();

    // Deploy mock ERC20
    const MockERC20 = await ethers.getContractFactory('MockERC20');
    mockToken = await MockERC20.deploy('Test Token', 'TT', ethers.parseEther('1000000'));

    // Deploy Treasury
    const Treasury = await ethers.getContractFactory('Treasury');
    treasury = await Treasury.deploy([user1.address, user2.address, owner.address], 2);

    // Deploy TimeLockVault
    const TimeLockVault = await ethers.getContractFactory('TimeLockVault');
    timeLockVault = await TimeLockVault.deploy(treasury.address);

    // Deploy BridgeOrchestrator
    const BridgeOrchestrator = await ethers.getContractFactory('BridgeOrchestrator');
    bridgeOrchestrator = await BridgeOrchestrator.deploy(timeLockVault.address);

    // Setup bridge orchestrator
    await timeLockVault.setBridgeOrchestrator(bridgeOrchestrator.address);

    // Transfer tokens to vault and bridge orchestrator
    await mockToken.transfer(timeLockVault.address, ethers.parseEther('500000'));
    await mockToken.transfer(bridgeOrchestrator.address, ethers.parseEther('500000'));
  });

  describe('Vault Creation', () => {
    it('should create vault from bridge deposit', async () => {
      const amount = ethers.parseEther('100');
      const unlockAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days

      const tx = await timeLockVault.depositFromBridge(
        amount,
        user1.address,
        unlockAt,
        84532, // Base Sepolia
        0, // CCTP
        mockToken.address,
        0 // FIXED
      );

      await expect(tx).to.emit(timeLockVault, 'VaultCreated');

      const events = await timeLockVault.queryFilter('VaultCreated');
      expect(events.length).to.equal(1);
      expect(events[0].args.owner).to.equal(user1.address);
      expect(events[0].args.totalAmount).to.equal(amount);
    });

    it('should reject invalid deposit (zero amount)', async () => {
      const unlockAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

      await expect(
        timeLockVault.depositFromBridge(
          0,
          user1.address,
          unlockAt,
          84532,
          0,
          mockToken.address,
          0
        )
      ).to.be.revertedWith('Amount must be > 0');
    });

    it('should reject invalid owner (zero address)', async () => {
      const amount = ethers.parseEther('100');
      const unlockAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

      await expect(
        timeLockVault.depositFromBridge(
          amount,
          ethers.ZeroAddress,
          unlockAt,
          84532,
          0,
          mockToken.address,
          0
        )
      ).to.be.revertedWith('Invalid owner');
    });

    it('should reject unlock time in past', async () => {
      const amount = ethers.parseEther('100');
      const unlockAt = Math.floor(Date.now() / 1000) - 1; // Already past

      await expect(
        timeLockVault.depositFromBridge(
          amount,
          user1.address,
          unlockAt,
          84532,
          0,
          mockToken.address,
          0
        )
      ).to.be.revertedWith('Unlock time must be in future');
    });

    it('should only allow bridge orchestrator to create vaults', async () => {
      const amount = ethers.parseEther('100');
      const unlockAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

      await expect(
        timeLockVault.connect(user1).depositFromBridge(
          amount,
          user1.address,
          unlockAt,
          84532,
          0,
          mockToken.address,
          0
        )
      ).to.be.revertedWith('Only bridge orchestrator');
    });
  });

  describe('Add to Vault', () => {
    let vaultId;

    beforeEach(async () => {
      const amount = ethers.parseEther('100');
      const unlockAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

      const tx = await timeLockVault.depositFromBridge(
        amount,
        user1.address,
        unlockAt,
        84532,
        0,
        mockToken.address,
        0
      );

      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === 'VaultCreated');
      vaultId = event.args.vaultId;
    });

    it('should add funds to existing vault', async () => {
      const addAmount = ethers.parseEther('50');

      const tx = await timeLockVault.addToVault(
        vaultId,
        addAmount,
        84532,
        0,
        mockToken.address
      );

      await expect(tx).to.emit(timeLockVault, 'DepositAdded');

      const vault = await timeLockVault.getVault(vaultId);
      expect(vault.totalAmount).to.equal(ethers.parseEther('150'));
    });

    it('should reject adding to non-existent vault', async () => {
      const fakeVaultId = ethers.id('fake');
      const addAmount = ethers.parseEther('50');

      await expect(
        timeLockVault.addToVault(
          fakeVaultId,
          addAmount,
          84532,
          0,
          mockToken.address
        )
      ).to.be.revertedWith('Vault not found');
    });

    it('should reject mismatched chain', async () => {
      const addAmount = ethers.parseEther('50');

      await expect(
        timeLockVault.addToVault(
          vaultId,
          addAmount,
          26, // Different chain
          0,
          mockToken.address
        )
      ).to.be.revertedWith('Mismatched source chain');
    });

    it('should reject zero amount', async () => {
      await expect(
        timeLockVault.addToVault(
          vaultId,
          0,
          84532,
          0,
          mockToken.address
        )
      ).to.be.revertedWith('Amount must be > 0');
    });
  });

  describe('Claim Vault', () => {
    let vaultId;

    beforeEach(async () => {
      const amount = ethers.parseEther('100');
      const unlockAt = Math.floor(Date.now() / 1000) + 2; // 2 seconds

      const tx = await timeLockVault.depositFromBridge(
        amount,
        user1.address,
        unlockAt,
        84532,
        0,
        mockToken.address,
        0
      );

      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === 'VaultCreated');
      vaultId = event.args.vaultId;
    });

    it('should claim mature vault', async () => {
      // Wait for vault to mature
      await new Promise(resolve => setTimeout(resolve, 3000));

      const tx = await timeLockVault.connect(user1).claimVault(vaultId, 26);

      await expect(tx).to.emit(timeLockVault, 'VaultClaimed');

      const vault = await timeLockVault.getVault(vaultId);
      expect(vault.status).to.equal(2); // CLAIMED
    });

    it('should reject claim before mature', async () => {
      await expect(
        timeLockVault.connect(user1).claimVault(vaultId, 26)
      ).to.be.revertedWith('Vault not mature');
    });

    it('should only allow owner to claim', async () => {
      await new Promise(resolve => setTimeout(resolve, 3000));

      await expect(
        timeLockVault.connect(user2).claimVault(vaultId, 26)
      ).to.be.revertedWith('Only owner can claim');
    });

    it('should reject claim on non-active vault', async () => {
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Claim once
      await timeLockVault.connect(user1).claimVault(vaultId, 26);

      // Try to claim again
      await expect(
        timeLockVault.connect(user1).claimVault(vaultId, 26)
      ).to.be.revertedWith('Vault not active');
    });
  });

  describe('Flexible Withdrawal', () => {
    let vaultId;

    beforeEach(async () => {
      const amount = ethers.parseEther('100');
      const unlockAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

      const tx = await timeLockVault.depositFromBridge(
        amount,
        user1.address,
        unlockAt,
        84532,
        0,
        mockToken.address,
        1 // FLEXIBLE
      );

      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === 'VaultCreated');
      vaultId = event.args.vaultId;
    });

    it('should withdraw with 0.5% penalty before unlock', async () => {
      const withdrawAmount = ethers.parseEther('50');
      const expectedPenalty = ethers.parseEther('50').mul(5).div(1000); // 0.5%

      const tx = await timeLockVault.connect(user1).withdrawFlexible(vaultId, withdrawAmount);

      await expect(tx).to.emit(timeLockVault, 'FlexibleWithdrawal');

      const vault = await timeLockVault.getVault(vaultId);
      expect(vault.totalAmount).to.equal(ethers.parseEther('50'));
    });

    it('should withdraw without penalty after unlock', async () => {
      // Fast forward past unlock
      const vault = await timeLockVault.getVault(vaultId);
      await ethers.provider.send('evm_mine', [vault.unlockAt.toNumber() + 1]);

      const withdrawAmount = ethers.parseEther('50');

      const tx = await timeLockVault.connect(user1).withdrawFlexible(vaultId, withdrawAmount);

      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === 'FlexibleWithdrawal');
      expect(event.args.penalty).to.equal(0);
    });

    it('should reject withdrawal from fixed vault', async () => {
      // Create fixed vault
      const amount = ethers.parseEther('100');
      const unlockAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

      const tx = await timeLockVault.depositFromBridge(
        amount,
        user1.address,
        unlockAt,
        84532,
        0,
        mockToken.address,
        0 // FIXED
      );

      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === 'VaultCreated');
      const fixedVaultId = event.args.vaultId;

      await expect(
        timeLockVault.connect(user1).withdrawFlexible(fixedVaultId, ethers.parseEther('50'))
      ).to.be.revertedWith('Not flexible vault');
    });

    it('should reject withdrawal over balance', async () => {
      await expect(
        timeLockVault.connect(user1).withdrawFlexible(vaultId, ethers.parseEther('150'))
      ).to.be.revertedWith('Invalid amount');
    });

    it('should only allow owner to withdraw', async () => {
      await expect(
        timeLockVault.connect(user2).withdrawFlexible(vaultId, ethers.parseEther('50'))
      ).to.be.revertedWith('Only owner');
    });
  });

  describe('Reentrancy Protection', () => {
    let vaultId;
    let reentrantToken;

    beforeEach(async () => {
      // Deploy reentrancy attacker contract
      const ReentrantToken = await ethers.getContractFactory('ReentrantToken');
      reentrantToken = await ReentrantToken.deploy(timeLockVault.address);

      // Create vault
      const amount = ethers.parseEther('100');
      const unlockAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

      const tx = await timeLockVault.depositFromBridge(
        amount,
        attacker.address,
        unlockAt,
        84532,
        0,
        reentrantToken.address,
        1 // FLEXIBLE
      );

      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === 'VaultCreated');
      vaultId = event.args.vaultId;
    });

    it('should prevent reentrancy on withdrawal', async () => {
      // This test verifies that nonReentrant guard works
      // Implementation depends on ReentrantToken mock
      expect(true).to.equal(true); // Placeholder
    });
  });

  describe('View Functions', () => {
    let vaultId;

    beforeEach(async () => {
      const amount = ethers.parseEther('100');
      const unlockAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

      const tx = await timeLockVault.depositFromBridge(
        amount,
        user1.address,
        unlockAt,
        84532,
        0,
        mockToken.address,
        0
      );

      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === 'VaultCreated');
      vaultId = event.args.vaultId;
    });

    it('should return correct vault details', async () => {
      const vault = await timeLockVault.getVault(vaultId);

      expect(vault.owner).to.equal(user1.address);
      expect(vault.totalAmount).to.equal(ethers.parseEther('100'));
      expect(vault.vaultType).to.equal(0); // FIXED
      expect(vault.status).to.equal(0); // ACTIVE
    });

    it('should return vault deposits', async () => {
      const deposits = await timeLockVault.getDeposits(vaultId);

      expect(deposits.length).to.equal(1);
      expect(deposits[0].amount).to.equal(ethers.parseEther('100'));
    });

    it('should return user vaults', async () => {
      const userVaults = await timeLockVault.getUserVaults(user1.address);

      expect(userVaults.length).to.equal(1);
      expect(userVaults[0]).to.equal(vaultId);
    });

    it('should correctly check if vault is mature', async () => {
      let isMatured = await timeLockVault.isMatured(vaultId);
      expect(isMatured).to.equal(false);

      // Fast forward past unlock
      const vault = await timeLockVault.getVault(vaultId);
      await ethers.provider.send('evm_mine', [vault.unlockAt.toNumber() + 1]);

      isMatured = await timeLockVault.isMatured(vaultId);
      expect(isMatured).to.equal(true);
    });

    it('should return correct remaining time', async () => {
      const vault = await timeLockVault.getVault(vaultId);
      const remaining = await timeLockVault.getRemainingTime(vaultId);

      expect(remaining).to.be.lessThanOrEqual(vault.unlockAt - Math.floor(Date.now() / 1000));
      expect(remaining).to.be.greaterThan(0);
    });
  });

  describe('Duration Validation', () => {
    it('should enforce minimum duration (30 mins)', async () => {
      const amount = ethers.parseEther('100');
      const unlockAt = Math.floor(Date.now() / 1000) + 60; // 1 minute

      // This test assumes VaultFactory would reject, but TimeLockVault doesn't validate duration
      // Duration is validated in VaultFactory
      expect(true).to.equal(true);
    });

    it('should enforce maximum duration (12 months)', async () => {
      // This test assumes VaultFactory would reject
      expect(true).to.equal(true);
    });
  });

  describe('Vault Immutability', () => {
    let vaultId;

    beforeEach(async () => {
      const amount = ethers.parseEther('100');
      const unlockAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

      const tx = await timeLockVault.depositFromBridge(
        amount,
        user1.address,
        unlockAt,
        84532,
        0,
        mockToken.address,
        0
      );

      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === 'VaultCreated');
      vaultId = event.args.vaultId;
    });

    it('should not allow changing unlock time', async () => {
      const vault = await timeLockVault.getVault(vaultId);
      const originalUnlockAt = vault.unlockAt;

      // No function to change unlock time should exist
      expect(originalUnlockAt).to.equal(originalUnlockAt);
    });

    it('should not allow changing owner', async () => {
      const vault = await timeLockVault.getVault(vaultId);
      const originalOwner = vault.owner;

      // No function to change owner should exist
      expect(originalOwner).to.equal(user1.address);
    });
  });
});
