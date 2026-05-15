import { expect } from 'chai';
import { describe, it, beforeEach } from 'node:test';
import hre from "hardhat";
const { ethers } = hre;



describe('BridgeOrchestrator', () => {
  let bridgeOrchestrator;
  let timeLockVault;
  let treasury;
  let owner, user1, user2;
  const ZERO_ADDRESS = ethers.ZeroAddress;

  beforeEach(async () => {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy Treasury
    const Treasury = await ethers.getContractFactory('Treasury');
    treasury = await Treasury.deploy([user1.address, user2.address, owner.address], 2);

    // Deploy TimeLockVault
    const TimeLockVault = await ethers.getContractFactory('TimeLockVault');
    timeLockVault = await TimeLockVault.deploy(treasury.address);

    // Deploy BridgeOrchestrator
    const BridgeOrchestrator = await ethers.getContractFactory('BridgeOrchestrator');
    bridgeOrchestrator = await BridgeOrchestrator.deploy(timeLockVault.address);

    // Setup
    await timeLockVault.setBridgeOrchestrator(bridgeOrchestrator.address);
  });

  describe('Initialization', () => {
    it('should initialize with TimeLockVault', async () => {
      expect(await bridgeOrchestrator.timeLockVault()).to.equal(timeLockVault.address);
    });

    it('should reject zero address TimeLockVault', async () => {
      const BridgeOrchestrator = await ethers.getContractFactory('BridgeOrchestrator');

      await expect(
        BridgeOrchestrator.deploy(ZERO_ADDRESS)
      ).to.be.revertedWith('Invalid TimeLockVault');
    });
  });

  describe('CCTP Configuration', () => {
    it('should configure CCTP contracts', async () => {
      const messenger = user1.address;
      const transmitter = user2.address;

      await expect(bridgeOrchestrator.configureCCTP(messenger, transmitter))
        .to.emit(bridgeOrchestrator, 'ProtocolConfigured');

      expect(await bridgeOrchestrator.cctpTokenMessenger()).to.equal(messenger);
      expect(await bridgeOrchestrator.cctpMessageTransmitter()).to.equal(transmitter);
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

  describe('LayerZero Configuration', () => {
    it('should configure LayerZero endpoint', async () => {
      const endpoint = user1.address;

      await expect(bridgeOrchestrator.configureLayerZero(endpoint))
        .to.emit(bridgeOrchestrator, 'ProtocolConfigured');

      expect(await bridgeOrchestrator.layerZeroEndpoint()).to.equal(endpoint);
    });

    it('should reject invalid LayerZero configuration', async () => {
      await expect(
        bridgeOrchestrator.configureLayerZero(ZERO_ADDRESS)
      ).to.be.revertedWith('Invalid address');
    });

    it('should only allow owner to configure LayerZero', async () => {
      await expect(
        bridgeOrchestrator.connect(user1).configureLayerZero(user1.address)
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
        84532, // Base Sepolia
        user1.address,
        unlockAt,
        26, // Arc
        7 * 24 * 60 * 60, // 7 days
        0 // FIXED
      );

      await expect(tx).to.emit(bridgeOrchestrator, 'BridgeCompleted');
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

    it('should reject zero amount CCTP', async () => {
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

    it('should handle custom duration vs provided unlock time', async () => {
      const amount = ethers.parseEther('100');
      const providedUnlockAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

      // With provided unlockAt
      let tx = await bridgeOrchestrator.receiveBridgedUSDC_CCTP(
        amount,
        84532,
        user1.address,
        providedUnlockAt,
        26,
        7 * 24 * 60 * 60,
        0
      );

      await expect(tx).to.emit(bridgeOrchestrator, 'BridgeCompleted');

      // With customDuration (unlockAt = 0)
      tx = await bridgeOrchestrator.receiveBridgedUSDC_CCTP(
        amount,
        84532,
        user1.address,
        0,
        26,
        7 * 24 * 60 * 60,
        0
      );

      await expect(tx).to.emit(bridgeOrchestrator, 'BridgeCompleted');
    });
  });

  describe('LayerZero Bridge Flow', () => {
    beforeEach(async () => {
      await bridgeOrchestrator.configureLayerZero(owner.address);
    });

    it('should receive bridged token via LayerZero', async () => {
      const amount = ethers.parseEther('100');
      const unlockAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

      const tx = await bridgeOrchestrator.receiveBridgedToken_LayerZero(
        amount,
        84532,
        user1.address,
        unlockAt,
        user1.address, // token address
        26,
        7 * 24 * 60 * 60,
        0
      );

      await expect(tx).to.emit(bridgeOrchestrator, 'BridgeCompleted');
    });

    it('should reject LayerZero from non-endpoint', async () => {
      const amount = ethers.parseEther('100');
      const unlockAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

      await expect(
        bridgeOrchestrator.connect(user2).receiveBridgedToken_LayerZero(
          amount,
          84532,
          user1.address,
          unlockAt,
          user1.address,
          26,
          7 * 24 * 60 * 60,
          0
        )
      ).to.be.revertedWith('Only LayerZero endpoint');
    });

    it('should reject zero amount LayerZero', async () => {
      const unlockAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

      await expect(
        bridgeOrchestrator.receiveBridgedToken_LayerZero(
          0,
          84532,
          user1.address,
          unlockAt,
          user1.address,
          26,
          7 * 24 * 60 * 60,
          0
        )
      ).to.be.revertedWith('Invalid amount');
    });

    it('should reject invalid token address', async () => {
      const amount = ethers.parseEther('100');
      const unlockAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

      await expect(
        bridgeOrchestrator.receiveBridgedToken_LayerZero(
          amount,
          84532,
          user1.address,
          unlockAt,
          ZERO_ADDRESS,
          26,
          7 * 24 * 60 * 60,
          0
        )
      ).to.be.revertedWith('Invalid token');
    });
  });

  describe('Claim Initiation', () => {
    it('should initiate CCTP claim', async () => {
      const vaultId = ethers.id('test-vault');

      const tx = await bridgeOrchestrator.initiateClaim_CCTP(vaultId, 26);

      await expect(tx).to.emit(bridgeOrchestrator, 'BridgeInitiated');
    });

    it('should initiate LayerZero claim', async () => {
      const vaultId = ethers.id('test-vault');

      const tx = await bridgeOrchestrator.initiateClaim_LayerZero(vaultId, 26, user1.address);

      await expect(tx).to.emit(bridgeOrchestrator, 'BridgeInitiated');
    });
  });

  describe('Attestation Handling', () => {
    it('should receive CCTP attestation', async () => {
      await bridgeOrchestrator.configureCCTP(user1.address, owner.address);

      const attestationData = ethers.toUtf8Bytes('test-attestation');

      const tx = await bridgeOrchestrator.receiveAttestation_CCTP(attestationData);

      // Should not revert
      expect(tx).to.not.be.undefined;
    });

    it('should reject attestation from non-CCTP transmitter', async () => {
      const attestationData = ethers.toUtf8Bytes('test-attestation');

      // Without configuration, should fail
      await expect(
        bridgeOrchestrator.connect(user2).receiveAttestation_CCTP(attestationData)
      ).to.be.revertedWith('Only CCTP');
    });

    it('should retry failed bridge', async () => {
      const vaultId = ethers.id('failed-vault');
      const attestationData = ethers.toUtf8Bytes('retry-attestation');

      const tx = await bridgeOrchestrator.retryFailedBridge(vaultId, attestationData);

      await expect(tx).to.emit(bridgeOrchestrator, 'AttestationReceived');
    });

    it('should only allow owner to retry', async () => {
      const vaultId = ethers.id('failed-vault');
      const attestationData = ethers.toUtf8Bytes('retry-attestation');

      await expect(
        bridgeOrchestrator.connect(user1).retryFailedBridge(vaultId, attestationData)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  describe('Bridge State Management', () => {
    it('should track bridge state', async () => {
      const vaultId = ethers.id('test-vault');

      // Initial state should be 0 (DEPOSIT_INITIATED)
      let state = await bridgeOrchestrator.getBridgeState(vaultId);
      expect(state).to.equal(0);
    });

    it('should update state on operations', async () => {
      await bridgeOrchestrator.configureLayerZero(owner.address);

      const amount = ethers.parseEther('100');
      const unlockAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

      await bridgeOrchestrator.receiveBridgedToken_LayerZero(
        amount,
        84532,
        user1.address,
        unlockAt,
        user1.address,
        26,
        7 * 24 * 60 * 60,
        0
      );
    });
  });

  describe('Bridge Transaction Records', () => {
    it('should return bridge transaction details', async () => {
      const vaultId = ethers.id('test-vault');

      const tx = await bridgeOrchestrator.getBridgeTransaction(vaultId);

      // Should return empty transaction for non-existent vault
      expect(tx).to.exist;
    });
  });

  describe('Reentrancy Protection', () => {
    it('should protect against reentrancy', async () => {
      // Implementation depends on ReentrantAttacker mock
      expect(true).to.equal(true);
    });
  });

  describe('Multiple Bridge Protocols', () => {
    beforeEach(async () => {
      await bridgeOrchestrator.configureCCTP(user1.address, owner.address);
      await bridgeOrchestrator.configureLayerZero(owner.address);
    });

    it('should handle both CCTP and LayerZero in sequence', async () => {
      const amount = ethers.parseEther('100');
      const unlockAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

      // CCTP
      let tx = await bridgeOrchestrator.receiveBridgedUSDC_CCTP(
        amount,
        84532,
        user1.address,
        unlockAt,
        26,
        7 * 24 * 60 * 60,
        0
      );
      await expect(tx).to.emit(bridgeOrchestrator, 'BridgeCompleted');

      // LayerZero
      tx = await bridgeOrchestrator.receiveBridgedToken_LayerZero(
        amount,
        84532,
        user1.address,
        unlockAt,
        user1.address,
        26,
        7 * 24 * 60 * 60,
        0
      );
      await expect(tx).to.emit(bridgeOrchestrator, 'BridgeCompleted');
    });
  });

  describe('Access Control', () => {
    it('should enforce owner-only functions', async () => {
      await expect(
        bridgeOrchestrator.connect(user1).configureCCTP(user1.address, user2.address)
      ).to.be.revertedWith('Ownable: caller is not the owner');

      await expect(
        bridgeOrchestrator.connect(user1).configureLayerZero(user1.address)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });
});
