ALTER TABLE guild_tracking_state
  ADD COLUMN voice_tracking_started_at timestamptz;

ALTER TABLE channel_cursors
  ADD COLUMN history_before_id text,
  ADD COLUMN history_cutoff_at timestamptz,
  ADD COLUMN history_started_at timestamptz,
  ADD COLUMN history_completed_at timestamptz;

CREATE TABLE voice_sessions (
  id bigserial PRIMARY KEY,
  guild_id text NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  channel_id text NOT NULL,
  joined_at timestamptz NOT NULL,
  left_at timestamptz,
  last_seen_at timestamptz NOT NULL,
  CHECK (left_at IS NULL OR left_at >= joined_at)
);

CREATE UNIQUE INDEX voice_sessions_one_open
  ON voice_sessions (guild_id, user_id) WHERE left_at IS NULL;

CREATE INDEX voice_sessions_activity_lookup
  ON voice_sessions (guild_id, user_id, joined_at, left_at);
