# CHRONOS

Multi-Token Time-Locked Savings & Vesting Infrastructure on Arc Testnet.

**Status:** Testnet Development (6-8 weeks to launch)

## Project Structure

```
CHRONOS/
├── contracts/              # Solidity smart contracts
│   ├── arc/               # Arc Testnet deployment
│   └── [testnets]/        # Source chain receivers
├── backend/               # Express.js + Supabase
│   ├── src/
│   │   ├── routes/        # API endpoints
│   │   ├── services/      # Business logic
│   │   ├── middleware/    # Auth, errors, logging
│   │   └── config/        # Constants, env
│   ├── package.json
│   └── .env.local
├── frontend/              # Next.js + React 18
│   ├── app/               # Next.js App Router
│   ├── components/        # React components
│   ├── services/          # API client
│   ├── hooks/             # React hooks
│   ├── store/             # Zustand stores
│   ├── package.json
│   └── .env.local
└── docs/                  # Documentation
```

## Quick Start

### Smart Contracts
```bash
cd contracts/arc
npm install
npm run compile
npm run test
npm run deploy
```

### Backend
```bash
cd backend
npm install
cp .env.example .env.local
npm run dev
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

## Architecture

- **Canonical Settlement:** Arc Testnet
- **Bridges:** Circle CCTP (stablecoins), LayerZero (any ERC-20)
- **Auth:** Injected wallet signatures
- **Database:** Supabase PostgreSQL
- **Frontend:** React 18 + Tailwind + Next.js

## Key Features

- ✅ FIXED vaults (0% penalty, immutable unlock)
- ✅ FLEXIBLE vaults (0.5% early withdrawal penalty)
- ✅ Multi-chain deposits (Base, Arbitrum, Ethereum → Arc)
- ✅ Add to vault (extend with new deposits)
- ✅ Proof of Reserves (real-time transparency)
- ✅ Countdown timers
- ✅ Custom lock durations (30 mins to 12 months)

## Success Criteria

- [ ] 500+ testnet users
- [ ] $100k–$500k TVL
- [ ] 100+ successful bridges
- [ ] >95% bridge success rate
- [ ] <5 min end-to-end vault creation
- [ ] 95%+ test coverage
- [ ] Zero critical bugs

## Environment Setup

See `.env.example` files in each directory.

## Documentation

- [Smart Contracts](./docs/contracts.md)
- [Backend API](./docs/backend.md)
- [Frontend Guide](./docs/frontend.md)

---

Built with precision for testnet discipline.

