const pptxgen = require('pptxgenjs');

const NAVY = '14213D';
const NAVY_LIGHT = '1F2E52'; // for cards on navy bg
const SLATE = '5A6B8C';
const AMBER = 'FCA311';
const CREAM = 'F5F5F0'; // NOT used as background (avoid warm-neutral default) - text only if needed
const WHITE = 'FFFFFF';
const OFFWHITE = 'F7F8FA'; // subtle card tint on white bg
const BODY = '3A4358';

const ICON = (name, color) => `assets/${name}_${color}.png`;

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13.3 x 7.5
const PW = 13.333, PH = 7.5;

pres.defineSlideMaster({
  title: 'DARK',
  background: { color: NAVY },
});
pres.defineSlideMaster({
  title: 'LIGHT',
  background: { color: WHITE },
});

function footer(slide, pageNum, dark) {
  slide.addText(`CHRONOS  •  Build on Arc Hackathon  •  Checkpoint 2`, {
    x: 0.5, y: PH - 0.45, w: 8, h: 0.3, fontFace: 'Calibri', fontSize: 9,
    color: dark ? '8993B5' : '9AA3B8', margin: 0,
  });
  slide.addText(String(pageNum), {
    x: PW - 1.0, y: PH - 0.45, w: 0.5, h: 0.3, align: 'right', fontFace: 'Calibri', fontSize: 9,
    color: dark ? '8993B5' : '9AA3B8', margin: 0,
  });
}

function iconCircle(slide, x, y, d, iconName, iconColor, circleFill) {
  slide.addShape('ellipse', { x, y, w: d, h: d, fill: { color: circleFill }, line: { type: 'none' } });
  const pad = d * 0.26;
  slide.addImage({ path: ICON(iconName, iconColor), x: x + pad, y: y + pad, w: d - 2 * pad, h: d - 2 * pad });
}

// ---------------------------------------------------------------------------
// SLIDE 1 — Title
// ---------------------------------------------------------------------------
{
  const s = pres.addSlide({ masterName: 'DARK' });

  s.addText('CHRONOS', {
    x: 0.9, y: 2.55, w: 11.5, h: 1.3, fontFace: 'Cambria', fontSize: 60, bold: true,
    color: WHITE, margin: 0, charSpacing: 2,
  });
  s.addText('Time-locked USDC savings, credit, and autonomous settlement on Arc Testnet', {
    x: 0.95, y: 3.75, w: 10.6, h: 0.7, fontFace: 'Calibri', fontSize: 20, italic: true,
    color: 'CADCFC', margin: 0,
  });

  // Motif: concentric rings suggesting a clock / vault dial, upper right
  s.addShape('ellipse', { x: 9.9, y: 0.55, w: 3.2, h: 3.2, fill: { type: 'none' }, line: { color: AMBER, width: 1.5 } });
  s.addShape('ellipse', { x: 10.35, y: 1.0, w: 2.3, h: 2.3, fill: { type: 'none' }, line: { color: '3E4E7E', width: 1.25 } });
  s.addShape('ellipse', { x: 10.85, y: 1.5, w: 1.3, h: 1.3, fill: { color: AMBER }, line: { type: 'none' } });

  s.addText('Build on Arc Hackathon  •  Checkpoint 2 Submission', {
    x: 0.95, y: 5.85, w: 9, h: 0.4, fontFace: 'Calibri', fontSize: 13, color: '8993B5', margin: 0,
  });

  // Track pills
  const pillY = 6.35;
  s.addShape('roundRect', { x: 0.95, y: pillY, w: 2.55, h: 0.5, rectRadius: 0.25, fill: { color: NAVY_LIGHT }, line: { color: AMBER, width: 1 } });
  s.addText('DeFi Track', { x: 0.95, y: pillY, w: 2.55, h: 0.5, align: 'center', valign: 'middle', fontFace: 'Calibri', fontSize: 13, bold: true, color: WHITE, margin: 0 });
  s.addShape('roundRect', { x: 3.65, y: pillY, w: 3.4, h: 0.5, rectRadius: 0.25, fill: { color: NAVY_LIGHT }, line: { color: AMBER, width: 1 } });
  s.addText('Agentic Economy Track', { x: 3.65, y: pillY, w: 3.4, h: 0.5, align: 'center', valign: 'middle', fontFace: 'Calibri', fontSize: 13, bold: true, color: WHITE, margin: 0 });
}

