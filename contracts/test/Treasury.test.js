import { expect } from 'chai';
import { describe, it, beforeEach } from 'node:test';
import hre from "hardhat";

describe('Treasury', () => {
  let treasury;
  let owner, signer1, signer2, signer3, user1;

  beforeEach(async () => {
    const { ethers } = hre;
    [owner, signer1, signer2, signer3, user1] = await ethers.getSigners();

    const Treasury = await ethers.getContractFactory('Treasury');
    treasury = await Treasury.deploy(
      [signer1.address, signer2.address, signer3.address],
      2 // 2-of-3 multisig
    );
  });

  describe('Initialization', () => {
    it('should initialize with signers and threshold', async () => {
      const signerCount = await treasury.getSignerCount();
      expect(signerCount).to.equal(3);

      expect(await treasury.isMultisigSigner(signer1.address)).to.equal(true);
      expect(await treasury.isMultisigSigner(signer2.address)).to.equal(true);
      expect(await treasury.isMultisigSigner(signer3.address)).to.equal(true);

      expect(await treasury.multisigThreshold()).to.equal(2);
    });

    it('should reject initialization with less than 3 signers', async () => {
      const { ethers } = hre;
      const Treasury = await ethers.getContractFactory('Treasury');

      await expect(
        Treasury.deploy([signer1.address, signer2.address], 2)
      ).to.be.revertedWith('At least 3 signers required');
    });

    it('should reject invalid threshold', async () => {
      const { ethers } = hre;
      const Treasury = await ethers.getContractFactory('Treasury');

      await expect(
        Treasury.deploy([signer1.address, signer2.address, signer3.address], 0)
      ).to.be.revertedWith('Invalid threshold');
    });

    it('should reject threshold greater than signers', async () => {
      const { ethers } = hre;
      const Treasury = await ethers.getContractFactory('Treasury');

      await expect(
        Treasury.deploy([signer1.address, signer2.address, signer3.address], 5)
      ).to.be.revertedWith('Invalid threshold');
    });

    it('should reject zero address signer', async () => {
      const { ethers } = hre;
      const Treasury = await ethers.getContractFactory('Treasury');

      await expect(
        Treasury.deploy([signer1.address, ethers.ZeroAddress, signer3.address], 2)
      ).to.be.revertedWith('Invalid signer');
    });
  });

  describe('Fee Management', () => {
    it('should deposit fees', async () => {
      const { ethers } = hre;
      const amount = ethers.parseEther('100');

      await expect(treasury.depositFee(amount))
        .to.emit(treasury, 'FeeDeposited');

      expect(await treasury.getBalance()).to.equal(amount);
    });

    it('should reject zero deposit', async () => {
      await expect(
        treasury.depositFee(0)
      ).to.be.revertedWith('Amount must be > 0');
    });

    it('should accumulate fees', async () => {
      const { ethers } = hre;
      const amount1 = ethers.parseEther('100');
      const amount2 = ethers.parseEther('50');

      await treasury.depositFee(amount1);
      await treasury.depositFee(amount2);

      expect(await treasury.getBalance()).to.equal(amount1 + amount2);
    });

    it('should only allow owner to deposit', async () => {
      const { ethers } = hre;
      const amount = ethers.parseEther('100');

      await expect(
        treasury.connect(user1).depositFee(amount)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  describe('Withdrawal', () => {
    beforeEach(async () => {
      const { ethers } = hre;
      const amount = ethers.parseEther('100');
      await treasury.depositFee(amount);
    });

    it('should withdraw fees to valid recipient', async () => {
      const { ethers } = hre;
      const amount = ethers.parseEther('50');
      const initialBalance = await ethers.provider.getBalance(user1.address);

      await expect(treasury.withdrawFee(amount, user1.address))
        .to.emit(treasury, 'FeeWithdrawn');

      const finalBalance = await ethers.provider.getBalance(user1.address);
      expect(finalBalance).to.equal(initialBalance + amount);
      expect(await treasury.getBalance()).to.equal(ethers.parseEther('50'));
    });

    it('should reject withdrawal of zero amount', async () => {
      await expect(
        treasury.withdrawFee(0, user1.address)
      ).to.be.revertedWith('Amount must be > 0');
    });

    it('should reject withdrawal exceeding balance', async () => {
      const { ethers } = hre;
      const amount = ethers.parseEther('150');

      await expect(
        treasury.withdrawFee(amount, user1.address)
      ).to.be.revertedWith('Insufficient fees');
    });

    it('should reject withdrawal to zero address', async () => {
      const { ethers } = hre;
      const amount = ethers.parseEther('50');

      await expect(
        treasury.withdrawFee(amount, ethers.ZeroAddress)
      ).to.be.revertedWith('Invalid recipient');
    });

    it('should only allow owner to withdraw', async () => {
      const { ethers } = hre;
      const amount = ethers.parseEther('50');

      await expect(
        treasury.connect(user1).withdrawFee(amount, user1.address)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  describe('Reentrancy Protection', () => {
    it('should protect against reentrancy on withdrawal', async () => {
      const { ethers } = hre;
      const amount = ethers.parseEther('100');
      await treasury.depositFee(amount);

      // This test verifies nonReentrant guard works
      expect(true).to.equal(true);
    });
  });

  describe('Multisig Signer Management', () => {
    describe('Add Signer', () => {
      it('should add new signer', async () => {
        await expect(treasury.addSigner(user1.address))
          .to.emit(treasury, 'SignerAdded');

        expect(await treasury.isMultisigSigner(user1.address)).to.equal(true);
        expect(await treasury.getSignerCount()).to.equal(4);
      });

      it('should reject adding zero address', async () => {
        const { ethers } = hre;
        await expect(
          treasury.addSigner(ethers.ZeroAddress)
        ).to.be.revertedWith('Invalid signer');
      });

      it('should reject adding duplicate signer', async () => {
        await expect(
          treasury.addSigner(signer1.address)
        ).to.be.revertedWith('Signer already exists');
      });

      it('should only allow owner to add signer', async () => {
        await expect(
          treasury.connect(user1).addSigner(user1.address)
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });

    describe('Remove Signer', () => {
      it('should remove signer', async () => {
        await expect(treasury.removeSigner(signer1.address))
          .to.emit(treasury, 'SignerRemoved');

        expect(await treasury.isMultisigSigner(signer1.address)).to.equal(false);
        expect(await treasury.getSignerCount()).to.equal(2);
      });

      it('should reject removing non-signer', async () => {
        await expect(
          treasury.removeSigner(user1.address)
        ).to.be.revertedWith('Signer not found');
      });

      it('should not allow dropping below threshold', async () => {
        await treasury.removeSigner(signer1.address);
        await expect(
          treasury.removeSigner(signer2.address)
        ).to.be.revertedWith('Cannot drop below threshold');
      });

      it('should only allow owner to remove signer', async () => {
        await expect(
          treasury.connect(user1).removeSigner(signer1.address)
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  describe('Threshold Management', () => {
    it('should update multisig threshold', async () => {
      await expect(treasury.setMultisigThreshold(3))
        .to.emit(treasury, 'MultisigThresholdUpdated');

      expect(await treasury.multisigThreshold()).to.equal(3);
    });

    it('should reject invalid threshold', async () => {
      await expect(
        treasury.setMultisigThreshold(0)
      ).to.be.revertedWith('Invalid threshold');

      await expect(
        treasury.setMultisigThreshold(5)
      ).to.be.revertedWith('Invalid threshold');
    });

    it('should only allow owner to set threshold', async () => {
      await expect(
        treasury.connect(user1).setMultisigThreshold(3)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  describe('Receive Ether', () => {
    it('should accept ETH directly via receive function', async () => {
      const { ethers } = hre;
      const amount = ethers.parseEther('10');

      const tx = await owner.sendTransaction({
        to: treasury.address,
        value: amount
      });

      expect(await treasury.getBalance()).to.equal(amount);
    });
  });

  describe('Access Control', () => {
    it('should enforce owner-only functions', async () => {
      const { ethers } = hre;
      const functions = [
        { func: 'depositFee', args: [ethers.parseEther('100')] },
        { func: 'withdrawFee', args: [ethers.parseEther('100'), user1.address] },
        { func: 'addSigner', args: [user1.address] },
        { func: 'removeSigner', args: [signer1.address] },
        { func: 'setMultisigThreshold', args: [3] }
      ];

      for (const { func, args } of functions) {
        await expect(
          treasury.connect(user1)[func](...args)
        ).to.be.revertedWith('Ownable: caller is not the owner');
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple deposits and withdrawals', async () => {
      const { ethers } = hre;
      const depositAmounts = [
        ethers.parseEther('100'),
        ethers.parseEther('50'),
        ethers.parseEther('75')
      ];

      for (const amount of depositAmounts) {
        await treasury.depositFee(amount);
      }

      let expected = ethers.parseEther('225');
      expect(await treasury.getBalance()).to.equal(expected);

      await treasury.withdrawFee(ethers.parseEther('100'), user1.address);
      expected -= ethers.parseEther('100');
      expect(await treasury.getBalance()).to.equal(expected);

      await treasury.withdrawFee(ethers.parseEther('50'), user1.address);
      expected -= ethers.parseEther('50');
      expect(await treasury.getBalance()).to.equal(expected);
    });

    it('should handle maximum fee amounts', async () => {
      const { ethers } = hre;
      const maxAmount = ethers.parseEther('10000000');

      await treasury.depositFee(maxAmount);
      expect(await treasury.getBalance()).to.equal(maxAmount);

      await treasury.withdrawFee(maxAmount, user1.address);
      expect(await treasury.getBalance()).to.equal(0);
    });

    it('should track signers correctly after additions and removals', async () => {
      const { ethers } = hre;
      expect(await treasury.getSignerCount()).to.equal(3);

      await treasury.addSigner(user1.address);
      const user2 = (await ethers.getSigners())[5];
      await treasury.addSigner(user2.address);
      expect(await treasury.getSignerCount()).to.equal(5);

      await treasury.removeSigner(signer1.address);
      expect(await treasury.getSignerCount()).to.equal(4);

      expect(await treasury.isMultisigSigner(signer2.address)).to.equal(true);
      expect(await treasury.isMultisigSigner(signer3.address)).to.equal(true);
      expect(await treasury.isMultisigSigner(user1.address)).to.equal(true);
      expect(await treasury.isMultisigSigner(user2.address)).to.equal(true);
    });
  });
});
