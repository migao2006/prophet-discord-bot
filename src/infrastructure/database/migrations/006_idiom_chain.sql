ALTER TABLE channel_games
  DROP CONSTRAINT IF EXISTS channel_games_active_game_check;

ALTER TABLE channel_games
  ADD CONSTRAINT channel_games_active_game_check
  CHECK (active_game IS NULL OR active_game IN ('number_chain', 'bulls_and_cows', 'idiom_chain'));

CREATE TABLE idioms (
  idiom text PRIMARY KEY,
  pronunciation text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  source_name text NOT NULL,
  source_version text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(idiom) = 4)
);

CREATE INDEX idioms_first_character_active_idx
  ON idioms ((left(idiom, 1)))
  WHERE active = true;

CREATE TABLE idiom_dictionary_imports (
  source_name text NOT NULL,
  source_version text NOT NULL,
  entry_count integer NOT NULL CHECK (entry_count > 0),
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_name, source_version)
);

CREATE TABLE idiom_chain_channels (
  guild_id text NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  current_idiom text REFERENCES idioms(idiom),
  last_user_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, channel_id),
  CHECK ((enabled = false) OR (current_idiom IS NOT NULL))
);

CREATE TABLE idiom_chain_used (
  guild_id text NOT NULL,
  channel_id text NOT NULL,
  idiom text NOT NULL REFERENCES idioms(idiom),
  used_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, channel_id, idiom),
  FOREIGN KEY (guild_id, channel_id)
    REFERENCES idiom_chain_channels(guild_id, channel_id)
    ON DELETE CASCADE
);