// ---------------------------------------------------------------------------
// SLIDE 2 — Problem
// ---------------------------------------------------------------------------
{
  const s = pres.addSlide({ masterName: 'LIGHT' });
  s.addText('Savings discipline and DeFi liquidity are a trade-off, not a package', {
    x: 0.6, y: 0.5, w: 12.1, h: 1.0, fontFace: 'Cambria', fontSize: 32, bold: true, color: NAVY, margin: 0,
  });

  const problems = [
    { icon: 'clock', title: 'Locking funds means giving up access', body: 'Time-locks protect against impulsive withdrawals, but a real emergency, or a better opportunity, leaves the saver stuck until maturity.' },
    { icon: 'trending', title: 'A single lump-sum unlock is a blunt tool', body: 'Real savings goals need structure: some funds for safety, some for growth, some released gradually, not everything unlocking on one date.' },
    { icon: 'dollar', title: 'Borrowing against locked collateral is clunky', body: 'Most protocols make you choose between staying locked and getting liquidity. Bridging that collateral into usable credit is rarely simple, or safe.' },
    { icon: 'users', title: 'Users have to babysit their own vaults', body: 'Claiming at maturity, monitoring price conditions, moving funds across chains: all manual, all easy to forget, all a source of missed value.' },
  ];

  const colW = 5.85, gap = 0.5, startX = 0.6, startY = 1.75, cardH = 2.35;
  problems.forEach((p, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = startX + col * (colW + gap);
    const y = startY + row * (cardH + 0.35);
    s.addShape('roundRect', { x, y, w: colW, h: cardH, rectRadius: 0.1, fill: { color: OFFWHITE }, line: { type: 'none' }, shadow: { type: 'outer', color: '1F2E52', opacity: 0.12, blur: 8, offset: 3, angle: 90 } });
    iconCircle(s, x + 0.3, y + 0.3, 0.65, p.icon, WHITE, NAVY);
    s.addText(p.title, { x: x + 1.15, y: y + 0.28, w: colW - 1.4, h: 0.7, fontFace: 'Calibri', fontSize: 15, bold: true, color: NAVY, margin: 0, valign: 'top' });
    s.addText(p.body, { x: x + 0.3, y: y + 1.05, w: colW - 0.6, h: cardH - 1.25, fontFace: 'Calibri', fontSize: 11.5, color: BODY, margin: 0, valign: 'top' });
  });

  footer(s, 2, false);
}

// ---------------------------------------------------------------------------
// SLIDE 3 — Solution overview
// ---------------------------------------------------------------------------
{
  const s = pres.addSlide({ masterName: 'LIGHT' });
  s.addText('Chronos: programmable time-locked vaults, with liquidity and automation built in', {
    x: 0.6, y: 0.5, w: 12.1, h: 0.95, fontFace: 'Cambria', fontSize: 26, bold: true, color: NAVY, margin: 0,
  });
  s.addText(
    'Chronos is a USDC vault protocol on Arc Testnet, Circle\'s stablecoin-native chain. Users deposit from Base, Arbitrum, Ethereum, or OP Sepolia via Circle\'s CCTP, and the deposit settles into an on-chain vault on Arc, with the discipline of a time-lock and the flexibility of modern DeFi.',
    { x: 0.6, y: 1.5, w: 12.1, h: 0.75, fontFace: 'Calibri', fontSize: 13, color: BODY, margin: 0 }
  );

  const features = [
    { icon: 'layers', title: 'Smart Split Vaults', body: 'One deposit, auto-allocated into savings, yield, and reserve buckets, each claimable on its own.' },
    { icon: 'repeat', title: 'Streaming Vaults', body: 'Release a deposit gradually over scheduled tranches instead of one lump sum at maturity.' },
    { icon: 'shield', title: 'Oracle-Gated Unlocks', body: 'Require a price condition or treasury-balance guard on top of the time-lock, enforced on-chain.' },
    { icon: 'dollar', title: 'CreditLine', body: 'Borrow USDC against a locked vault as collateral, without breaking the lock or waiting for maturity.' },
    { icon: 'cpu', title: 'Autonomous Agent', body: 'Delegate a vault to an agent that claims it automatically at maturity, gas-sponsored, no manual click needed.' },
    { icon: 'link', title: 'Cross-Chain via CCTP', body: 'Native USDC bridging in and back out, no wrapped assets, no synthetic representations.' },
  ];

  const colW = 3.9, gap = 0.28, startX = 0.6, startY = 2.4, cardH = 1.95;
  features.forEach((f, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = startX + col * (colW + gap);
    const y = startY + row * (cardH + 0.22);
    s.addShape('roundRect', { x, y, w: colW, h: cardH, rectRadius: 0.08, fill: { color: OFFWHITE }, line: { type: 'none' } });
    iconCircle(s, x + 0.24, y + 0.22, 0.5, f.icon, WHITE, NAVY);
    s.addText(f.title, { x: x + 0.24, y: y + 0.8, w: colW - 0.48, h: 0.35, fontFace: 'Calibri', fontSize: 13, bold: true, color: NAVY, margin: 0 });
    s.addText(f.body, { x: x + 0.24, y: y + 1.13, w: colW - 0.48, h: cardH - 1.25, fontFace: 'Calibri', fontSize: 10, color: BODY, margin: 0 });
  });

  footer(s, 3, false);
}

