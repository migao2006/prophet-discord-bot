CREATE TABLE game_progress (
  user_id text PRIMARY KEY,
  total_xp bigint NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
  number_chain_successes bigint NOT NULL DEFAULT 0 CHECK (number_chain_successes >= 0),
  bulls_and_cows_wins bigint NOT NULL DEFAULT 0 CHECK (bulls_and_cows_wins >= 0),
  idiom_chain_successes bigint NOT NULL DEFAULT 0 CHECK (idiom_chain_successes >= 0),
  open_book_correct bigint NOT NULL DEFAULT 0 CHECK (open_book_correct >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX game_progress_ranking_idx ON game_progress (total_xp DESC, updated_at, user_id);

CREATE TABLE game_xp_events (
  event_key text PRIMARY KEY,
  user_id text NOT NULL,
  guild_id text NOT NULL,
  channel_id text NOT NULL,
  game_type text NOT NULL CHECK (game_type IN (
    'number_chain', 'bulls_and_cows', 'idiom_chain', 'open_book_quiz'
  )),
  xp integer NOT NULL CHECK (xp > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX game_xp_events_user_idx ON game_xp_events (user_id, created_at DESC);

CREATE TABLE guild_game_level_settings (
  guild_id text PRIMARY KEY REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE guild_game_level_roles (
  guild_id text NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  minimum_level smallint NOT NULL CHECK (minimum_level BETWEEN 1 AND 100),
  role_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, minimum_level),
  UNIQUE (guild_id, role_id)
);
