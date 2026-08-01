import { expect } from 'chai';
import { describe, it, beforeEach } from 'node:test';
import hre from "hardhat";
const connection = await hre.network.connect();
const { ethers } = connection;
const { time } = connection.networkHelpers;

describe('GovernanceTimelock', () => {
  let timelock;
  let mockImpl;
  let owner, user1;
  const TIMELOCK_DELAY = 7 * 24 * 60 * 60; // 7 days

  beforeEach(async () => {
    [owner, user1] = await ethers.getSigners();

    // Deploy GovernanceTimelock
    const GovernanceTimelock = await ethers.getContractFactory('GovernanceTimelock');
    timelock = await GovernanceTimelock.deploy();

    // Deploy mock implementation
    const MockImpl = await ethers.getContractFactory('MockImplementation');
    mockImpl = await MockImpl.deploy();
  });

  describe('Initialization', () => {
    it('should initialize with zero proposals', async () => {
      const counter = await timelock.proposalCounter();
      expect(counter).to.equal(0);
    });

    it('should have correct timelock delay', async () => {
      const delay = await timelock.TIMELOCK_DELAY();
      expect(delay).to.equal(TIMELOCK_DELAY);
    });
  });

  describe('Schedule Upgrade', () => {
    it('should schedule upgrade with 7-day delay', async () => {
      const callData = mockImpl.interface.encodeFunctionData('setValue', [42]);

      const tx = await timelock.scheduleUpgrade(mockImpl.address, callData);

      await expect(tx).to.emit(timelock, 'UpgradeScheduled');

      const block = await ethers.provider.getBlock('latest');
      const expectedExecTime = block.timestamp + TIMELOCK_DELAY;

      const events = await timelock.queryFilter('UpgradeScheduled');
      expect(events[0].args.proposalId).to.equal(0);
      expect(events[0].args.executionTime).to.equal(expectedExecTime);
    });

    it('should reject zero address implementation', async () => {
      const callData = ethers.toUtf8Bytes('test');

      await expect(
        timelock.scheduleUpgrade(ethers.ZeroAddress, callData)
      ).to.be.revertedWith('Invalid implementation');
    });

    it('should increment proposal counter', async () => {
      const callData = mockImpl.interface.encodeFunctionData('setValue', [42]);

      expect(await timelock.proposalCounter()).to.equal(0);

      await timelock.scheduleUpgrade(mockImpl.address, callData);
      expect(await timelock.proposalCounter()).to.equal(1);

      await timelock.scheduleUpgrade(mockImpl.address, callData);
      expect(await timelock.proposalCounter()).to.equal(2);
    });

    it('should store proposal data correctly', async () => {
      const callData = mockImpl.interface.encodeFunctionData('setValue', [42]);

      const tx = await timelock.scheduleUpgrade(mockImpl.address, callData);
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === 'UpgradeScheduled');
      const proposalId = event.args.proposalId;

      const proposal = await timelock.getProposal(proposalId);
      expect(proposal.newImplementation).to.equal(mockImpl.address);
      expect(proposal.executed).to.equal(false);
      expect(proposal.cancelled).to.equal(false);
    });

    it('should only allow owner to schedule', async () => {
      const callData = mockImpl.interface.encodeFunctionData('setValue', [42]);

      await expect(
        timelock.connect(user1).scheduleUpgrade(mockImpl.address, callData)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  describe('Execute Upgrade', () => {
    let proposalId, callData;

    beforeEach(async () => {
      callData = mockImpl.interface.encodeFunctionData('setValue', [42]);
      const tx = await timelock.scheduleUpgrade(mockImpl.address, callData);
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === 'UpgradeScheduled');
      proposalId = event.args.proposalId;
    });

    it('should reject execution before timelock expires', async () => {
      await expect(
        timelock.executeUpgrade(proposalId)
      ).to.be.revertedWith('Timelock not ready');
    });

    it('should execute upgrade after timelock expires', async () => {
      // Advance time past timelock delay
      await time.increase(TIMELOCK_DELAY + 1);

      const tx = await timelock.executeUpgrade(proposalId);

      await expect(tx).to.emit(timelock, 'UpgradeExecuted');

      const proposal = await timelock.getProposal(proposalId);
      expect(proposal.executed).to.equal(true);
    });

    it('should reject execution of already executed proposal', async () => {
      await time.increase(TIMELOCK_DELAY + 1);

      await timelock.executeUpgrade(proposalId);

      await expect(
        timelock.executeUpgrade(proposalId)
      ).to.be.revertedWith('Already executed');
    });

    it('should reject execution of cancelled proposal', async () => {
      await timelock.cancelUpgrade(proposalId);
      await time.increase(TIMELOCK_DELAY + 1);

      await expect(
        timelock.executeUpgrade(proposalId)
      ).to.be.revertedWith('Proposal cancelled');
    });

    it('should only allow owner to execute', async () => {
      await time.increase(TIMELOCK_DELAY + 1);

      await expect(
        timelock.connect(user1).executeUpgrade(proposalId)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should protect against reentrancy on execution', async () => {
      await time.increase(TIMELOCK_DELAY + 1);

      const tx = await timelock.executeUpgrade(proposalId);
      await expect(tx).to.emit(timelock, 'UpgradeExecuted');
    });
  });

  describe('Cancel Upgrade', () => {
    let proposalId, callData;

    beforeEach(async () => {
      callData = mockImpl.interface.encodeFunctionData('setValue', [42]);
      const tx = await timelock.scheduleUpgrade(mockImpl.address, callData);
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === 'UpgradeScheduled');
      proposalId = event.args.proposalId;
    });

    it('should cancel scheduled upgrade', async () => {
      const tx = await timelock.cancelUpgrade(proposalId);

      await expect(tx).to.emit(timelock, 'UpgradeCancelled');

      const proposal = await timelock.getProposal(proposalId);
      expect(proposal.cancelled).to.equal(true);
    });

    it('should reject cancellation of already executed proposal', async () => {
      await time.increase(TIMELOCK_DELAY + 1);
      await timelock.executeUpgrade(proposalId);

      await expect(
        timelock.cancelUpgrade(proposalId)
      ).to.be.revertedWith('Already executed');
    });

    it('should reject double cancellation', async () => {
      await timelock.cancelUpgrade(proposalId);

      await expect(
        timelock.cancelUpgrade(proposalId)
      ).to.be.revertedWith('Already cancelled');
    });

    it('should only allow owner to cancel', async () => {
      await expect(
        timelock.connect(user1).cancelUpgrade(proposalId)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  describe('Proposal Queries', () => {
    let proposalId, callData;

    beforeEach(async () => {
      callData = mockImpl.interface.encodeFunctionData('setValue', [42]);
      const tx = await timelock.scheduleUpgrade(mockImpl.address, callData);
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === 'UpgradeScheduled');
      proposalId = event.args.proposalId;
    });

    it('should return proposal details', async () => {
      const proposal = await timelock.getProposal(proposalId);

      expect(proposal.newImplementation).to.equal(mockImpl.address);
      expect(proposal.executed).to.equal(false);
      expect(proposal.cancelled).to.equal(false);
      expect(proposal.execTime).to.be.greaterThan(0);
    });

    it('should check if proposal is ready', async () => {
      let isReady = await timelock.isReady(proposalId);
      expect(isReady).to.equal(false);

      // Advance time
      await time.increase(TIMELOCK_DELAY + 1);

      isReady = await timelock.isReady(proposalId);
      expect(isReady).to.equal(true);
    });
  });

  describe('7-Day Delay Enforcement', () => {
    it('should enforce minimum 7-day delay', async () => {
      const callData = mockImpl.interface.encodeFunctionData('setValue', [42]);
      const tx = await timelock.scheduleUpgrade(mockImpl.address, callData);
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === 'UpgradeScheduled');
      const proposalId = event.args.proposalId;

      // Try to execute at 6 days 23 hours 59 minutes
      await time.increase(TIMELOCK_DELAY - 1);

      await expect(
        timelock.executeUpgrade(proposalId)
      ).to.be.revertedWith('Timelock not ready');

      // Advance 1 more second to reach 7 days
      await time.increase(2);

      // Now should succeed
      const executeTx = await timelock.executeUpgrade(proposalId);
      await expect(executeTx).to.emit(timelock, 'UpgradeExecuted');
    });
  });

  describe('Multiple Proposals', () => {
    it('should handle multiple concurrent proposals', async () => {
      const callData1 = mockImpl.interface.encodeFunctionData('setValue', [42]);
      const callData2 = mockImpl.interface.encodeFunctionData('setValue', [100]);

      const tx1 = await timelock.scheduleUpgrade(mockImpl.address, callData1);
      const receipt1 = await tx1.wait();
      const event1 = receipt1.events.find(e => e.event === 'UpgradeScheduled');
      const proposalId1 = event1.args.proposalId;

      const tx2 = await timelock.scheduleUpgrade(mockImpl.address, callData2);
      const receipt2 = await tx2.wait();
      const event2 = receipt2.events.find(e => e.event === 'UpgradeScheduled');
      const proposalId2 = event2.args.proposalId;

      expect(proposalId2).to.equal(proposalId1 + 1n);

      const prop1 = await timelock.getProposal(proposalId1);
      const prop2 = await timelock.getProposal(proposalId2);

      expect(prop1.newImplementation).to.equal(mockImpl.address);
      expect(prop2.newImplementation).to.equal(mockImpl.address);
    });

    it('should execute proposals independently', async () => {
      const callData1 = mockImpl.interface.encodeFunctionData('setValue', [42]);
      const callData2 = mockImpl.interface.encodeFunctionData('setValue', [100]);

      const tx1 = await timelock.scheduleUpgrade(mockImpl.address, callData1);
      const receipt1 = await tx1.wait();
      const proposalId1 = receipt1.events.find(e => e.event === 'UpgradeScheduled').args.proposalId;

      const tx2 = await timelock.scheduleUpgrade(mockImpl.address, callData2);
      const receipt2 = await tx2.wait();
      const proposalId2 = receipt2.events.find(e => e.event === 'UpgradeScheduled').args.proposalId;

      await time.increase(TIMELOCK_DELAY + 1);

      // Execute first proposal
      await timelock.executeUpgrade(proposalId1);
      const prop1 = await timelock.getProposal(proposalId1);
      expect(prop1.executed).to.equal(true);

      // Second proposal still pending
      const prop2 = await timelock.getProposal(proposalId2);
      expect(prop2.executed).to.equal(false);

      // Can still execute second
      await timelock.executeUpgrade(proposalId2);
      const prop2After = await timelock.getProposal(proposalId2);
      expect(prop2After.executed).to.equal(true);
    });
  });

  describe('Cancel and Reschedule', () => {
    it('should allow rescheduling after cancellation', async () => {
      const callData = mockImpl.interface.encodeFunctionData('setValue', [42]);

      const tx1 = await timelock.scheduleUpgrade(mockImpl.address, callData);
      const receipt1 = await tx1.wait();
      const proposalId1 = receipt1.events.find(e => e.event === 'UpgradeScheduled').args.proposalId;

      // Cancel first proposal
      await timelock.cancelUpgrade(proposalId1);

      // Schedule new proposal
      const tx2 = await timelock.scheduleUpgrade(mockImpl.address, callData);
      const receipt2 = await tx2.wait();
      const proposalId2 = receipt2.events.find(e => e.event === 'UpgradeScheduled').args.proposalId;

      expect(proposalId2).to.equal(proposalId1 + 1n);

      const prop1 = await timelock.getProposal(proposalId1);
      expect(prop1.cancelled).to.equal(true);

      const prop2 = await timelock.getProposal(proposalId2);
      expect(prop2.cancelled).to.equal(false);
    });
  });

  describe('Access Control', () => {
    it('should enforce owner-only access', async () => {
      const callData = mockImpl.interface.encodeFunctionData('setValue', [42]);

      await expect(
        timelock.connect(user1).scheduleUpgrade(mockImpl.address, callData)
      ).to.be.revertedWith('Ownable: caller is not the owner');

      // Schedule proposal as owner
      const tx = await timelock.scheduleUpgrade(mockImpl.address, callData);
      const receipt = await tx.wait();
      const proposalId = receipt.events.find(e => e.event === 'UpgradeScheduled').args.proposalId;

      await time.increase(TIMELOCK_DELAY + 1);

      await expect(
        timelock.connect(user1).executeUpgrade(proposalId)
      ).to.be.revertedWith('Ownable: caller is not the owner');

      await expect(
        timelock.connect(user1).cancelUpgrade(proposalId)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });
});
