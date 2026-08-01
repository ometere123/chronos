// Standalone smoke test for Item 10 (multi-chain destination claim/bridge routing), bypassing
// hardhat-chai-matchers which is broken under this Hardhat 3 + node:test setup (repo gap).
//
// TimeLockVault.claimVault(vaultId, destinationChain) is destination-agnostic on-chain: it just
// transfers the USDC to the caller and emits VaultClaimed(vaultId, owner, amount, destinationChain).
// The actual CCTP burn-to-destination-domain step happens off-chain (frontend/relayer), keyed off
// that destinationChain value and the domain map in backend/src/services/cctpRelayService.js. This
// test proves the on-chain half of the routing: claiming to the vault's original source chain works,
// and claiming to a DIFFERENT supported destination chain also works and is recorded distinctly.
//
// Run with: npx hardhat run scripts/smoke-multichain-claim.js
import assert from "node:assert/strict";
import hre from "hardhat";

const BASE_SEPOLIA = 84532;
const ARBITRUM_SEPOLIA = 421614;
const ETHEREUM_SEPOLIA = 11155111;
const OP_SEPOLIA = 11155420;

async function main() {
  const { ethers } = await hre.network.connect();
  const [owner, orchestrator, user] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("USD Coin", "USDC", ethers.parseEther("1000000"));

  const Treasury = await ethers.getContractFactory("Treasury");
  const treasury = await Treasury.deploy(
    usdc.address,
    [
      "0x0000000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000002",
      "0x0000000000000000000000000000000000000003",
    ],
    2
  );

  const TimeLockVault = await ethers.getContractFactory("TimeLockVault");
  const vault = await TimeLockVault.deploy(treasury.address);
  await vault.setBridgeOrchestrator(orchestrator.address);

  // Fund the vault contract so claims can pay out.
  await usdc.transfer(vault.address, ethers.parseEther("10000"));

  async function createVault(sourceChain, amount) {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const unlockAt = now + 5;
    const tx = await vault.connect(orchestrator).depositFromBridge(
      amount,
      user.address,
      unlockAt,
      sourceChain,
      0, // CCTP
      usdc.address,
      0 // FIXED
    );
    const receipt = await tx.wait();
    const iface = new ethers.Interface([
      "event VaultCreated(bytes32 indexed vaultId, address indexed owner, uint256 totalAmount, uint256 unlockAt)",
    ]);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === "VaultCreated") return parsed.args.vaultId;
      } catch {
        continue;
      }
    }
    throw new Error("VaultCreated event not found");
  }

  async function matureAndClaim(vaultId, destinationChain) {
    await ethers.provider.send("evm_increaseTime", [10]);
    await ethers.provider.send("evm_mine", []);

    const balanceBefore = await usdc.balanceOf(user.address);
    const tx = await vault.connect(user).claimVault(vaultId, destinationChain);
    const receipt = await tx.wait();
    const balanceAfter = await usdc.balanceOf(user.address);

    const iface = new ethers.Interface([
      "event VaultClaimed(bytes32 indexed vaultId, address indexed owner, uint256 amount, uint32 destinationChain)",
    ]);
    let claimedEvent = null;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === "VaultClaimed") claimedEvent = parsed.args;
      } catch {
        continue;
      }
    }

    return { balanceDelta: balanceAfter - balanceBefore, claimedEvent };
  }

  // --- Scenario A: claim back to the vault's original source chain (Base Sepolia) ---
  const amountA = ethers.parseEther("50");
  const vaultIdA = await createVault(BASE_SEPOLIA, amountA);
  const resultA = await matureAndClaim(vaultIdA, BASE_SEPOLIA);

  assert.equal(resultA.balanceDelta, amountA, "claim-to-source-chain did not pay out correctly");
  assert.equal(resultA.claimedEvent.vaultId, vaultIdA, "vaultId mismatch in VaultClaimed (source-chain case)");
  assert.equal(Number(resultA.claimedEvent.destinationChain), BASE_SEPOLIA, "destinationChain should equal source chain");

  const vaultAAfter = await vault.getVault(vaultIdA);
  assert.equal(Number(vaultAAfter.status), 2, "vault A should be CLAIMED"); // VaultStatus.CLAIMED == 2
  assert.equal(Number(vaultAAfter.sourceChain), BASE_SEPOLIA, "source chain should remain recorded as Base Sepolia");

  // --- Scenario B: vault sourced from Base Sepolia, claimed onward to a DIFFERENT destination
  // chain (Arbitrum Sepolia) - this is the not-just-back-to-source path Item 10 is about. ---
  const amountB = ethers.parseEther("75");
  const vaultIdB = await createVault(BASE_SEPOLIA, amountB);
  const resultB = await matureAndClaim(vaultIdB, ARBITRUM_SEPOLIA);

  assert.equal(resultB.balanceDelta, amountB, "claim-to-different-destination did not pay out correctly");
  assert.equal(Number(resultB.claimedEvent.destinationChain), ARBITRUM_SEPOLIA, "destinationChain should route to Arbitrum Sepolia, not the source chain");
  assert.notEqual(Number(resultB.claimedEvent.destinationChain), BASE_SEPOLIA, "destination must differ from source in this scenario");

  const vaultBAfter = await vault.getVault(vaultIdB);
  assert.equal(Number(vaultBAfter.sourceChain), BASE_SEPOLIA, "vault B source chain should remain Base Sepolia even though it was claimed elsewhere");

  // --- Scenario C: another cross-chain combination (Ethereum Sepolia -> OP Sepolia) to prove
  // the routing isn't hardcoded to a single pair. ---
  const amountC = ethers.parseEther("20");
  const vaultIdC = await createVault(ETHEREUM_SEPOLIA, amountC);
  const resultC = await matureAndClaim(vaultIdC, OP_SEPOLIA);
  assert.equal(Number(resultC.claimedEvent.destinationChain), OP_SEPOLIA, "should route Ethereum Sepolia -> OP Sepolia correctly");

  // --- Scenario D: double-claim of the same vault must be rejected regardless of destination. ---
  let doubleClaimReverted = false;
  try {
    await vault.connect(user).claimVault(vaultIdA, ARBITRUM_SEPOLIA);
  } catch (e) {
    doubleClaimReverted = true;
    assert.match(e.message, /Vault not active/, "wrong revert reason for double claim");
  }
  assert.equal(doubleClaimReverted, true, "claiming an already-claimed vault should revert");

  console.log("Multi-chain claim routing smoke test: ALL CHECKS PASSED");
}

main().catch((e) => {
  console.error("Multi-chain claim routing smoke test FAILED:", e);
  process.exit(1);
});
