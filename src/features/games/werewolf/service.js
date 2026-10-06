import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { errorCode } from '../../../core/config.js';
import { KeyedTaskQueue } from '../../../core/keyed-task-queue.js';
import { GameRuleError, TERMINAL, requireRule } from './domain.js';
import { privatePayload, publicPayload } from './views.js';

export class WerewolfService {
  constructor(repository, progressService, logger) {
    this.repository = repository;
    this.progressService = progressService;
    this.logger = logger;
    this.queue = new KeyedTaskQueue();
    this.failures = new Map();
    this.client = null;
    this.timer = null;
    this.polling = false;
    this.stopped = false;
  }

  async initializeClient(client) {
    this.client = client;
    this.stopped = false;
    for (const room of await this.repository.listWork()) {
      try {
        if (!TERMINAL.has(room.state.phase)) await this.validatePlayers(room);
        await this.refresh(room.id, true);
      } catch (error) {
        this.logFailure('werewolf_restore_failed', room, error);
      }
    }
    this.timer = setInterval(() => {
      this.poll().catch((error) => this.logger.error('werewolf_poll_failed', { errorCode: errorCode(error) }));
    }, 2000);
    this.timer.unref();
    await this.poll();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
  }

  logFailure(event, room, error) {
    this.logger.error(event, { roomId: room.id, guildId: room.guildId, errorCode: errorCode(error) });
  }

  async validatePlayers(room) {
    const guild = this.client.guilds.cache.get(room.guildId);
    if (!guild) {
      await this.repository.cancel(room.id, '機器人已離開伺服器，遊戲取消。');
      return;
    }
    for (const player of room.state.players) {
      try {
        await guild.members.fetch(player.id);
      } catch (error) {
        if (Number(error.code) !== 10007) throw error;
        await this.repository.cancel(room.id, '參賽玩家已離開伺服器，遊戲取消。');
        return;
      }
    }
  }

  async refresh(id, force = false) {
    return this.queue.enqueue(id, async () => {
      const room = await this.repository.get(id);
      if (!room || this.stopped) return;
      if (force || room.dirty) {
        try {
          const channel = await this.client.channels.fetch(room.channelId);
          if (!channel?.send || channel.guildId !== room.guildId) throw Object.assign(new Error('Missing channel'), { code: 10003 });
          let message = null;
          if (room.messageId) {
            try {
              message = await channel.messages.fetch(room.messageId);
            } catch (error) {
              if (Number(error.code) !== 10008) throw error;
            }
          }
          const payload = publicPayload(room);
          if (message) await message.edit(payload);
          else message = await channel.send(payload);
          await this.repository.acknowledgePanel(id, room.revision, message.id);
          this.failures.delete(id);
        } catch (error) {
          this.logFailure('werewolf_panel_failed', room, error);
          const failures = (this.failures.get(id) ?? 0) + 1;
          this.failures.set(id, failures);
          if (!TERMINAL.has(room.state.phase)
            && (failures >= 3 || [10003, 50001, 50013].includes(Number(error.code)))) {
            await this.repository.cancel(id, '頻道無法使用，這局已取消。');
          } else if (TERMINAL.has(room.state.phase)) {
            // Do not keep an unreachable terminal panel in the polling queue.
            await this.repository.acknowledgePanel(id, room.revision, room.messageId);
          }
        }
      }
      // Rewards are already committed; their notifications cannot undo the game.
      if (room.state.effects.length) {
        let completed = true;
        for (const effect of room.state.effects) {
          try {
            await this.progressService.handleAward(this.client, room.guildId, effect.userId, effect.progress);
          } catch (error) {
            completed = false;
            this.logFailure('werewolf_reward_delivery_failed', room, error);
          }
        }
        if (completed) await this.repository.acknowledgeEffects(id);
      }
    });
  }

  async poll() {
    if (this.polling || this.stopped) return;
    this.polling = true;
    try {
      for (const room of await this.repository.listWork()) {
        try {
          if (!TERMINAL.has(room.state.phase) && Date.now() >= room.state.deadline) {
            await this.repository.expire(room.id, room.revision);
          }
          await this.refresh(room.id);
        } catch (error) {
          if (!(error instanceof GameRuleError)) this.logFailure('werewolf_phase_failed', room, error);
        }
      }
    } finally {
      this.polling = false;
    }
  }

