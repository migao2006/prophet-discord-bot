import pg from 'pg';

const { Pool } = pg;

export function createDatabase(config) {
  return new Pool({
    connectionString: config.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    ...(config.DATABASE_SSL ? { ssl: { rejectUnauthorized: true } } : {}),
  });
}
