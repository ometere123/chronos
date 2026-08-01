import { expect } from 'chai';
import { describe, it, beforeEach } from 'node:test';
import hre from "hardhat";
const { ethers } = await hre.network.connect();



describe('VaultFactory', () => {
  let vaultFactory;
  let timeLockVault;
  let mockToken;
  let owner, user1, user2;

  beforeEach(async () => {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy mock ERC20
    const MockERC20 = await ethers.getContractFactory('MockERC20');
    mockToken = await MockERC20.deploy('Test Token', 'TT', ethers.parseEther('1000000'));

    // Deploy TimeLockVault
    const Treasury = await ethers.getContractFactory('Treasury');
    const treasury = await Treasury.deploy(mockToken.address, [user1.address, user2.address, owner.address], 2);

    const TimeLockVault = await ethers.getContractFactory('TimeLockVault');
    timeLockVault = await TimeLockVault.deploy(treasury.address);

    // Deploy VaultFactory
    const VaultFactory = await ethers.getContractFactory('VaultFactory');
    vaultFactory = await VaultFactory.deploy(timeLockVault.address);
  });

  describe('Vault Creation', () => {
    it('should create vault with valid parameters', async () => {
      const amount = ethers.parseEther('100');
      const duration = 7 * 24 * 60 * 60; // 7 days

      const tx = await vaultFactory.createVault(
        amount,
        duration,
        84532, // Base Sepolia
        26, // Arc
        0, // CCTP
        mockToken.address,
        0 // FIXED
      );

      await expect(tx).to.emit(vaultFactory, 'VaultCreated');
      expect(await vaultFactory.getTotalVaults()).to.equal(1);
      expect(await vaultFactory.getTotalLocked()).to.equal(amount);
    });

    it('should reject zero amount', async () => {
      const duration = 7 * 24 * 60 * 60;

      await expect(
        vaultFactory.createVault(
          0,
          duration,
          84532,
          26,
          0,
          mockToken.address,
          0
        )
      ).to.be.revertedWith('Amount must be > 0');
    });

    it('should enforce minimum duration (30 minutes)', async () => {
      const amount = ethers.parseEther('100');
      const duration = 15 * 60; // 15 minutes

      await expect(
        vaultFactory.createVault(
          amount,
          duration,
          84532,
          26,
          0,
          mockToken.address,
          0
        )
      ).to.be.revertedWith('Invalid duration');
    });

    it('should enforce maximum duration (365 days)', async () => {
      const amount = ethers.parseEther('100');
      const duration = 400 * 24 * 60 * 60; // 400 days

      await expect(
        vaultFactory.createVault(
          amount,
          duration,
          84532,
          26,
          0,
          mockToken.address,
          0
        )
      ).to.be.revertedWith('Invalid duration');
    });

    it('should reject invalid token address', async () => {
      const amount = ethers.parseEther('100');
      const duration = 7 * 24 * 60 * 60;

      await expect(
        vaultFactory.createVault(
          amount,
          duration,
          84532,
          26,
          0,
          ethers.ZeroAddress,
          0
        )
      ).to.be.revertedWith('Invalid token');
    });

    it('should support both FIXED and FLEXIBLE vault types', async () => {
      const amount = ethers.parseEther('100');
      const duration = 7 * 24 * 60 * 60;

      // FIXED
      let tx = await vaultFactory.createVault(
        amount,
        duration,
        84532,
        26,
        0,
        mockToken.address,
        0
      );
      await expect(tx).to.emit(vaultFactory, 'VaultCreated');

      // FLEXIBLE
      tx = await vaultFactory.createVault(
        amount,
        duration,
        84532,
        26,
        0,
        mockToken.address,
        1
      );
      await expect(tx).to.emit(vaultFactory, 'VaultCreated');

      expect(await vaultFactory.getTotalVaults()).to.equal(2);
    });
  });

  describe('Statistics Tracking', () => {
    it('should track total locked amount', async () => {
      const amount1 = ethers.parseEther('100');
      const amount2 = ethers.parseEther('50');
      const duration = 7 * 24 * 60 * 60;

      await vaultFactory.createVault(amount1, duration, 84532, 26, 0, mockToken.address, 0);
      await vaultFactory.createVault(amount2, duration, 84532, 26, 0, mockToken.address, 0);

      const totalLocked = await vaultFactory.getTotalLocked();
      expect(totalLocked).to.equal(amount1 + amount2);
    });

    it('should track locked amount by chain', async () => {
      const amount1 = ethers.parseEther('100');
      const amount2 = ethers.parseEther('50');
      const duration = 7 * 24 * 60 * 60;

      await vaultFactory.createVault(amount1, duration, 84532, 26, 0, mockToken.address, 0);
      await vaultFactory.createVault(amount2, duration, 421614, 26, 0, mockToken.address, 0);

      const baseLocked = await vaultFactory.getTotalLockedByChain(84532);
      const arbitrumLocked = await vaultFactory.getTotalLockedByChain(421614);

      expect(baseLocked).to.equal(amount1);
      expect(arbitrumLocked).to.equal(amount2);
    });

    it('should track locked amount by token', async () => {
      const amount1 = ethers.parseEther('100');
      const amount2 = ethers.parseEther('50');
      const duration = 7 * 24 * 60 * 60;

      // Deploy another mock token
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const token2 = await MockERC20.deploy('Token 2', 'T2', ethers.parseEther('1000000'));

      await vaultFactory.createVault(amount1, duration, 84532, 26, 0, mockToken.address, 0);
      await vaultFactory.createVault(amount2, duration, 84532, 26, 0, token2.address, 0);

      const token1Locked = await vaultFactory.getTotalLockedByToken(mockToken.address);
      const token2Locked = await vaultFactory.getTotalLockedByToken(token2.address);

      expect(token1Locked).to.equal(amount1);
      expect(token2Locked).to.equal(amount2);
    });

    it('should track total vault count', async () => {
      const amount = ethers.parseEther('100');
      const duration = 7 * 24 * 60 * 60;

      for (let i = 0; i < 5; i++) {
        await vaultFactory.createVault(amount, duration, 84532, 26, 0, mockToken.address, 0);
      }

      const totalVaults = await vaultFactory.getTotalVaults();
      expect(totalVaults).to.equal(5);
    });
  });

  describe('User Vault Management', () => {
    it('should return user vaults', async () => {
      const amount = ethers.parseEther('100');
      const duration = 7 * 24 * 60 * 60;

      await vaultFactory.connect(user1).createVault(
        amount,
        duration,
        84532,
        26,
        0,
        mockToken.address,
        0
      );

      await vaultFactory.connect(user1).createVault(
        amount,
        duration,
        84532,
        26,
        0,
        mockToken.address,
        0
      );

      const userVaults = await vaultFactory.getUserVaults(user1.address);
      expect(userVaults.length).to.equal(2);
    });

    it('should track vaults per user separately', async () => {
      const amount = ethers.parseEther('100');
      const duration = 7 * 24 * 60 * 60;

      await vaultFactory.connect(user1).createVault(
        amount,
        duration,
        84532,
        26,
        0,
        mockToken.address,
        0
      );

      await vaultFactory.connect(user2).createVault(
        amount,
        duration,
        84532,
        26,
        0,
        mockToken.address,
        0
      );

      const user1Vaults = await vaultFactory.getUserVaults(user1.address);
      const user2Vaults = await vaultFactory.getUserVaults(user2.address);

      expect(user1Vaults.length).to.equal(1);
      expect(user2Vaults.length).to.equal(1);
    });

    it('should return empty array for user with no vaults', async () => {
      const userVaults = await vaultFactory.getUserVaults(user1.address);
      expect(userVaults.length).to.equal(0);
    });
  });

  describe('Vault Details', () => {
    it('should retrieve vault from registry', async () => {
      const amount = ethers.parseEther('100');
      const duration = 7 * 24 * 60 * 60;

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
      const vaultId = event.args.vaultId;

      const vault = await vaultFactory.getVault(vaultId);

      expect(vault.owner).to.equal(user1.address);
      expect(vault.totalAmount).to.equal(amount);
      expect(vault.sourceChain).to.equal(84532);
      expect(vault.vaultType).to.equal(0); // FIXED
    });
  });

  describe('Duration Validation', () => {
    it('should accept minimum duration (30 minutes)', async () => {
      const amount = ethers.parseEther('100');
      const minDuration = 30 * 60;

      const tx = await vaultFactory.createVault(
        amount,
        minDuration,
        84532,
        26,
        0,
        mockToken.address,
        0
      );

      await expect(tx).to.emit(vaultFactory, 'VaultCreated');
    });

    it('should accept maximum duration (365 days)', async () => {
      const amount = ethers.parseEther('100');
      const maxDuration = 365 * 24 * 60 * 60;

      const tx = await vaultFactory.createVault(
        amount,
        maxDuration,
        84532,
        26,
        0,
        mockToken.address,
        0
      );

      await expect(tx).to.emit(vaultFactory, 'VaultCreated');
    });

    it('should reject duration below minimum', async () => {
      const amount = ethers.parseEther('100');
      const duration = 29 * 60; // 29 minutes

      await expect(
        vaultFactory.createVault(amount, duration, 84532, 26, 0, mockToken.address, 0)
      ).to.be.revertedWith('Invalid duration');
    });

    it('should reject duration above maximum', async () => {
      const amount = ethers.parseEther('100');
      const duration = 366 * 24 * 60 * 60; // 366 days

      await expect(
        vaultFactory.createVault(amount, duration, 84532, 26, 0, mockToken.address, 0)
      ).to.be.revertedWith('Invalid duration');
    });
  });

  describe('Stats Update', () => {
    it('should update stats on owner call', async () => {
      const initialTotal = await vaultFactory.getTotalLocked();

      await vaultFactory.updateStats(ethers.parseEther('100'), true);
      const afterIncrease = await vaultFactory.getTotalLocked();

      expect(afterIncrease).to.equal(initialTotal + ethers.parseEther('100'));

      await vaultFactory.updateStats(ethers.parseEther('50'), false);
      const afterDecrease = await vaultFactory.getTotalLocked();

      expect(afterDecrease).to.equal(afterIncrease - ethers.parseEther('50'));
    });

    it('should reject stats update from non-owner', async () => {
      await expect(
        vaultFactory.connect(user1).updateStats(ethers.parseEther('100'), true)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple vaults from same user', async () => {
      const amount = ethers.parseEther('100');
      const duration = 7 * 24 * 60 * 60;

      const count = 10;
      for (let i = 0; i < count; i++) {
        await vaultFactory.connect(user1).createVault(
          amount,
          duration,
          84532,
          26,
          0,
          mockToken.address,
          0
        );
      }

      const userVaults = await vaultFactory.getUserVaults(user1.address);
      expect(userVaults.length).to.equal(count);
    });

    it('should handle CCTP vaults from different source chains', async () => {
      const amount = ethers.parseEther('100');
      const duration = 7 * 24 * 60 * 60;

      let tx = await vaultFactory.createVault(
        amount,
        duration,
        84532,
        26,
        0, // CCTP
        mockToken.address,
        0
      );
      await expect(tx).to.emit(vaultFactory, 'VaultCreated');

      tx = await vaultFactory.createVault(
        amount,
        duration,
        421614,
        26,
        0,
        mockToken.address,
        0
      );
      await expect(tx).to.emit(vaultFactory, 'VaultCreated');
    });
  });
});
