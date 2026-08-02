import '../src/config/env.js';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { contractAddresses } from '../src/config/contracts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const artifactPath = join(__dirname, '../../contracts/artifacts/arc/CreditLine.sol/CreditLine.json');
const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'));

const TIMELOCK_VAULT_OWNER_ABI = [
  'function owner() view returns (address)',
  'function setCreditLine(address _creditLine) external',
];

async function main() {
  const provider = new ethers.JsonRpcProvider(contractAddresses.arcRpcUrl);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log('Deployer:', wallet.address);
  console.log('USDC:', contractAddresses.usdc);
  console.log('TimeLockVault:', contractAddresses.timeLockVault);

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  console.log('\nDeploying CreditLine...');
  const creditLine = await factory.deploy(contractAddresses.usdc, contractAddresses.timeLockVault);
  await creditLine.waitForDeployment();
  const creditLineAddress = await creditLine.getAddress();
  console.log('CreditLine deployed to:', creditLineAddress);

  console.log('\nWiring TimeLockVault.setCreditLine...');
  const timeLockVault = new ethers.Contract(contractAddresses.timeLockVault, TIMELOCK_VAULT_OWNER_ABI, wallet);
  const owner = await timeLockVault.owner();
  console.log('TimeLockVault owner:', owner);
  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`Deployer wallet (${wallet.address}) is not the TimeLockVault owner (${owner}). Cannot wire setCreditLine.`);
  }
  const tx = await timeLockVault.setCreditLine(creditLineAddress);
  await tx.wait();
  console.log('TimeLockVault.creditLineAddress set to', creditLineAddress);

  console.log('\n========================================');
  console.log('New CreditLine address:', creditLineAddress);
  console.log('========================================');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
