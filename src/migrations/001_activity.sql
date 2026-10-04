CREATE TABLE guild_settings (
  guild_id text PRIMARY KEY,
  timezone text NOT NULL DEFAULT 'Asia/Taipei',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE guild_tracking_state (
  guild_id text PRIMARY KEY REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  tracking_started_at timestamptz NOT NULL
);

CREATE TABLE daily_message_counts (
  guild_id text NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  user_id text NOT NULL,
  local_date date NOT NULL,
  message_count integer NOT NULL CHECK (message_count >= 0),
  PRIMARY KEY (guild_id, channel_id, user_id, local_date)
);

CREATE INDEX daily_message_counts_lookup
  ON daily_message_counts (guild_id, user_id, local_date);

CREATE TABLE processed_messages (
  message_id text PRIMARY KEY,
  guild_id text NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  user_id text NOT NULL,
  local_date date NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX processed_messages_created_at ON processed_messages (created_at);

CREATE TABLE channel_cursors (
  guild_id text NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  last_message_id text,
  last_message_timestamp bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, channel_id)
);
