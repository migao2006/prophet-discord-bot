CREATE TABLE channel_games (
  guild_id text NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  active_game text CHECK (active_game IS NULL OR active_game IN ('number_chain', 'bulls_and_cows')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, channel_id)
);

INSERT INTO channel_games (guild_id, channel_id, active_game)
SELECT guild_id, channel_id, 'number_chain'
FROM number_chain_channels
WHERE enabled = true
ON CONFLICT (guild_id, channel_id) DO UPDATE
SET active_game = EXCLUDED.active_game, updated_at = now();

CREATE TABLE bulls_and_cows_channels (
  guild_id text NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  secret_answer text CHECK (secret_answer IS NULL OR secret_answer ~ '^[0-9]{4}$'),
  guess_count integer NOT NULL DEFAULT 0 CHECK (guess_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, channel_id)
);
