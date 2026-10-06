export const GAME_XP = Object.freeze({
  number_chain: 4,
  bulls_and_cows: 50,
  idiom_chain: 16,
  open_book_quiz: 20,
  werewolf: 100,
});

export const LEVEL_TITLES = Object.freeze([
  [1, '小小萌芽'], [5, '好奇毛球'], [10, '探索小貓'], [15, '靈感小狐'],
  [20, '智慧小鹿'], [25, '勤學水獺'], [30, '解謎浣熊'], [35, '冒險兔兔'],
  [40, '星光旅人'], [45, '月夜精靈'], [50, '閃耀新星'], [55, '聰明雪貂'],
  [60, '榮耀飛鳥'], [65, '夢境守護者'], [70, '遊戲魔法師'], [75, '智慧召喚師'],
  [80, '幻境大師'], [85, '星河賢者'], [90, '傳說精靈'], [95, '巔峰守護神'],
  [100, '永恆預言者'],
]);

export const LEVEL_TITLE_COLORS = Object.freeze(new Map([
  [1, 0x7FC8A9], [5, 0xE8A8C8], [10, 0x74B9E6], [15, 0xB28DDA],
  [20, 0x64C3B5], [25, 0xC9A66B], [30, 0x9C83C7], [35, 0xE58BA8],
  [40, 0x559FDB], [45, 0x746CC0], [50, 0xE7B83D], [55, 0x8FC49D],
  [60, 0x55AFC2], [65, 0x856FC0], [70, 0x9656CF], [75, 0xC85AA5],
  [80, 0x596BD1], [85, 0x405FB8], [90, 0x7040A0], [95, 0xB97A2D],
  [100, 0xD9A928],
]));

export function xpForLevel(level) {
  const safeLevel = Math.min(100, Math.max(1, Math.trunc(level)));
  return 25 * (safeLevel - 1) * safeLevel;
}

export function levelForXp(totalXp) {
  const xp = Math.max(0, Number(totalXp));
  return Math.min(100, Math.floor((1 + Math.sqrt(1 + (4 * xp) / 25)) / 2));
}

export function titleForLevel(level) {
  let current = LEVEL_TITLES[0][1];
  for (const [minimumLevel, title] of LEVEL_TITLES) {
    if (level < minimumLevel) break;
    current = title;
  }
  return current;
}

export function titleMinimumLevel(level) {
  let current = 1;
  for (const [minimumLevel] of LEVEL_TITLES) {
    if (level < minimumLevel) break;
    current = minimumLevel;
  }
  return current;
}

export function progressForXp(totalXp) {
  const xp = Number(totalXp);
  const level = levelForXp(xp);
  const currentFloor = xpForLevel(level);
  const nextFloor = level === 100 ? null : xpForLevel(level + 1);
  return {
    totalXp: xp,
    level,
    title: titleForLevel(level),
    currentFloor,
    nextFloor,
    progress: nextFloor === null ? 1 : (xp - currentFloor) / (nextFloor - currentFloor),
  };
}

export function levelUpText(userId, level) {
  return `🌟 <@${userId}> 升到 **Lv.${level}「${titleForLevel(level)}」** 啦！`;
}
