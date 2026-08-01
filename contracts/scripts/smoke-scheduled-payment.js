// Standalone smoke test for ScheduledPayment.sol + Treasury.releaseFunds (Item 9), bypassing
// hardhat-chai-matchers which is broken under this Hardhat 3 + node:test setup (repo gap).
// Run with: node scripts/smoke-scheduled-payment.js
import assert from "node:assert/strict";
import hre from "hardhat";

async function main() {
  const { ethers } = await hre.network.connect();
  const [owner, signer1, signer2, signer3, recipient] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("USD Coin", "USDC", ethers.parseEther("1000000"));

  const Treasury = await ethers.getContractFactory("Treasury");
  const treasury = await Treasury.deploy(
    usdc.address,
    [signer1.address, signer2.address, signer3.address],
    2
  );

  const ScheduledPayment = await ethers.getContractFactory("ScheduledPayment");
  const scheduledPayment = await ScheduledPayment.deploy(treasury.address);

  await treasury.connect(owner).setScheduledPaymentAddress(scheduledPayment.address);
  assert.equal(await treasury.scheduledPaymentAddress(), scheduledPayment.address, "scheduledPaymentAddress not set");

  // Fund the treasury with real on-chain USDC balance (not accumulatedFees accounting).
  const fundAmount = ethers.parseEther("1000");
  await usdc.transfer(treasury.address, fundAmount);
  assert.equal(await treasury.getUsdcBalance(), fundAmount, "treasury not funded");

  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const payAmount = ethers.parseEther("100");
  const minTreasuryBalanceAfter = ethers.parseEther("850"); // leaves room for 1 payment (1000-100=900 OK), blocks a 2nd

  const slot0 = now + 10;
  const slot1 = now + 20;

  const createTx = await scheduledPayment.createSchedule(
    recipient.address,
    payAmount,
    minTreasuryBalanceAfter,
    [slot0, slot1]
  );
  await createTx.wait();

  const scheduleId = 0n;
  const schedule = await scheduledPayment.getSchedule(scheduleId);
  assert.equal(schedule.recipient, recipient.address, "recipient mismatch");
  assert.equal(schedule.amount, payAmount, "amount mismatch");

  // --- Check 1: payment cannot execute before it is due ---
  let notDueReverted = false;
  try {
    await scheduledPayment.executePayment(scheduleId, 0);
  } catch (e) {
    notDueReverted = true;
    assert.match(e.message, /not due yet/i, "wrong revert reason for not-due payment");
  }
  assert.equal(notDueReverted, true, "payment before due timestamp should revert");

  // Advance time past slot0.
  await ethers.provider.send("evm_increaseTime", [15]);
  await ethers.provider.send("evm_mine", []);

  // --- Check 2: payment executes when due and threshold is satisfied ---
  const recipientBalanceBefore = await usdc.balanceOf(recipient.address);
  const execTx = await scheduledPayment.executePayment(scheduleId, 0);
  await execTx.wait();
  const recipientBalanceAfter = await usdc.balanceOf(recipient.address);

  assert.equal(recipientBalanceAfter - recipientBalanceBefore, payAmount, "recipient did not receive payout");
  assert.equal(await treasury.getUsdcBalance(), fundAmount - payAmount, "treasury balance not decremented");
  assert.equal(await scheduledPayment.slotExecuted(scheduleId, 0), true, "slot 0 should be marked executed");

  // --- Check 3: payment cannot be double-executed for the same schedule slot ---
  let doubleExecReverted = false;
  try {
    await scheduledPayment.executePayment(scheduleId, 0);
  } catch (e) {
    doubleExecReverted = true;
    assert.match(e.message, /already executed/i, "wrong revert reason for double execution");
  }
  assert.equal(doubleExecReverted, true, "double execution of the same slot should revert");

  // Advance time past slot1.
  await ethers.provider.send("evm_increaseTime", [15]);
  await ethers.provider.send("evm_mine", []);

  // Treasury now holds 900. A second 100 payout would leave 800, which is BELOW
  // minTreasuryBalanceAfter (850) -> must be blocked by the balance guard.
  const [due, reason] = await scheduledPayment.isSlotDue(scheduleId, 1);
  assert.equal(due, false, "slot 1 should not be reported due once it would breach the guard");
  assert.match(reason, /balance guard/i, "isSlotDue should report the balance guard reason");

  let guardReverted = false;
  try {
    await scheduledPayment.executePayment(scheduleId, 1);
  } catch (e) {
    guardReverted = true;
    assert.match(e.message, /balance guard/i, "wrong revert reason for balance guard breach");
  }
  assert.equal(guardReverted, true, "payment that breaches the balance guard should revert");
  assert.equal(await scheduledPayment.slotExecuted(scheduleId, 1), false, "blocked slot must not be marked executed");
  assert.equal(await treasury.getUsdcBalance(), fundAmount - payAmount, "treasury balance should be unchanged after blocked payout");

  // Top up the treasury so slot 1 becomes payable, and confirm it now executes.
  await usdc.transfer(treasury.address, ethers.parseEther("200"));
  const execTx2 = await scheduledPayment.executePayment(scheduleId, 1);
  await execTx2.wait();
  assert.equal(await scheduledPayment.slotExecuted(scheduleId, 1), true, "slot 1 should be executed after top-up");

  // --- Check 4: only the ScheduledPayment contract may call Treasury.releaseFunds directly ---
  let directCallReverted = false;
  try {
    await treasury.connect(owner).releaseFunds(recipient.address, ethers.parseEther("1"));
  } catch (e) {
    directCallReverted = true;
    assert.match(e.message, /Only scheduled payment contract/, "wrong revert reason for direct releaseFunds call");
  }
  assert.equal(directCallReverted, true, "direct releaseFunds call from non-ScheduledPayment address should revert");

  console.log("ScheduledPayment smoke test: ALL CHECKS PASSED");
}

main().catch((e) => {
  console.error("ScheduledPayment smoke test FAILED:", e);
  process.exit(1);
});
