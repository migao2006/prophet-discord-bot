import { memberActivityWindow, taipeiDateString } from './activity.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
const BLOCKS = '▁▂▃▄▅▆▇█';

export function renderTrend(values) {
  const maximum = Math.max(...values, 0);
  if (maximum === 0) return BLOCKS[0].repeat(values.length);
  return values.map((value) => BLOCKS[Math.round((value / maximum) * 7)]).join('');
}

export function serverStatsWindow(now = Date.now()) {
  const window = memberActivityWindow(now);
  const dates = Array.from({ length: 30 }, (_, index) => (
    taipeiDateString(window.startAt + index * DAY_MS)
  ));
  return { ...window, dates };
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
    const joinsByDate = new Map();
    const leavesByDate = new Map();
    for (const event of result.events) {
      const target = event.event_type === 'join' ? joinsByDate : leavesByDate;
      target.set(event.local_date, event.count);
    }
    const joins = window.dates.map((date) => joinsByDate.get(date) ?? 0);
    const leaves = window.dates.map((date) => leavesByDate.get(date) ?? 0);
    const newMembers = joins.reduce((sum, value) => sum + value, 0);
    const leftMembers = leaves.reduce((sum, value) => sum + value, 0);
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
      joinsTrend: renderTrend(joins),
      leavesTrend: renderTrend(leaves),
      trackingStartedAt,
      complete: trackingStartedAt !== null && trackingStartedAt <= window.startAt,
      skippedChannels,
    };
  }
}
