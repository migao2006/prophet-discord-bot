import { readConfig, errorCode } from './core/config.js';
import { logger } from './core/logger.js';
import { createDatabase } from './infrastructure/database/client.js';
import { migrate } from './infrastructure/database/migrate.js';
import { createBot } from './app/create-bot.js';

let config;
try {
  config = readConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const database = createDatabase(config);
try {
  await migrate(database);
} catch (error) {
  logger.error('database_migration_failed', { errorCode: errorCode(error) });
  await database.end().catch(() => {});
  process.exit(1);
}

const { client, dispose } = await createBot({ database, logger });
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('bot_shutdown', { signal });
  dispose();
  await database.end().catch(() => {});
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await shutdown(signal);
    process.exit(0);
  });
}

try {
  await client.login(config.DISCORD_TOKEN);
} catch (error) {
  logger.error('discord_login_failed', { errorCode: errorCode(error) });
  await shutdown('login_failed');
  process.exitCode = 1;
}