// ---------------------------------------------------------------------------
// SLIDE 4 — How it works (flow)
// ---------------------------------------------------------------------------
{
  const s = pres.addSlide({ masterName: 'LIGHT' });
  s.addText('How it works: from any chain to a settled vault on Arc', {
    x: 0.6, y: 0.5, w: 12.1, h: 0.9, fontFace: 'Cambria', fontSize: 30, bold: true, color: NAVY, margin: 0,
  });

  const steps = [
    { icon: 'dollar', label: 'Deposit USDC', sub: 'Base / Arbitrum / Ethereum / OP Sepolia' },
    { icon: 'link', label: 'Bridge via CCTP', sub: 'Circle\'s native burn-and-mint transfer' },
    { icon: 'clock', label: 'Settle into a vault', sub: 'On-chain on Arc Testnet, terms locked in' },
    { icon: 'zap', label: 'Grow, borrow, or wait', sub: 'Split, stream, or use as CreditLine collateral' },
    { icon: 'check', label: 'Claim at maturity', sub: 'Manually, or automatically via the agent' },
  ];

  const n = steps.length;
  const boxW = 2.15, boxH = 1.9, gap = (PW - 1.2 - n * boxW) / (n - 1);
  const y = 2.6;
  steps.forEach((st, i) => {
    const x = 0.6 + i * (boxW + gap);
    s.addShape('roundRect', { x, y, w: boxW, h: boxH, rectRadius: 0.09, fill: { color: NAVY }, line: { type: 'none' } });
    iconCircle(s, x + boxW / 2 - 0.35, y + 0.28, 0.7, st.icon, NAVY, AMBER);
    s.addText(String(i + 1), { x: x + 0.08, y: y + 0.08, w: 0.4, h: 0.3, fontFace: 'Calibri', fontSize: 11, bold: true, color: '8993B5', margin: 0 });
    s.addText(st.label, { x: x + 0.12, y: y + 1.05, w: boxW - 0.24, h: 0.42, align: 'center', fontFace: 'Calibri', fontSize: 12.5, bold: true, color: WHITE, margin: 0 });
    s.addText(st.sub, { x: x + 0.12, y: y + 1.45, w: boxW - 0.24, h: 0.42, align: 'center', fontFace: 'Calibri', fontSize: 9, color: 'CADCFC', margin: 0 });

    if (i < n - 1) {
      const arrowX = x + boxW + gap / 2 - 0.12;
      s.addText('→', { x: arrowX, y: y + boxH / 2 - 0.25, w: gap - 0.1, h: 0.5, align: 'center', fontFace: 'Arial', fontSize: 22, bold: true, color: AMBER, margin: 0 });
    }
  });

  s.addText(
    'Every leg, deposit, split/stream logic, oracle checks, and CreditLine borrow/repay, is enforced by TimeLockVault and CreditLine smart contracts on Arc, not a backend database.',
    { x: 0.6, y: 5.1, w: 12.1, h: 0.8, fontFace: 'Calibri', fontSize: 13, italic: true, color: BODY, margin: 0 }
  );

  footer(s, 4, false);
}

