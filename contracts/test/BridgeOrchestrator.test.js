import { expect } from 'chai';
import { describe, it, beforeEach } from 'node:test';
import hre from 'hardhat';

const { ethers } = await hre.network.connect();

describe('BridgeOrchestrator', () => {
  let bridgeOrchestrator;
  let timeLockVault;
  let mockToken;
  let owner;
  let user1;
  let user2;

  const ZERO_ADDRESS = ethers.ZeroAddress;

  beforeEach(async () => {
    [owner, user1, user2] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory('MockERC20');
    mockToken = await MockERC20.deploy('USDC', 'USDC', ethers.parseEther('1000000'));

    const Treasury = await ethers.getContractFactory('Treasury');
    const treasury = await Treasury.deploy(mockToken.address, [user1.address, user2.address, owner.address], 2);

    const TimeLockVault = await ethers.getContractFactory('TimeLockVault');
    timeLockVault = await TimeLockVault.deploy(await treasury.getAddress());

    const BridgeOrchestrator = await ethers.getContractFactory('BridgeOrchestrator');
    bridgeOrchestrator = await BridgeOrchestrator.deploy(
      await timeLockVault.getAddress(),
      await mockToken.getAddress()
    );

    await timeLockVault.setBridgeOrchestrator(await bridgeOrchestrator.getAddress());
    await mockToken.transfer(await timeLockVault.getAddress(), ethers.parseEther('500000'));
  });

  describe('Initialization', () => {
    it('should initialize with TimeLockVault and USDC token', async () => {
      expect(await bridgeOrchestrator.timeLockVault()).to.equal(await timeLockVault.getAddress());
      expect(await bridgeOrchestrator.usdcToken()).to.equal(await mockToken.getAddress());
    });

    it('should reject zero address constructor values', async () => {
      const BridgeOrchestrator = await ethers.getContractFactory('BridgeOrchestrator');

      await expect(
        BridgeOrchestrator.deploy(ZERO_ADDRESS, await mockToken.getAddress())
      ).to.be.revertedWith('Invalid TimeLockVault');

      await expect(
        BridgeOrchestrator.deploy(await timeLockVault.getAddress(), ZERO_ADDRESS)
      ).to.be.revertedWith('Invalid USDC');
    });
  });

  describe('CCTP Configuration', () => {
    it('should configure CCTP contracts', async () => {
      await expect(bridgeOrchestrator.configureCCTP(user1.address, user2.address))
        .to.emit(bridgeOrchestrator, 'CCTPConfigured')
        .withArgs(user1.address, user2.address);

      expect(await bridgeOrchestrator.cctpTokenMessenger()).to.equal(user1.address);
      expect(await bridgeOrchestrator.cctpMessageTransmitter()).to.equal(user2.address);
    });

    it('should reject invalid CCTP configuration', async () => {
      await expect(
        bridgeOrchestrator.configureCCTP(ZERO_ADDRESS, user2.address)
      ).to.be.revertedWith('Invalid addresses');

      await expect(
        bridgeOrchestrator.configureCCTP(user1.address, ZERO_ADDRESS)
      ).to.be.revertedWith('Invalid addresses');
    });

    it('should only allow owner to configure CCTP', async () => {
      await expect(
        bridgeOrchestrator.connect(user1).configureCCTP(user1.address, user2.address)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  describe('CCTP Bridge Flow', () => {
    beforeEach(async () => {
      await bridgeOrchestrator.configureCCTP(user1.address, owner.address);
    });

    it('should receive bridged USDC via CCTP', async () => {
      const amount = ethers.parseEther('100');
      const unlockAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

      const tx = await bridgeOrchestrator.receiveBridgedUSDC_CCTP(
        amount,
        84532,
        user1.address,
        unlockAt,
        26,
        7 * 24 * 60 * 60,
        0
      );

      await expect(tx).to.emit(bridgeOrchestrator, 'BridgeCompleted');
    });

    it('should receive additional bridged USDC via CCTP', async () => {
      const amount = ethers.parseEther('100');
      const unlockAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

      const receipt = await (await bridgeOrchestrator.receiveBridgedUSDC_CCTP(
        amount,
        84532,
        user1.address,
        unlockAt,
        26,
        7 * 24 * 60 * 60,
        0
      )).wait();

      const event = receipt.logs
        .map((log) => {
          try {
            return bridgeOrchestrator.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed?.name === 'BridgeCompleted');

      const vaultId = event.args.vaultId;

      await expect(
        bridgeOrchestrator.receiveAdditionalBridgedUSDC_CCTP(
          vaultId,
          ethers.parseEther('25'),
          84532,
          user1.address
        )
      ).to.emit(bridgeOrchestrator, 'BridgeCompleted');
    });

    it('should reject CCTP receive from non-transmitter', async () => {
      const amount = ethers.parseEther('100');
      const unlockAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

      await expect(
        bridgeOrchestrator.connect(user2).receiveBridgedUSDC_CCTP(
          amount,
          84532,
          user1.address,
          unlockAt,
          26,
          7 * 24 * 60 * 60,
          0
        )
      ).to.be.revertedWith('Only CCTP transmitter');
    });

    it('should reject zero amount CCTP deposits', async () => {
      const unlockAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

      await expect(
        bridgeOrchestrator.receiveBridgedUSDC_CCTP(
          0,
          84532,
          user1.address,
          unlockAt,
          26,
          7 * 24 * 60 * 60,
          0
        )
      ).to.be.revertedWith('Invalid amount');
    });
  });

  describe('Claim Initiation', () => {
    it('should initiate CCTP claim from TimeLockVault only', async () => {
      const vaultId = ethers.id('test-vault');

      await expect(
        bridgeOrchestrator.initiateClaim_CCTP(vaultId, 26)
      ).to.be.revertedWith('Only TimeLockVault');
    });
  });

  describe('Attestation Handling', () => {
    beforeEach(async () => {
      await bridgeOrchestrator.configureCCTP(user1.address, owner.address);
    });

    it('should receive CCTP attestation from configured transmitter', async () => {
      const tx = await bridgeOrchestrator.receiveAttestation_CCTP(
        ethers.toUtf8Bytes('test-attestation')
      );

      expect(tx).to.not.be.undefined;
    });

    it('should reject attestation from non-CCTP transmitter', async () => {
      await expect(
        bridgeOrchestrator.connect(user2).receiveAttestation_CCTP(
          ethers.toUtf8Bytes('test-attestation')
        )
      ).to.be.revertedWith('Only CCTP');
    });

    it('should retry failed bridge', async () => {
      const vaultId = ethers.id('failed-vault');
      const attestationData = ethers.toUtf8Bytes('retry-attestation');

      await expect(
        bridgeOrchestrator.retryFailedBridge(vaultId, attestationData)
      ).to.emit(bridgeOrchestrator, 'AttestationReceived');
    });
  });

  describe('Bridge State Management', () => {
    it('should return the initial bridge state for an unknown vault', async () => {
      const vaultId = ethers.id('test-vault');
      expect(await bridgeOrchestrator.getBridgeState(vaultId)).to.equal(0);
    });

    it('should return an empty transaction for an unknown vault', async () => {
      const vaultId = ethers.id('test-vault');
      const tx = await bridgeOrchestrator.getBridgeTransaction(vaultId);
      expect(tx).to.exist;
    });
  });
});
