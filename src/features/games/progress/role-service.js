import { PermissionFlagsBits } from 'discord.js';
import { errorCode } from '../../../core/config.js';
import { LEVEL_TITLES, titleMinimumLevel } from './domain.js';

function roleName(level, title) {
  return `Lv.${level}｜${title}`;
}

export class GameLevelRoleService {
  constructor(repository, logger) {
    this.repository = repository;
    this.logger = logger;
  }

  async ensureRoles(guild) {
    const me = guild.members.me ?? await guild.members.fetchMe();
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      throw new Error('MISSING_MANAGE_ROLES');
    }
    const setting = await this.repository.getRoleSetting(guild.id);
    const roles = new Map();
    for (const [level, title] of LEVEL_TITLES) {
      let role = setting.roles.get(level)
        ? guild.roles.cache.get(setting.roles.get(level)) : null;
      if (!role) {
        role = await guild.roles.create({
          name: roleName(level, title),
          permissions: [],
          hoist: false,
          mentionable: false,
          reason: '遊戲等級稱號',
        });
        await this.repository.saveRole(guild.id, level, role.id);
      }
      roles.set(level, role);
    }
    return roles;
  }

  async syncMember(member, roles = null) {
    if (!member || member.user?.bot) return { changed: false };
    const setting = await this.repository.getRoleSetting(member.guild.id);
    if (!setting.enabled && !roles) return { changed: false };
    const available = roles ?? await this.ensureRoles(member.guild);
    const profile = await this.repository.getProfile(member.id);
    if (profile.totalXp <= 0) return { changed: false };
    const desiredLevel = titleMinimumLevel(profile.level);
    const desired = available.get(desiredLevel);
    const configuredIds = new Set([...available.values()].map((role) => role.id));
    const removable = member.roles.cache.filter(
      (role) => configuredIds.has(role.id) && role.id !== desired?.id,
    );
    const needsAdd = Boolean(desired && !member.roles.cache.has(desired.id));
    if (removable.size) await member.roles.remove([...removable.keys()], '更新遊戲等級稱號');
    if (needsAdd) {
      await member.roles.add(desired, '更新遊戲等級稱號');
    }
    return { changed: removable.size > 0 || needsAdd };
  }

  async syncGuild(guild) {
    const roles = await this.ensureRoles(guild);
    const members = await guild.members.fetch();
    let synced = 0;
    let failed = 0;
    for (const member of members.values()) {
      if (member.user.bot) continue;
      try {
        const result = await this.syncMember(member, roles);
        if (result.changed) synced += 1;
      } catch (error) {
        failed += 1;
        this.logger.error('game_level_role_member_sync_failed', {
          guildId: guild.id, userId: member.id, errorCode: errorCode(error),
        });
      }
    }
    return { synced, failed };
  }

  async removeGuildRoles(guild) {
    const setting = await this.repository.getRoleSetting(guild.id);
    const roleIds = new Set(setting.roles.values());
    const members = await guild.members.fetch();
    let removed = 0;
    let failed = 0;
    for (const member of members.values()) {
      if (member.user.bot) continue;
      const assigned = member.roles.cache.filter((role) => roleIds.has(role.id));
      if (!assigned.size) continue;
      try {
        await member.roles.remove([...assigned.keys()], '關閉遊戲等級稱號');
        removed += 1;
      } catch (error) {
        failed += 1;
        this.logger.error('game_level_role_remove_failed', {
          guildId: guild.id, userId: member.id, errorCode: errorCode(error),
        });
      }
    }
    return { removed, failed };
  }

  async syncUserAcrossGuilds(client, userId) {
    const enabled = new Set(await this.repository.listEnabledRoleGuildIds());
    for (const guild of client.guilds.cache.values()) {
      if (!enabled.has(guild.id)) continue;
      try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) await this.syncMember(member);
      } catch (error) {
        this.logger.error('game_level_role_cross_guild_sync_failed', {
          guildId: guild.id, userId, errorCode: errorCode(error),
        });
      }
    }
  }

  async handleMemberAdd(member) {
    if (member.user.bot) return;
    const setting = await this.repository.getRoleSetting(member.guild.id);
    if (setting.enabled) await this.syncMember(member);
  }
}