// ---------------------------------------------------------------------------
// SLIDE 5 — Vault types
// ---------------------------------------------------------------------------
{
  const s = pres.addSlide({ masterName: 'LIGHT' });
  s.addText('One vault primitive, four ways to structure a deposit', {
    x: 0.6, y: 0.5, w: 12.1, h: 0.9, fontFace: 'Cambria', fontSize: 30, bold: true, color: NAVY, margin: 0,
  });

  const types = [
    { icon: 'clock', title: 'Standard', tag: 'FIXED / FLEXIBLE', body: 'A single lump-sum unlock at maturity. FIXED vaults cannot be withdrawn early; FLEXIBLE vaults allow early exit for a 0.5% penalty.' },
    { icon: 'layers', title: 'Smart Split', tag: 'SAVINGS / YIELD / RESERVE', body: 'The deposit is auto-allocated across three named buckets by basis points at creation, each claimed independently at maturity.' },
    { icon: 'repeat', title: 'Streaming', tag: 'N TRANCHES', body: 'Release the deposit in equal tranches at a fixed interval instead of all at once, useful for payroll-style or gradual-release goals.' },
    { icon: 'shield', title: 'Oracle-Gated', tag: 'CONDITIONAL', body: 'Add a price threshold (via a Band Protocol or mock oracle feed) or a treasury-balance guard on top of the time-lock itself.' },
  ];

  const colW = 5.85, gap = 0.5, startX = 0.6, startY = 1.7, cardH = 2.3;
  types.forEach((t, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = startX + col * (colW + gap);
    const y = startY + row * (cardH + 0.3);
    s.addShape('roundRect', { x, y, w: colW, h: cardH, rectRadius: 0.1, fill: { color: OFFWHITE }, line: { type: 'none' } });
    iconCircle(s, x + 0.3, y + 0.3, 0.65, t.icon, WHITE, NAVY);
    s.addText(t.title, { x: x + 1.15, y: y + 0.24, w: colW - 1.4, h: 0.4, fontFace: 'Calibri', fontSize: 16, bold: true, color: NAVY, margin: 0 });
    s.addText(t.tag, { x: x + 1.15, y: y + 0.62, w: colW - 1.4, h: 0.3, fontFace: 'Calibri', fontSize: 9.5, bold: true, color: AMBER, margin: 0, charSpacing: 1 });
    s.addText(t.body, { x: x + 0.3, y: y + 1.1, w: colW - 0.6, h: cardH - 1.3, fontFace: 'Calibri', fontSize: 11.5, color: BODY, margin: 0 });
  });

  footer(s, 5, false);
}

