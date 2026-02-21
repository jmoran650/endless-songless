const { Pool } = require('pg');

const databaseUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('SUPABASE_DB_URL or DATABASE_URL is not set. Configure server/.env before starting.');
}

const poolMax = Number(process.env.DB_POOL_MAX || 20);
const idleTimeoutMillis = Number(process.env.DB_IDLE_TIMEOUT_MS || 30_000);
const connectionTimeoutMillis = Number(process.env.DB_CONNECT_TIMEOUT_MS || 10_000);
const statementTimeout = Number(process.env.DB_STATEMENT_TIMEOUT_MS || 15_000);
const queryTimeout = Number(process.env.DB_QUERY_TIMEOUT_MS || 15_000);

const usesSupabaseManagedHost = /(?:pooler\.)?supabase\.(?:com|in)/i.test(databaseUrl);
const shouldUseSsl = usesSupabaseManagedHost && process.env.PGSSLMODE !== 'disable';

const pool = new Pool({
  connectionString: databaseUrl,
  max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 20,
  idleTimeoutMillis:
    Number.isFinite(idleTimeoutMillis) && idleTimeoutMillis > 0 ? idleTimeoutMillis : 30_000,
  connectionTimeoutMillis:
    Number.isFinite(connectionTimeoutMillis) && connectionTimeoutMillis > 0
      ? connectionTimeoutMillis
      : 10_000,
  statement_timeout:
    Number.isFinite(statementTimeout) && statementTimeout > 0 ? statementTimeout : 15_000,
  query_timeout: Number.isFinite(queryTimeout) && queryTimeout > 0 ? queryTimeout : 15_000,
  application_name: process.env.DB_APPLICATION_NAME || 'songless-server',
  ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (error) => {
  console.error('Postgres pool error:', error);
});

function isUniqueViolation(error, constraintName) {
  if (!error || error.code !== '23505') {
    return false;
  }
  if (!constraintName) {
    return true;
  }
  return error.constraint === constraintName;
}

async function withDbSession(options, handler) {
  const run = typeof options === 'function' ? options : handler;
  const sessionOptions = typeof options === 'function' ? {} : (options || {});
  const userId = sessionOptions.userId ? String(sessionOptions.userId) : '';
  const requestId = sessionOptions.requestId ? String(sessionOptions.requestId) : '';
  const backendFlag = sessionOptions.backend === true ? 'true' : 'false';

  if (typeof run !== 'function') {
    throw new Error('withDbSession requires a handler function.');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query("select set_config('songless.user_id', $1, true)", [userId]);
    await client.query("select set_config('songless.request_id', $1, true)", [requestId]);
    await client.query("select set_config('songless.backend', $1, true)", [backendFlag]);

    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Rollback failed:', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

async function query(text, params = [], options = {}) {
  return withDbSession(options, (client) => client.query(text, params));
}

module.exports = {
  pool,
  query,
  withDbSession,
  isUniqueViolation,
};
