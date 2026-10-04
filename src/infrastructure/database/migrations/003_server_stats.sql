ALTER TABLE guild_tracking_state
  ADD COLUMN member_tracking_started_at timestamptz;

CREATE TABLE guild_members_current (
  guild_id text NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  joined_at timestamptz NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE guild_member_events (
  id bigserial PRIMARY KEY,
  guild_id text NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('join', 'leave')),
  occurred_at timestamptz NOT NULL,
  source text NOT NULL CHECK (source IN ('initial', 'gateway', 'reconcile')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, user_id, event_type, occurred_at)
);

CREATE INDEX guild_member_events_stats_lookup
  ON guild_member_events (guild_id, occurred_at, event_type);
