ALTER TABLE channel_games DROP CONSTRAINT channel_games_active_game_check;
ALTER TABLE channel_games ADD CONSTRAINT channel_games_active_game_check
  CHECK (active_game IS NULL OR active_game IN (
    'number_chain', 'bulls_and_cows', 'idiom_chain', 'open_book_quiz', 'werewolf'
  ));

ALTER TABLE game_progress ADD COLUMN werewolf_wins bigint NOT NULL DEFAULT 0 CHECK (werewolf_wins >= 0);
ALTER TABLE game_xp_events DROP CONSTRAINT game_xp_events_game_type_check;
ALTER TABLE game_xp_events ADD CONSTRAINT game_xp_events_game_type_check
  CHECK (game_type IN ('number_chain', 'bulls_and_cows', 'idiom_chain', 'open_book_quiz', 'werewolf'));

CREATE TABLE werewolf_rooms (
  id uuid PRIMARY KEY,
  guild_id text NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  state jsonb NOT NULL,
  deadline timestamptz,
  revision integer NOT NULL DEFAULT 0,
  message_id text,
  dirty boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX werewolf_active_channel_idx ON werewolf_rooms (guild_id, channel_id) WHERE active;
CREATE INDEX werewolf_work_idx ON werewolf_rooms (deadline) WHERE active OR dirty;

-- One global reservation per Discord user, retained until the game ends.
CREATE TABLE werewolf_memberships (
  user_id text PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES werewolf_rooms(id) ON DELETE CASCADE
);
CREATE INDEX werewolf_memberships_room_idx ON werewolf_memberships (room_id);