  async command(interaction, operation) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    this.client ??= interaction.client;
    try {
      let room;
      if (operation === '開啟') {
        room = await this.repository.create(interaction.guildId, interaction.channelId, interaction.user.id);
      } else {
        room = await this.repository.getActive(interaction.guildId, interaction.channelId);
        requireRule(room, '這個頻道目前沒有狼人殺房間。');
        if (operation === '開始') await this.validatePlayers(room);
        room = await this.repository.control(room.id, room.revision, interaction.user.id,
          operation === '開始' ? 'start' : 'cancel',
          interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false,
          { guildId: interaction.guildId, channelId: interaction.channelId });
      }
      await this.refresh(room.id);
      await interaction.editReply(operation === '開啟'
        ? '狼人殺房間開好啦～🐺 到公開面板邀朋友加入吧！'
        : operation === '開始' ? '天黑請閉眼～🌙 到公開面板查看你的身分！' : '這局已取消，先休息一下吧～🌙');
    } catch (error) {
      if (!(error instanceof GameRuleError)) throw error;
      await interaction.editReply(error.message);
    }
  }

  async handleComponent(interaction) {
    if (!interaction.customId?.startsWith('ww:')) return false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    this.client ??= interaction.client;
    try {
      const match = /^ww:([0-9a-f-]{36}):(\d+):(join|leave|start|cancel|identity|panel|choose)$/.exec(interaction.customId);
      requireRule(match && interaction.guildId && !interaction.user?.bot, '這個操作無效。');
      const [, id, rawRevision, action] = match;
      const revision = Number(rawRevision);
      const room = await this.repository.get(id);
      requireRule(room && room.guildId === interaction.guildId && room.channelId === interaction.channelId, '請回到本局頻道操作。');
      requireRule(room.revision === revision, '這個面板已過期，請使用最新面板。');
      if (action === 'identity' || action === 'panel') {
        await interaction.editReply(privatePayload(room, interaction.user.id, action, interaction.guild));
      } else if (action === 'choose') {
        requireRule(interaction.isStringSelectMenu?.() && interaction.values?.length === 1, '請使用選單作答。');
        await this.repository.action(id, revision, interaction.user.id, interaction.values[0],
          { guildId: interaction.guildId, channelId: interaction.channelId });
        await interaction.editReply('已記下你的選擇～🐾 截止前可重新開啟面板更改。');
      } else {
        requireRule(interaction.isButton?.(), '請使用房間按鈕。');
        if (action === 'start') await this.validatePlayers(room);
        await this.repository.control(id, revision, interaction.user.id, action,
          interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false,
          { guildId: interaction.guildId, channelId: interaction.channelId });
        await this.refresh(id);
        await interaction.editReply({ content: '已更新房間～🐾 請查看公開面板。', components: [] });
      }
    } catch (error) {
      if (!(error instanceof GameRuleError)) throw error;
      await interaction.editReply({ content: error.message, components: [] });
    }
    return true;
  }

  async handleMemberRemove(member) {
    const id = await this.repository.participantRoom(member.id);
    if (!id) return;
    const room = await this.repository.get(id);
    if (room?.guildId !== member.guild.id) return;
    try {
      await this.repository.cancel(id, '參賽玩家離開伺服器，這局已取消。');
      await this.refresh(id);
    } catch (error) {
      if (!(error instanceof GameRuleError)) throw error;
    }
  }

  async handleChannelDelete(channel) {
    if (!channel.guildId) return;
    const room = await this.repository.getActive(channel.guildId, channel.id);
    if (room) await this.repository.cancel(room.id, '遊戲頻道已刪除，這局已取消。');
  }

  async handleMessageDelete(message) {
    if (!message.guildId) return;
    const room = await this.repository.getActive(message.guildId, message.channelId);
    if (room?.messageId === message.id) await this.refresh(room.id, true);
  }
}
