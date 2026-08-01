import { expect } from 'chai';
import { describe, it, beforeEach } from 'node:test';
import hre from 'hardhat';

const connection = await hre.network.connect();
const { ethers } = connection;
const { time } = connection.networkHelpers;

describe('Contract Integration Tests', () => {
  let timeLockVault;
  let vaultFactory;
  let treasury;
  let bridgeOrchestrator;
  let proofOfReserves;
  let timelock;
  let mockToken;
  let owner;
  let user1;
  let user2;

  beforeEach(async () => {
    [owner, user1, user2] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory('MockERC20');
    mockToken = await MockERC20.deploy('USDC', 'USDC', ethers.parseEther('1000000'));

    const Treasury = await ethers.getContractFactory('Treasury');
    treasury = await Treasury.deploy(mockToken.address, [user1.address, user2.address, owner.address], 2);

    const TimeLockVault = await ethers.getContractFactory('TimeLockVault');
    timeLockVault = await TimeLockVault.deploy(await treasury.getAddress());

    const VaultFactory = await ethers.getContractFactory('VaultFactory');
    vaultFactory = await VaultFactory.deploy(await timeLockVault.getAddress());

    const BridgeOrchestrator = await ethers.getContractFactory('BridgeOrchestrator');
    bridgeOrchestrator = await BridgeOrchestrator.deploy(
      await timeLockVault.getAddress(),
      await mockToken.getAddress()
    );

    const ProofOfReserves = await ethers.getContractFactory('ProofOfReserves');
    proofOfReserves = await ProofOfReserves.deploy(
      await timeLockVault.getAddress(),
      await vaultFactory.getAddress(),
      await mockToken.getAddress()
    );

    const GovernanceTimelock = await ethers.getContractFactory('GovernanceTimelock');
    timelock = await GovernanceTimelock.deploy();

    await timeLockVault.setBridgeOrchestrator(await bridgeOrchestrator.getAddress());
    await bridgeOrchestrator.configureCCTP(user1.address, owner.address);

    await mockToken.transfer(await timeLockVault.getAddress(), ethers.parseEther('500000'));
    await mockToken.transfer(user1.address, ethers.parseEther('10000'));
  });

  describe('CCTP Vault Lifecycle', () => {
    it('should create, mature, and claim a CCTP-settled vault', async () => {
      const amount = ethers.parseEther('100');
      const duration = 3 * 24 * 60 * 60;
      const unlockAt = Math.floor(Date.now() / 1000) + duration;

      const bridgeTx = await bridgeOrchestrator.receiveBridgedUSDC_CCTP(
        amount,
        84532,
        user1.address,
        unlockAt,
        26,
        duration,
        0
      );

      await expect(bridgeTx).to.emit(bridgeOrchestrator, 'BridgeCompleted');

      const userVaults = await timeLockVault.getUserVaults(user1.address);
      expect(userVaults.length).to.equal(1);

      const vaultId = userVaults[0];
      const vault = await timeLockVault.getVault(vaultId);
      expect(vault.owner).to.equal(user1.address);
      expect(vault.totalAmount).to.equal(amount);
      expect(vault.sourceChain).to.equal(84532);
      expect(vault.bridgeProtocol).to.equal(0);

      await time.increase(duration + 1);

      await expect(timeLockVault.connect(user1).claimVault(vaultId, 84532))
        .to.emit(timeLockVault, 'VaultClaimed');

      const claimedVault = await timeLockVault.getVault(vaultId);
      expect(claimedVault.status).to.equal(2);
    });

    it('should support flexible early withdrawal on a CCTP-settled vault', async () => {
      const amount = ethers.parseEther('100');
      const duration = 7 * 24 * 60 * 60;
      const unlockAt = Math.floor(Date.now() / 1000) + duration;

      const bridgeTx = await bridgeOrchestrator.receiveBridgedUSDC_CCTP(
        amount,
        84532,
        user1.address,
        unlockAt,
        26,
        duration,
        1
      );

      await expect(bridgeTx).to.emit(bridgeOrchestrator, 'BridgeCompleted');

      const vaultId = (await timeLockVault.getUserVaults(user1.address))[0];
      const withdrawAmount = ethers.parseEther('50');

      await expect(timeLockVault.connect(user1).withdrawFlexible(vaultId, withdrawAmount))
        .to.emit(timeLockVault, 'FlexibleWithdrawal');

      const updatedVault = await timeLockVault.getVault(vaultId);
      expect(updatedVault.totalAmount).to.equal(ethers.parseEther('50'));
    });
  });

  describe('Reserve Verification Integration', () => {
    it('should verify CCTP reserves across multiple source chains', async () => {
      const duration = 7 * 24 * 60 * 60;
      const unlockAt = Math.floor(Date.now() / 1000) + duration;

      await bridgeOrchestrator.receiveBridgedUSDC_CCTP(
        ethers.parseEther('100'),
        84532,
        user1.address,
        unlockAt,
        26,
        duration,
        0
      );

      await bridgeOrchestrator.receiveBridgedUSDC_CCTP(
        ethers.parseEther('50'),
        421614,
        user1.address,
        unlockAt,
        26,
        duration,
        0
      );

      expect(await proofOfReserves.verifyReserves()).to.be.true;
      expect(await proofOfReserves.getLockedByChain(84532)).to.equal(ethers.parseEther('100'));
      expect(await proofOfReserves.getLockedByChain(421614)).to.equal(ethers.parseEther('50'));
      expect(await proofOfReserves.getTotalTokenLocked(await mockToken.getAddress()))
        .to.equal(ethers.parseEther('150'));
    });
  });

  describe('Governance Integration', () => {
    it('should schedule and execute upgrade with 7-day delay', async () => {
      const MockImpl = await ethers.getContractFactory('MockImplementation');
      const impl = await MockImpl.deploy();

      const callData = impl.interface.encodeFunctionData('setValue', [42]);
      const scheduleTx = await timelock.scheduleUpgrade(await impl.getAddress(), callData);

      await expect(scheduleTx).to.emit(timelock, 'UpgradeScheduled');
      const receipt = await scheduleTx.wait();
      const event = receipt.logs
        .map((log) => {
          try {
            return timelock.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed?.name === 'UpgradeScheduled');

      const proposalId = event.args.proposalId;

      await expect(timelock.executeUpgrade(proposalId)).to.be.revertedWith('Timelock not ready');

      await time.increase(7 * 24 * 60 * 60 + 1);

      await expect(timelock.executeUpgrade(proposalId)).to.emit(timelock, 'UpgradeExecuted');
      const proposal = await timelock.getProposal(proposalId);
      expect(proposal.executed).to.be.true;
    });
  });
});