// ---------------------------------------------------------------------------
// SLIDE 6 — DeFi Track: CreditLine
// ---------------------------------------------------------------------------
{
  const s = pres.addSlide({ masterName: 'LIGHT' });
  s.addText('DeFi Track: CreditLine turns a locked vault into usable credit', {
    x: 0.6, y: 0.5, w: 12.1, h: 0.9, fontFace: 'Cambria', fontSize: 28, bold: true, color: NAVY, margin: 0,
  });
  s.addText(
    'A vault does not have to sit idle until maturity. CreditLine is a lending pool that treats an active Chronos vault as collateral, letting the owner borrow USDC now and repay later, while independent lenders earn interest by supplying liquidity.',
    { x: 0.6, y: 1.5, w: 7.0, h: 1.6, fontFace: 'Calibri', fontSize: 13.5, color: BODY, margin: 0 }
  );

  const rows = [
    { icon: 'dollar', title: 'Borrow', body: 'Lock the vault as collateral and borrow USDC up to a fixed loan-to-value cap, directly from the pool.' },
    { icon: 'repeat', title: 'Repay', body: 'Repay principal plus interest at any time to unlock the vault\'s collateral again.' },
    { icon: 'trending', title: 'Lend', body: 'Anyone can deposit USDC into the pool and earn a pro-rata share of borrower interest.' },
  ];
  let ry = 3.3;
  rows.forEach((r) => {
    iconCircle(s, 0.6, ry, 0.55, r.icon, WHITE, NAVY);
    s.addText(r.title, { x: 1.35, y: ry - 0.02, w: 1.5, h: 0.55, valign: 'middle', fontFace: 'Calibri', fontSize: 13, bold: true, color: NAVY, margin: 0 });
    s.addText(r.body, { x: 2.9, y: ry - 0.02, w: 4.7, h: 0.6, valign: 'middle', fontFace: 'Calibri', fontSize: 11, color: BODY, margin: 0 });
    ry += 0.78;
  });

  // Right column: stat card
  s.addShape('roundRect', { x: 8.15, y: 1.5, w: 4.55, h: 4.85, rectRadius: 0.12, fill: { color: NAVY }, line: { type: 'none' } });
  s.addText('50%', { x: 8.15, y: 1.85, w: 4.55, h: 1.1, align: 'center', fontFace: 'Cambria', fontSize: 56, bold: true, color: AMBER, margin: 0 });
  s.addText('maximum loan-to-value', { x: 8.15, y: 2.75, w: 4.55, h: 0.4, align: 'center', fontFace: 'Calibri', fontSize: 12, color: 'CADCFC', margin: 0 });

  s.addShape('line', { x: 8.7, y: 3.35, w: 3.45, h: 0, line: { color: '3E4E7E', width: 1 } });

  s.addText('No forced sale of the underlying vault, no giving up the original time-lock terms, and repayment restores full ownership of the collateral.', {
    x: 8.5, y: 3.6, w: 3.9, h: 1.5, align: 'center', fontFace: 'Calibri', fontSize: 11.5, italic: true, color: 'E7ECFA', margin: 0,
  });

  s.addText('Collateral: active Chronos vault  •  Asset: USDC  •  Interest: flat, per loan', {
    x: 8.5, y: 5.6, w: 3.9, h: 0.6, align: 'center', fontFace: 'Calibri', fontSize: 9.5, color: '8993B5', margin: 0,
  });

  footer(s, 6, false);
}

// ---------------------------------------------------------------------------
// SLIDE 7 — Agentic Economy Track
// ---------------------------------------------------------------------------
{
  const s = pres.addSlide({ masterName: 'DARK' });
  s.addText('Agentic Economy Track: an agent that acts, not just chats', {
    x: 0.6, y: 0.5, w: 12.1, h: 0.9, fontFace: 'Cambria', fontSize: 28, bold: true, color: WHITE, margin: 0,
  });
  s.addText(
    'A vault owner can delegate their vault to the Chronos maintenance agent. At maturity, the agent submits the on-chain claim on the owner\'s behalf, no manual click, no missed unlock window, no gas paid by the user.',
    { x: 0.6, y: 1.5, w: 12.1, h: 0.85, fontFace: 'Calibri', fontSize: 14, color: 'CADCFC', margin: 0 }
  );

  const cols = [
    { icon: 'users', title: 'Delegate', body: 'The vault owner authorizes a specific agent address to call claimVault() on their vault via an on-chain delegate mapping.' },
    { icon: 'cpu', title: 'Circle Wallets', body: 'The agent operates from a Circle Developer-Controlled Wallet, a real, independently-held on-chain identity, not a shared backend key.' },
    { icon: 'zap', title: 'Gas Sponsorship', body: 'Transactions are sponsored through Pimlico\'s ERC-4337 paymaster, so the agent (and the user) never needs to hold native gas token to act.' },
    { icon: 'check', title: 'Autonomous Claim', body: 'Once a delegated vault matures, the agent detects it and submits the claim itself, on schedule, without a person in the loop.' },
  ];
  const colW = 2.85, gap = 0.28, startX = 0.6, startY = 2.65, cardH = 3.5;
  cols.forEach((c, i) => {
    const x = startX + i * (colW + gap);
    s.addShape('roundRect', { x, y: startY, w: colW, h: cardH, rectRadius: 0.1, fill: { color: NAVY_LIGHT }, line: { type: 'none' } });
    iconCircle(s, x + colW / 2 - 0.35, startY + 0.35, 0.7, c.icon, NAVY, AMBER);
    s.addText(c.title, { x: x + 0.2, y: startY + 1.25, w: colW - 0.4, h: 0.4, align: 'center', fontFace: 'Calibri', fontSize: 14, bold: true, color: WHITE, margin: 0 });
    s.addText(c.body, { x: x + 0.25, y: startY + 1.7, w: colW - 0.5, h: cardH - 1.9, align: 'center', fontFace: 'Calibri', fontSize: 10.5, color: 'CADCFC', margin: 0 });
  });

  footer(s, 7, true);
}

