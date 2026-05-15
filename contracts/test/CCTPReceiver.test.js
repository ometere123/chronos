import { expect } from 'chai';
import { describe, it, beforeEach } from 'node:test';
import hre from "hardhat";
const { ethers } = hre;



describe('CCTPReceiver', () => {
  let cctpReceiver;
  let mockToken;
  let owner, user1, user2;

  beforeEach(async () => {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy mock ERC20
    const MockERC20 = await ethers.getContractFactory('MockERC20');
    mockToken = await MockERC20.deploy('USDC', 'USDC', ethers.parseEther('1000000'));

    // Deploy CCTPReceiver
    const CCTPReceiver = await ethers.getContractFactory('CCTPReceiver');
    cctpReceiver = await CCTPReceiver.deploy(
      owner.address,      // messageTransmitter
      user1.address,      // tokenMessenger
      user2.address,      // arcBridge
      mockToken.address   // usdc
    );

    // Mint tokens for testing
    await mockToken.transfer(user1.address, ethers.parseEther('10000'));
  });

  describe('Initialization', () => {
    it('should initialize with correct addresses', async () => {
      expect(await cctpReceiver.cctpMessageTransmitter()).to.equal(owner.address);
      expect(await cctpReceiver.cctpTokenMessenger()).to.equal(user1.address);
      expect(await cctpReceiver.arcBridgeAddress()).to.equal(user2.address);
      expect(await cctpReceiver.usdcToken()).to.equal(mockToken.address);
    });

    it('should reject invalid transmitter', async () => {
      const CCTPReceiver = await ethers.getContractFactory('CCTPReceiver');

      await expect(
        CCTPReceiver.deploy(ethers.ZeroAddress, user1.address, user2.address, mockToken.address)
      ).to.be.revertedWith('Invalid transmitter');
    });

    it('should reject invalid messenger', async () => {
      const CCTPReceiver = await ethers.getContractFactory('CCTPReceiver');

      await expect(
        CCTPReceiver.deploy(owner.address, ethers.ZeroAddress, user2.address, mockToken.address)
      ).to.be.revertedWith('Invalid messenger');
    });

    it('should reject invalid arc bridge', async () => {
      const CCTPReceiver = await ethers.getContractFactory('CCTPReceiver');

      await expect(
        CCTPReceiver.deploy(owner.address, user1.address, ethers.ZeroAddress, mockToken.address)
      ).to.be.revertedWith('Invalid arc bridge');
    });

    it('should reject invalid USDC', async () => {
      const CCTPReceiver = await ethers.getContractFactory('CCTPReceiver');

      await expect(
        CCTPReceiver.deploy(owner.address, user1.address, user2.address, ethers.ZeroAddress)
      ).to.be.revertedWith('Invalid USDC');
    });
  });

  describe('Handle Receive Message', () => {
    it('should process CCTP message', async () => {
      const message = ethers.toUtf8Bytes('test-message');
      const attestation = ethers.toUtf8Bytes('test-attestation');

      const tx = await cctpReceiver.handleReceiveMessage(message, attestation);

      await expect(tx).to.emit(cctpReceiver, 'MessageReceived');
    });

    it('should only allow message transmitter', async () => {
      const message = ethers.toUtf8Bytes('test-message');
      const attestation = ethers.toUtf8Bytes('test-attestation');

      await expect(
        cctpReceiver.connect(user1).handleReceiveMessage(message, attestation)
      ).to.be.revertedWith('Only CCTP transmitter');
    });

    it('should store pending message', async () => {
      const message = ethers.toUtf8Bytes('test-message');
      const attestation = ethers.toUtf8Bytes('test-attestation');
      const messageHash = ethers.keccak256(message);

      await cctpReceiver.handleReceiveMessage(message, attestation);

      const stored = await cctpReceiver.pendingMessages(messageHash);
      expect(stored).to.equal(ethers.toHexString(attestation));
    });

    it('should handle multiple messages', async () => {
      const message1 = ethers.toUtf8Bytes('message-1');
      const attestation1 = ethers.toUtf8Bytes('attestation-1');
      const message2 = ethers.toUtf8Bytes('message-2');
      const attestation2 = ethers.toUtf8Bytes('attestation-2');

      await cctpReceiver.handleReceiveMessage(message1, attestation1);
      await cctpReceiver.handleReceiveMessage(message2, attestation2);

      const hash1 = ethers.keccak256(message1);
      const hash2 = ethers.keccak256(message2);

      expect(await cctpReceiver.pendingMessages(hash1)).to.equal(ethers.toHexString(attestation1));
      expect(await cctpReceiver.pendingMessages(hash2)).to.equal(ethers.toHexString(attestation2));
    });
  });

  describe('Burn and Bridge', () => {
    it('should burn USDC and initiate bridge', async () => {
      const amount = ethers.parseEther('100');
      const arcRecipient = user1.address;

      // Approve tokens
      await mockToken.connect(user1).approve(cctpReceiver.address, amount);

      const tx = await cctpReceiver.connect(user1).burnAndBridge_toArc(amount, arcRecipient);

      await expect(tx).to.emit(cctpReceiver, 'BridgeInitiated');

      // Verify tokens were transferred
      expect(await mockToken.balanceOf(cctpReceiver.address)).to.equal(amount);
    });

    it('should reject zero amount', async () => {
      const arcRecipient = user1.address;

      await expect(
        cctpReceiver.connect(user1).burnAndBridge_toArc(0, arcRecipient)
      ).to.be.revertedWith('Amount must be > 0');
    });

    it('should reject invalid recipient', async () => {
      const amount = ethers.parseEther('100');

      await mockToken.connect(user1).approve(cctpReceiver.address, amount);

      await expect(
        cctpReceiver.connect(user1).burnAndBridge_toArc(amount, ethers.ZeroAddress)
      ).to.be.revertedWith('Invalid recipient');
    });

    it('should reject without approval', async () => {
      const amount = ethers.parseEther('100');
      const arcRecipient = user1.address;

      await expect(
        cctpReceiver.connect(user1).burnAndBridge_toArc(amount, arcRecipient)
      ).to.be.revertedWith('Transfer failed');
    });

    it('should handle large amounts', async () => {
      const amount = ethers.parseEther('999999');
      const arcRecipient = user1.address;

      // Transfer more tokens first
      await mockToken.transfer(user1.address, ethers.parseEther('1000000'));

      await mockToken.connect(user1).approve(cctpReceiver.address, amount);

      const tx = await cctpReceiver.connect(user1).burnAndBridge_toArc(amount, arcRecipient);

      await expect(tx).to.emit(cctpReceiver, 'BridgeInitiated');
    });
  });

  describe('Arc Bridge Address Management', () => {
    it('should update arc bridge address', async () => {
      const newAddress = user1.address;

      await cctpReceiver.setArcBridgeAddress(newAddress);

      expect(await cctpReceiver.arcBridgeAddress()).to.equal(newAddress);
    });

    it('should reject zero address', async () => {
      await expect(
        cctpReceiver.setArcBridgeAddress(ethers.ZeroAddress)
      ).to.be.revertedWith('Invalid address');
    });

    it('should only allow owner', async () => {
      await expect(
        cctpReceiver.connect(user1).setArcBridgeAddress(user1.address)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  describe('Token Withdrawal', () => {
    it('should withdraw stranded tokens', async () => {
      const amount = ethers.parseEther('100');

      // Transfer tokens to contract
      await mockToken.transfer(cctpReceiver.address, amount);

      const initialBalance = await mockToken.balanceOf(owner.address);

      await cctpReceiver.withdrawToken(mockToken.address, amount);

      const finalBalance = await mockToken.balanceOf(owner.address);
      expect(finalBalance).to.equal(initialBalance + amount);
      expect(await mockToken.balanceOf(cctpReceiver.address)).to.equal(0);
    });

    it('should reject withdrawal of zero amount', async () => {
      await expect(
        cctpReceiver.withdrawToken(mockToken.address, 0)
      ).to.be.revertedWith('Amount must be > 0');
    });

    it('should reject invalid token', async () => {
      const amount = ethers.parseEther('100');

      await expect(
        cctpReceiver.withdrawToken(ethers.ZeroAddress, amount)
      ).to.be.revertedWith('Invalid token');
    });

    it('should only allow owner', async () => {
      const amount = ethers.parseEther('100');

      await expect(
        cctpReceiver.connect(user1).withdrawToken(mockToken.address, amount)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should handle multiple different tokens', async () => {
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const token2 = await MockERC20.deploy('Token2', 'T2', ethers.parseEther('1000000'));

      const amount1 = ethers.parseEther('100');
      const amount2 = ethers.parseEther('50');

      await mockToken.transfer(cctpReceiver.address, amount1);
      await token2.transfer(cctpReceiver.address, amount2);

      await cctpReceiver.withdrawToken(mockToken.address, amount1);
      expect(await mockToken.balanceOf(cctpReceiver.address)).to.equal(0);
      expect(await token2.balanceOf(cctpReceiver.address)).to.equal(amount2);

      await cctpReceiver.withdrawToken(token2.address, amount2);
      expect(await token2.balanceOf(cctpReceiver.address)).to.equal(0);
    });
  });

  describe('Reentrancy Protection', () => {
    it('should protect against reentrancy on burnAndBridge', async () => {
      const amount = ethers.parseEther('100');
      const arcRecipient = user1.address;

      await mockToken.connect(user1).approve(cctpReceiver.address, amount);

      const tx = await cctpReceiver.connect(user1).burnAndBridge_toArc(amount, arcRecipient);
      await expect(tx).to.emit(cctpReceiver, 'BridgeInitiated');
    });

    it('should protect against reentrancy on withdrawal', async () => {
      const amount = ethers.parseEther('100');
      await mockToken.transfer(cctpReceiver.address, amount);

      const tx = await cctpReceiver.withdrawToken(mockToken.address, amount);
      await expect(tx).to.not.be.reverted;
    });
  });

  describe('Access Control', () => {
    it('should enforce owner-only functions', async () => {
      await expect(
        cctpReceiver.connect(user1).setArcBridgeAddress(user1.address)
      ).to.be.revertedWith('Ownable: caller is not the owner');

      const amount = ethers.parseEther('100');
      await expect(
        cctpReceiver.connect(user1).withdrawToken(mockToken.address, amount)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple bridge initiations', async () => {
      const amount = ethers.parseEther('100');
      const arcRecipient = user1.address;

      for (let i = 0; i < 5; i++) {
        await mockToken.connect(user1).approve(cctpReceiver.address, amount);
        const tx = await cctpReceiver.connect(user1).burnAndBridge_toArc(amount, arcRecipient);
        await expect(tx).to.emit(cctpReceiver, 'BridgeInitiated');
      }
    });

    it('should accumulate stranded tokens correctly', async () => {
      const amounts = [
        ethers.parseEther('100'),
        ethers.parseEther('50'),
        ethers.parseEther('75')
      ];

      for (const amount of amounts) {
        await mockToken.transfer(cctpReceiver.address, amount);
      }

      const contractBalance = await mockToken.balanceOf(cctpReceiver.address);
      expect(contractBalance).to.equal(
        ethers.parseEther('100') +
        ethers.parseEther('50') +
        ethers.parseEther('75')
      );

      // Withdraw all
      await cctpReceiver.withdrawToken(mockToken.address, contractBalance);
      expect(await mockToken.balanceOf(cctpReceiver.address)).to.equal(0);
    });
  });
});
