import { errorCode } from '../../core/config.js';

const HEARTBEAT_MS = 5 * 60 * 1_000;

export class VoiceTracker {
  constructor(repository, logger) {
    this.repository = repository;
    this.logger = logger;
    this.heartbeat = null;
    this.client = null;
  }

  countedChannelId(state) {
    if (!state?.channelId || state.channelId === state.guild?.afkChannelId) return null;
    return state.channelId;
  }

  currentStates(guild) {
    return [...guild.voiceStates.cache.values()]
      .map((state) => ({ userId: state.id, channelId: this.countedChannelId(state) }))
      .filter((state) => state.channelId);
  }

  async initializeClient(client, at = new Date()) {
    this.client = client;
    for (const guild of client.guilds.cache.values()) {
      try {
        await this.initializeGuild(guild, at);
      } catch (error) {
        this.logger.error('voice_initialization_failed', {
          guildId: guild.id,
          errorCode: errorCode(error),
        });
      }
    }
    this.heartbeat = setInterval(() => {
      this.touchCurrentSessions().catch((error) => {
        this.logger.error('voice_heartbeat_failed', { errorCode: errorCode(error) });
      });
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  async initializeGuild(guild, at = new Date()) {
    await this.repository.reconcileVoiceSessions(guild.id, this.currentStates(guild), at);
  }

  async handleVoiceStateUpdate(oldState, newState, at = new Date()) {
    const oldChannelId = this.countedChannelId(oldState);
    const newChannelId = this.countedChannelId(newState);
    if (oldChannelId === newChannelId) return;
    const guildId = newState.guild?.id ?? oldState.guild?.id;
    const userId = newState.id ?? oldState.id;
    if (!guildId || !userId) return;
    await this.repository.transitionVoiceSession({ guildId, userId, channelId: newChannelId, at });
  }

  async touchCurrentSessions(at = new Date()) {
    if (!this.client) return;
    for (const guild of this.client.guilds.cache.values()) {
      await this.repository.reconcileVoiceSessions(guild.id, this.currentStates(guild), at);
    }
  }

  stop() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.client = null;
  }
}
