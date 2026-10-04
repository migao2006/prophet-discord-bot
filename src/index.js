import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { readConfig, errorCode } from './config.js';
import { handleInteraction } from './commands.js';

let config;
try {
  config = readConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once(Events.ClientReady, (readyClient) => {
  console.log(`已上線：${readyClient.user.tag}`);
});
client.on(Events.Error, (error) => console.error(`Discord 連線錯誤：${errorCode(error)}`));
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await handleInteraction(interaction);
  } catch (error) {
    console.error(`指令執行失敗：${errorCode(error)}`);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '處理失敗，請稍後再試。', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    console.log('正在關閉機器人。');
    await client.destroy();
    process.exit(0);
  });
}

try {
  await client.login(config.DISCORD_TOKEN);
} catch (error) {
  console.error(`登入失敗（${errorCode(error)}），請檢查 Bot Token 與網路連線。`);
  await client.destroy();
  process.exitCode = 1;
}
