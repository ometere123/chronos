-- Create users table
CREATE TABLE IF NOT EXISTS users (
    address VARCHAR(255) PRIMARY KEY,
    auth_subject VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ,
    CONSTRAINT valid_address CHECK (address ~ '^0x[a-fA-F0-9]{40}$')
);

-- Create vaults table
CREATE TABLE IF NOT EXISTS vaults (
    vault_id VARCHAR(255) PRIMARY KEY,
    owner_address VARCHAR(255) NOT NULL REFERENCES users(address),
    total_amount NUMERIC(30, 6) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    unlock_at TIMESTAMPTZ NOT NULL,
    source_chain INTEGER NOT NULL,
    destination_chain INTEGER,
    bridge_protocol VARCHAR(20) NOT NULL CHECK (bridge_protocol = 'CCTP'),
    token_address VARCHAR(255),
    vault_type VARCHAR(20) NOT NULL CHECK (vault_type IN ('FIXED', 'FLEXIBLE')),
    status VARCHAR(20) NOT NULL CHECK (status IN ('ACTIVE', 'MATURE', 'CLAIMED', 'FAILED')),
    bridge_tx_hash VARCHAR(255),
    created_on_chain_tx VARCHAR(255),
    claimed_tx_hash VARCHAR(255),
    claimed_at TIMESTAMPTZ,
    CONSTRAINT positive_amount CHECK (total_amount > 0),
    CONSTRAINT unlock_after_create CHECK (unlock_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_vaults_owner ON vaults(owner_address);
CREATE INDEX IF NOT EXISTS idx_vaults_status ON vaults(status);
CREATE INDEX IF NOT EXISTS idx_vaults_unlock_at ON vaults(unlock_at);
CREATE INDEX IF NOT EXISTS idx_vaults_token ON vaults(token_address);

-- Smart Treasury Vaults: optional deposit-time split config (savings/yield/reserve buckets).
-- One vault row, three named sub-balances tracked alongside it. Bps columns sum to 10000 when set.
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS is_split BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS savings_bps INTEGER;
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS yield_bps INTEGER;
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS reserve_bps INTEGER;
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS savings_claimed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS yield_claimed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS reserve_claimed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_vaults_is_split ON vaults(is_split);

-- Streaming/tranche vaults: optional deposit-time schedule releasing the deposit over N equal
-- tranches at a fixed interval. Mirrors TimeLockVault.sol's numTranches/claimedTranches/intervalSeconds.
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS is_streaming BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS num_tranches INTEGER;
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS claimed_tranches INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS interval_seconds INTEGER;

CREATE INDEX IF NOT EXISTS idx_vaults_is_streaming ON vaults(is_streaming);

-- Create vault deposits table
CREATE TABLE IF NOT EXISTS vault_deposits (
    id BIGSERIAL PRIMARY KEY,
    vault_id VARCHAR(255) NOT NULL REFERENCES vaults(vault_id) ON DELETE CASCADE,
    amount NUMERIC(30, 6) NOT NULL,
    deposited_at TIMESTAMPTZ DEFAULT NOW(),
    source_chain INTEGER NOT NULL,
    bridge_tx_hash VARCHAR(255),
    bridge_protocol VARCHAR(20) NOT NULL CHECK (bridge_protocol = 'CCTP'),
    CONSTRAINT positive_deposit CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_deposits_vault ON vault_deposits(vault_id);
CREATE INDEX IF NOT EXISTS idx_deposits_chain ON vault_deposits(source_chain);

-- Create bridge transactions table
CREATE TABLE IF NOT EXISTS bridge_transactions (
    tx_hash VARCHAR(255) PRIMARY KEY,
    vault_id VARCHAR(255) NOT NULL REFERENCES vaults(vault_id) ON DELETE CASCADE,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND')),
    from_chain INTEGER NOT NULL,
    to_chain INTEGER NOT NULL,
    amount NUMERIC(30, 6) NOT NULL,
    bridge_protocol VARCHAR(20) NOT NULL CHECK (bridge_protocol = 'CCTP'),
    token_address VARCHAR(255),
    status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING', 'COMPLETE', 'FAILED')),
    attestation_data TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    retry_count INTEGER DEFAULT 0,
    CONSTRAINT positive_bridge_amount CHECK (amount > 0),
    CONSTRAINT max_retries CHECK (retry_count <= 10)
);

CREATE INDEX IF NOT EXISTS idx_bridge_vault ON bridge_transactions(vault_id);
CREATE INDEX IF NOT EXISTS idx_bridge_status ON bridge_transactions(status);
CREATE INDEX IF NOT EXISTS idx_bridge_tx_hash ON bridge_transactions(tx_hash);
CREATE INDEX IF NOT EXISTS idx_bridge_created ON bridge_transactions(created_at);

-- CCTP attestation state machine (Item 8): tracks progress through real Circle attestation
-- verification and settlement independent of the coarser `status` column above, so a backend
-- crash mid-flow can resume from the last confirmed state instead of getting stuck.
--   PENDING_ATTESTATION -> ATTESTED -> RECEIVED_ON_ARC -> VAULT_CREATED
ALTER TABLE bridge_transactions ADD COLUMN IF NOT EXISTS bridge_state VARCHAR(30)
    NOT NULL DEFAULT 'PENDING_ATTESTATION'
    CHECK (bridge_state IN ('PENDING_ATTESTATION', 'ATTESTED', 'RECEIVED_ON_ARC', 'VAULT_CREATED', 'FAILED'));
ALTER TABLE bridge_transactions ADD COLUMN IF NOT EXISTS bridge_state_updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_bridge_state ON bridge_transactions(bridge_state);

-- Create protocol stats table
CREATE TABLE IF NOT EXISTS protocol_stats (
    id BIGSERIAL PRIMARY KEY,
    total_locked NUMERIC(30, 6) NOT NULL,
    total_vaults INTEGER NOT NULL,
    total_users INTEGER NOT NULL,
    total_claimed NUMERIC(30, 6) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT positive_locked CHECK (total_locked >= 0)
);

CREATE INDEX IF NOT EXISTS idx_stats_updated ON protocol_stats(updated_at DESC);

-- Create audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    action VARCHAR(255) NOT NULL,
    user_address VARCHAR(255),
    vault_id VARCHAR(255),
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_address);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- Durable idempotency marker for on-chain vault settlement, written IMMEDIATELY after a
-- settleVault/settleSplitVault/settleStreamingVault/settleVaultAdvanced call succeeds on-chain,
-- BEFORE the vaults-table insert. Deliberately has NO foreign key to vaults - discovered live
-- that a DB-only failure after a successful on-chain settlement (e.g. a missing column) let a
-- retry re-run the entire on-chain settlement for the same burn tx, creating a second real
-- on-chain vault backed by the same single CCTP-bridged deposit and under-collateralizing the
-- protocol. This table lets a retry finish the interrupted DB write instead of re-settling.
CREATE TABLE IF NOT EXISTS vault_creation_settlements (
    source_tx_hash VARCHAR(255) PRIMARY KEY,
    on_chain_vault_id VARCHAR(255) NOT NULL,
    settlement_tx_hash VARCHAR(255),
    relayer_address VARCHAR(255),
    params JSONB NOT NULL,
    vault_persisted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vault_creation_settlements_vault_id ON vault_creation_settlements(on_chain_vault_id);
