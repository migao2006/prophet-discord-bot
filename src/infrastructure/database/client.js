import pg from 'pg';

const { Pool } = pg;

export function normalizeConnectionString(connectionString, sslEnabled) {
  if (!sslEnabled) {
    return connectionString;
  }

  const url = new URL(connectionString);
  url.searchParams.delete('sslmode');
  url.searchParams.delete('uselibpqcompat');
  return url.toString();
}

export function createDatabase(config) {
  return new Pool({
    connectionString: normalizeConnectionString(config.DATABASE_URL, config.DATABASE_SSL),
    max: 5,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    ...(config.DATABASE_SSL ? { ssl: { rejectUnauthorized: true } } : {}),
  });
}
