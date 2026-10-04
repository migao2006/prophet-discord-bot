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
  // Global commands are available in every server where the bot is installed.
  for (const command of commands) {
    await rest.post(Routes.applicationCommands(config.DISCORD_APPLICATION_ID), {
      body: command.toJSON(),
    });
    console.log(`已註冊全域指令 /${command.name}`);
  }
  // Remove the former test-server commands so Discord does not show stale duplicates.
  if (config.DISCORD_GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(config.DISCORD_APPLICATION_ID, config.DISCORD_GUILD_ID),
      { body: [] },
    );
    console.log('已移除舊的伺服器專用指令');
  }
} catch (error) {
  console.error(`註冊失敗（${errorCode(error)}），請確認 Token 與 Application ID。`);
  process.exitCode = 1;
}
