import './env.js';
import { createClient } from '@supabase/supabase-js';
import logger from './logger.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  logger.warn('Supabase credentials not configured. Using DATABASE_URL instead.');
}

// Initialize Supabase client for SQL queries
let supabase = null;

if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    logger.info('Supabase client initialized');
  } catch (err) {
    logger.error('Failed to initialize Supabase client', { error: err.message });
  }
}

// Alternatively, use direct PostgreSQL connection
import pg from 'pg';
const { Pool } = pg;

const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '5', 10),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '10000', 10),
  keepAlive: true,
  keepAliveInitialDelayMillis: parseInt(process.env.DB_KEEPALIVE_DELAY_MS || '10000', 10),
  maxUses: parseInt(process.env.DB_MAX_USES || '7500', 10),
};

if (poolConfig.connectionString) {
  poolConfig.ssl = {
    rejectUnauthorized: false
  };
}

const pool = new Pool(poolConfig);
const rawPoolQuery = pool.query.bind(pool);

function isTransientDatabaseError(err) {
  const message = err?.message || '';

  return (
    /Connection terminated unexpectedly/i.test(message) ||
    /Connection terminated due to connection timeout/i.test(message) ||
    /timeout exceeded when trying to connect/i.test(message) ||
    /ECONNRESET/i.test(message) ||
    /ETIMEDOUT/i.test(message) ||
    /server closed the connection unexpectedly/i.test(message) ||
    /terminating connection due to administrator command/i.test(message)
  );
}

pool.query = async (...args) => {
  if (typeof args[args.length - 1] === 'function') {
    return rawPoolQuery(...args);
  }

  try {
    return await rawPoolQuery(...args);
  } catch (err) {
    if (isTransientDatabaseError(err)) {
      logger.warn('Transient database query failure, retrying once', { error: err.message });
      return rawPoolQuery(...args);
    }

    throw err;
  }
};

pool.on('error', (err) => {
  logger.warn('Database closed an idle client; pool will replace it automatically', { error: err.message });
});

export { supabase, pool };

if (process.env.DATABASE_URL) {
  // Test connection
  pool.query('SELECT NOW()', (err, result) => {
    if (err) {
      logger.error('Database connection failed', { error: err.message });
    } else {
      logger.info('Database connected successfully', { timestamp: result.rows[0] });
    }
  });
} else {
  logger.warn('DATABASE_URL not configured; skipping database connection test');
}
