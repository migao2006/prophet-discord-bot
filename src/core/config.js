export function readConfig(env = process.env, { registration = false } = {}) {
  const required = registration
    ? ['DISCORD_TOKEN', 'DISCORD_APPLICATION_ID']
    : ['DISCORD_TOKEN', 'DATABASE_URL'];
  const values = {};
  for (const name of required) {
    const value = env[name]?.trim();
    if (!value || value.startsWith('replace_with_')) {
      throw new Error(`請在 .env 設定 ${name}。`);
    }
    if (name.endsWith('_ID') && !/^\d{17,20}$/.test(value)) {
      throw new Error(`${name} 必須是 Discord 的數字 ID。`);
    }
    values[name] = value;
  }
  const guildId = env.DISCORD_GUILD_ID?.trim();
  if (guildId && !guildId.startsWith('replace_with_')) {
    if (!/^\d{17,20}$/.test(guildId)) {
      throw new Error('DISCORD_GUILD_ID 必須是 Discord 的數字 ID。');
    }
    values.DISCORD_GUILD_ID = guildId;
  }
  if (!registration) {
    const ssl = env.DATABASE_SSL?.trim().toLowerCase() ?? 'false';
    if (!['true', 'false'].includes(ssl)) {
      throw new Error('DATABASE_SSL 必須是 true 或 false。');
    }
    values.DATABASE_SSL = ssl === 'true';
  }
  return values;
}

// Avoid printing request bodies or tokens from third-party error objects.
export function errorCode(error) {
  const code = String(error?.code ?? 'UNKNOWN');
  return /^[A-Za-z0-9_\[\]-]{1,60}$/.test(code) ? code : 'UNKNOWN';
}
