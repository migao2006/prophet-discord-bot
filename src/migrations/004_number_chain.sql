CREATE TABLE number_chain_channels (
  guild_id text NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  current_number numeric NOT NULL DEFAULT 0 CHECK (current_number >= 0 AND scale(current_number) = 0),
  last_user_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, channel_id)
);
