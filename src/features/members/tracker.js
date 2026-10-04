import { startOfTaipeiDay } from '../activity/domain.js';
import { errorCode } from '../../core/config.js';
import { KeyedTaskQueue } from '../../core/keyed-task-queue.js';

const DAY_MS = 24 * 60 * 60 * 1_000;

export class MemberTracker {
  constructor(repository, logger) {
    this.repository = repository;
    this.logger = logger;
    this.queue = new KeyedTaskQueue();
  }

  enqueue(guildId, task) {
    return this.queue.enqueue(guildId, task);
  }

  serializeMember(member, fallback = new Date()) {
    return {
      userId: member.id,
      joinedAt: member.joinedAt ?? fallback,
    };
  }

  async initializeClient(client, now = Date.now()) {
    for (const guild of client.guilds.cache.values()) {
      try {
        await this.initializeGuild(guild, now);
      } catch (error) {
        this.logger.error('member_roster_sync_failed', {
          guildId: guild.id,
          errorCode: errorCode(error),
        });
      }
    }
  }

  async initializeGuild(guild, now = Date.now()) {
    return this.enqueue(guild.id, async () => {
      const fetched = await guild.members.fetch();
      const at = new Date(now);
      const cutoff = new Date(startOfTaipeiDay(now) - 29 * DAY_MS);
      const members = [...fetched.values()]
        .filter((member) => !member.user.bot)
        .map((member) => this.serializeMember(member, at));
      const result = await this.repository.syncMembers(guild.id, members, cutoff, at);
      this.logger.info('member_roster_synced', { guildId: guild.id, ...result });
      return result;
    });
  }

  async handleMemberAdd(member, at = new Date()) {
    if (member.user.bot) return false;
    return this.enqueue(member.guild.id, () => this.repository.addMember(
      member.guild.id,
      member.id,
      member.joinedAt ?? at,
      at,
    ));
  }

  async handleMemberRemove(member, at = new Date()) {
    if (member.user.bot) return false;
    return this.enqueue(
      member.guild.id,
      () => this.repository.removeMember(member.guild.id, member.id, at),
    );
  }
}