// ---------------------------------------------------------------------------
// SLIDE 8 — Tech stack
// ---------------------------------------------------------------------------
{
  const s = pres.addSlide({ masterName: 'LIGHT' });
  s.addText('Built on real infrastructure, not a simulation', {
    x: 0.6, y: 0.5, w: 12.1, h: 0.9, fontFace: 'Cambria', fontSize: 30, bold: true, color: NAVY, margin: 0,
  });

  // Two columns: Chain & Contracts / Application
  const colW = 5.85, gap = 0.5, x1 = 0.6, x2 = x1 + colW + gap, y0 = 1.7, colH = 5.0;

  s.addShape('roundRect', { x: x1, y: y0, w: colW, h: colH, rectRadius: 0.1, fill: { color: NAVY }, line: { type: 'none' } });
  s.addText('Chain & Contracts', { x: x1 + 0.35, y: y0 + 0.3, w: colW - 0.7, h: 0.45, fontFace: 'Calibri', fontSize: 17, bold: true, color: WHITE, margin: 0 });
  const chainItems = [
    'Arc Testnet, Circle\'s stablecoin-native L1 (native USDC gas)',
    'TimeLockVault.sol, CreditLine.sol, ScheduledPayment.sol (Solidity / Hardhat)',
    'Circle CCTP for native cross-chain USDC (Base, Arbitrum, Ethereum, OP Sepolia)',
    'Band Protocol oracle adapter for live price-gated unlocks',
    'Circle Developer-Controlled Wallets for the autonomous agent',
    'Pimlico bundler + paymaster (ERC-4337) for gas sponsorship',
  ];
  let cy = y0 + 0.95;
  chainItems.forEach((it) => {
    s.addShape('ellipse', { x: x1 + 0.35, y: cy + 0.08, w: 0.09, h: 0.09, fill: { color: AMBER }, line: { type: 'none' } });
    s.addText(it, { x: x1 + 0.62, y: cy - 0.08, w: colW - 1.0, h: 0.5, fontFace: 'Calibri', fontSize: 11.5, color: 'E7ECFA', margin: 0 });
    cy += 0.68;
  });

  s.addShape('roundRect', { x: x2, y: y0, w: colW, h: colH, rectRadius: 0.1, fill: { color: OFFWHITE }, line: { type: 'none' } });
  s.addText('Application', { x: x2 + 0.35, y: y0 + 0.3, w: colW - 0.7, h: 0.45, fontFace: 'Calibri', fontSize: 17, bold: true, color: NAVY, margin: 0 });
  const appItems = [
    'Next.js (App Router) and React frontend, Tailwind CSS',
    'Privy for authentication and embedded wallets (email or external wallet, one flow)',
    'Express.js backend, ethers.js for contract reads and relayed writes',
    'PostgreSQL (Supabase) for off-chain indexing and bridge-transaction tracking',
    'TanStack Query, Zustand, viem, Recharts',
    'Live proof-of-reserves, verified directly against on-chain contract state',
  ];
  cy = y0 + 0.95;
  appItems.forEach((it) => {
    s.addShape('ellipse', { x: x2 + 0.35, y: cy + 0.08, w: 0.09, h: 0.09, fill: { color: NAVY }, line: { type: 'none' } });
    s.addText(it, { x: x2 + 0.62, y: cy - 0.08, w: colW - 1.0, h: 0.5, fontFace: 'Calibri', fontSize: 11.5, color: BODY, margin: 0 });
    cy += 0.68;
  });

  footer(s, 8, false);
}

