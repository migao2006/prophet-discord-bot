import { REST, Routes } from 'discord.js';
import { readConfig, errorCode } from './config.js';
import { commands } from './commands.js';

let config;
try {
  config = readConfig(process.env, { registration: true });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
try {
  // POST upserts commands by name without deleting unrelated guild commands.
  for (const command of commands) {
    await rest.post(Routes.applicationGuildCommands(config.DISCORD_APPLICATION_ID, config.DISCORD_GUILD_ID), {
      body: command.toJSON(),
    });
    console.log(`已註冊 /${command.name}`);
  }
} catch (error) {
  console.error(`註冊失敗（${errorCode(error)}），請確認 Token、Application ID、Server ID，以及機器人已加入伺服器。`);
  process.exitCode = 1;
}
