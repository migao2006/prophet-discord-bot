import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConnectionString } from '../src/infrastructure/database/client.js';

test('removes connection-string SSL modes when explicit TLS is enabled', () => {
  const result = normalizeConnectionString(
    'postgresql://user:password@example.com:5432/app?sslmode=require&application_name=bot',
    true,
  );
  const url = new URL(result);

  assert.equal(url.searchParams.has('sslmode'), false);
  assert.equal(url.searchParams.get('application_name'), 'bot');
});

test('leaves the connection string unchanged when explicit TLS is disabled', () => {
  const connectionString = 'postgresql://user:password@example.com:5432/app?sslmode=require';
  assert.equal(normalizeConnectionString(connectionString, false), connectionString);
});