// ---------------------------------------------------------------------------
// SLIDE 9 — Status
// ---------------------------------------------------------------------------
{
  const s = pres.addSlide({ masterName: 'LIGHT' });
  s.addText('Where the build stands today', {
    x: 0.6, y: 0.5, w: 12.1, h: 0.9, fontFace: 'Cambria', fontSize: 30, bold: true, color: NAVY, margin: 0,
  });

  const stats = [
    { num: '6', label: 'vault modes live on testnet\n(Fixed, Flexible, Split, Streaming,\nOracle-Gated, Delegated)' },
    { num: '4', label: 'source chains supported for\ninbound CCTP deposits' },
    { num: '1', label: 'unified auth flow: email or wallet,\npowered by Privy' },
  ];
  const cW = 3.85, gap2 = 0.4, sx = 0.6, sy = 1.8, cH = 2.5;
  stats.forEach((st, i) => {
    const x = sx + i * (cW + gap2);
    s.addShape('roundRect', { x, y: sy, w: cW, h: cH, rectRadius: 0.1, fill: { color: NAVY }, line: { type: 'none' } });
    s.addText(st.num, { x, y: sy + 0.2, w: cW, h: 1.1, align: 'center', fontFace: 'Cambria', fontSize: 52, bold: true, color: AMBER, margin: 0 });
    s.addText(st.label, { x: x + 0.25, y: sy + 1.35, w: cW - 0.5, h: 1.0, align: 'center', fontFace: 'Calibri', fontSize: 11, color: 'E7ECFA', margin: 0 });
  });

  s.addText('Verified end-to-end on live testnet transactions', {
    x: 0.6, y: 4.6, w: 12.1, h: 0.45, fontFace: 'Calibri', fontSize: 16, bold: true, color: NAVY, margin: 0,
  });
  const checks = [
    'Email login to funded embedded wallet, with zero extra wallet pop-ups',
    'Full CCTP round trip: deposit, bridge, settle, claim back to source or to Arc',
    'Early withdrawal with penalty on FLEXIBLE vaults',
    'Smart Split vault creation and independent per-bucket claims',
    'CreditLine borrow, repay, and third-party lending deposits',
  ];
  let cy2 = 5.15;
  checks.forEach((c) => {
    iconCircle(s, 0.6, cy2, 0.3, 'check', WHITE, NAVY);
    s.addText(c, { x: 1.1, y: cy2 - 0.03, w: 11.4, h: 0.34, valign: 'middle', fontFace: 'Calibri', fontSize: 11.5, color: BODY, margin: 0 });
    cy2 += 0.33;
  });

  footer(s, 9, false);
}

// ---------------------------------------------------------------------------
// SLIDE 10 — Closing
// ---------------------------------------------------------------------------
{
  const s = pres.addSlide({ masterName: 'DARK' });

  s.addShape('ellipse', { x: 9.9, y: 4.6, w: 3.2, h: 3.2, fill: { type: 'none' }, line: { color: AMBER, width: 1.5 } });
  s.addShape('ellipse', { x: 10.35, y: 5.05, w: 2.3, h: 2.3, fill: { type: 'none' }, line: { color: '3E4E7E', width: 1.25 } });

  s.addText('Thank you', {
    x: 0.9, y: 2.6, w: 10, h: 1.1, fontFace: 'Cambria', fontSize: 46, bold: true, color: WHITE, margin: 0,
  });
  s.addText('Chronos: lock with discipline, unlock with intelligence.', {
    x: 0.95, y: 3.6, w: 9.5, h: 0.6, fontFace: 'Calibri', fontSize: 17, italic: true, color: 'CADCFC', margin: 0,
  });

  const links = [
    { label: 'Repository', value: 'github.com/ometere123/chronos' },
    { label: 'Network', value: 'Arc Testnet (Circle)' },
    { label: 'Tracks', value: 'DeFi  •  Agentic Economy' },
  ];
  let ly = 4.7;
  links.forEach((l) => {
    s.addText(l.label.toUpperCase(), { x: 0.95, y: ly, w: 2.2, h: 0.35, fontFace: 'Calibri', fontSize: 10.5, bold: true, color: AMBER, margin: 0, charSpacing: 1 });
    s.addText(l.value, { x: 3.2, y: ly, w: 7.5, h: 0.35, fontFace: 'Calibri', fontSize: 13, color: WHITE, margin: 0 });
    ly += 0.5;
  });

  footer(s, 10, true);
}

pres.writeFile({ fileName: 'Chronos-Checkpoint2.pptx' }).then(() => {
  console.log('written');
});
