CREATE TABLE guild_level_notification_settings (
  guild_id text PRIMARY KEY REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  channel_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT enabled OR channel_id IS NOT NULL)
);
