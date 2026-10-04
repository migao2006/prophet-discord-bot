import { memberActivityWindow } from '../activity/domain.js';

export function serverStatsWindow(now = Date.now()) {
  return memberActivityWindow(now);
}

export class ServerStatsService {
  constructor(memberRepository, activityTracker) {
    this.memberRepository = memberRepository;
    this.activityTracker = activityTracker;
  }

  async getStats(guild, botUser, now = Date.now()) {
    const { readable, skippedChannels } = await this.activityTracker.catchUpGuild(guild, botUser);
    const window = serverStatsWindow(now);
    const result = await this.memberRepository.getServerStats(
      guild.id,
      window.startDate,
      new Date(window.startAt),
      new Date(window.endAt),
      readable.map((channel) => channel.id),
    );
    const newMembers = result.events
      .filter((event) => event.event_type === 'join')
      .reduce((sum, event) => sum + event.count, 0);
    const leftMembers = result.events
      .filter((event) => event.event_type === 'leave')
      .reduce((sum, event) => sum + event.count, 0);
    const netGrowth = newMembers - leftMembers;
    const startingMembers = Math.max(result.currentMembers - netGrowth, 0);
    const growthRate = startingMembers > 0 ? (netGrowth / startingMembers) * 100 : null;
    const trackingStartedAt = result.trackingStartedAt
      ? new Date(result.trackingStartedAt).getTime()
      : null;

    return {
      ...window,
      currentMembers: result.currentMembers,
      newMembers,
      leftMembers,
      activeMembers: result.activeMembers,
      sleepingMembers: Math.max(result.currentMembers - result.activeMembers, 0),
      netGrowth,
      growthRate,
      trackingStartedAt,
      complete: trackingStartedAt !== null && trackingStartedAt <= window.startAt,
      skippedChannels,
    };
  }
}
