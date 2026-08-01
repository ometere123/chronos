// Standalone smoke test for CCTPReceiver.sol replay guard and unauthorized-sender rejection
// (Item 8). Uses node:assert style, bypassing hardhat-chai-matchers which is broken under this
// Hardhat 3 setup (pre-existing repo gap).
// Run with: node scripts/smoke-cctp-receiver.js
import assert from "node:assert/strict";
import hre from "hardhat";

async function main() {
  const { ethers } = await hre.network.connect();
  const [owner, transmitter, notTransmitter, tokenMessenger, arcBridge] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("USD Coin", "USDC", ethers.parseEther("1000000"));

  const CCTPReceiver = await ethers.getContractFactory("CCTPReceiver");
  const receiver = await CCTPReceiver.deploy(
    transmitter.address,
    tokenMessenger.address,
    arcBridge.address,
    usdc.address
  );

  assert.equal(await receiver.cctpMessageTransmitter(), transmitter.address, "transmitter mismatch");

  const message = ethers.hexlify(ethers.randomBytes(64));
  const attestation = ethers.hexlify(ethers.randomBytes(65));

  // 1. Unauthorized sender (not the configured MessageTransmitter) must be rejected.
  let unauthorizedReverted = false;
  try {
    await receiver.connect(notTransmitter).handleReceiveMessage(message, attestation);
  } catch (e) {
    unauthorizedReverted = true;
    assert.match(e.message, /Only CCTP transmitter/, "wrong revert reason for unauthorized sender");
  }
  assert.equal(unauthorizedReverted, true, "unauthorized sender call should have reverted");

  // 2. Authorized sender succeeds the first time.
  const tx = await receiver.connect(transmitter).handleReceiveMessage(message, attestation);
  await tx.wait();

  const messageHash = ethers.keccak256(message);
  assert.equal(await receiver.processedMessages(messageHash), true, "message should be marked processed");
  assert.equal(await receiver.pendingMessages(messageHash), attestation, "attestation not stored");

  // 3. Replay of the exact same message by the authorized transmitter must be rejected.
  let replayReverted = false;
  try {
    await receiver.connect(transmitter).handleReceiveMessage(message, attestation);
  } catch (e) {
    replayReverted = true;
    assert.match(e.message, /already processed/i, "wrong revert reason for replay");
  }
  assert.equal(replayReverted, true, "replay of already-processed message should have reverted");

  // 4. A different message from the authorized transmitter still works (guard is per-message, not global).
  const message2 = ethers.hexlify(ethers.randomBytes(64));
  const attestation2 = ethers.hexlify(ethers.randomBytes(65));
  await (await receiver.connect(transmitter).handleReceiveMessage(message2, attestation2)).wait();
  assert.equal(await receiver.processedMessages(ethers.keccak256(message2)), true, "second message should be processed");

  // 5. Owner can repoint the canonical transmitter address.
  await receiver.connect(owner).setMessageTransmitter(notTransmitter.address);
  assert.equal(await receiver.cctpMessageTransmitter(), notTransmitter.address, "transmitter should be updated");

  // Old transmitter is now unauthorized.
  let oldTransmitterReverted = false;
  try {
    await receiver.connect(transmitter).handleReceiveMessage(
      ethers.hexlify(ethers.randomBytes(64)),
      ethers.hexlify(ethers.randomBytes(65))
    );
  } catch (e) {
    oldTransmitterReverted = true;
  }
  assert.equal(oldTransmitterReverted, true, "old transmitter should be rejected after repoint");

  // Non-owner cannot repoint the transmitter.
  let nonOwnerReverted = false;
  try {
    await receiver.connect(notTransmitter).setMessageTransmitter(tokenMessenger.address);
  } catch (e) {
    nonOwnerReverted = true;
  }
  assert.equal(nonOwnerReverted, true, "non-owner should not be able to update transmitter");

  console.log("CCTPReceiver smoke test: ALL CHECKS PASSED");
}

main().catch((e) => {
  console.error("CCTPReceiver smoke test FAILED:", e);
  process.exit(1);
});
