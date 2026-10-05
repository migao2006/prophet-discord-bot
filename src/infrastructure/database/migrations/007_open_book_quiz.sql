ALTER TABLE channel_games
  DROP CONSTRAINT IF EXISTS channel_games_active_game_check;

ALTER TABLE channel_games
  ADD CONSTRAINT channel_games_active_game_check
  CHECK (active_game IS NULL OR active_game IN (
    'number_chain', 'bulls_and_cows', 'idiom_chain', 'open_book_quiz'
  ));

CREATE TABLE open_book_questions (
  id bigserial PRIMARY KEY,
  source_id text NOT NULL UNIQUE,
  exam_year smallint NOT NULL,
  subject text NOT NULL CHECK (subject IN ('國文', '數學', '社會', '自然', '英語')),
  question_number text NOT NULL,
  question text NOT NULL,
  options jsonb NOT NULL,
  answer_index smallint NOT NULL CHECK (answer_index BETWEEN 0 AND 3),
  source_name text NOT NULL,
  source_version text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(options) = 'array'),
  CHECK (jsonb_array_length(options) = 4)
);

CREATE INDEX open_book_questions_subject_active_idx
  ON open_book_questions (subject)
  WHERE active = true;

CREATE TABLE open_book_question_imports (
  source_name text NOT NULL,
  source_version text NOT NULL,
  question_count integer NOT NULL CHECK (question_count > 0),
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_name, source_version)
);

CREATE TABLE open_book_quiz_channels (
  guild_id text NOT NULL REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  started_by text,
  subject text NOT NULL DEFAULT '全部'
    CHECK (subject IN ('全部', '國文', '數學', '社會', '自然', '英語')),
  current_question_id bigint REFERENCES open_book_questions(id),
  message_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, channel_id),
  CHECK ((enabled = false) OR (started_by IS NOT NULL AND current_question_id IS NOT NULL))
);

CREATE TABLE open_book_quiz_used (
  guild_id text NOT NULL,
  channel_id text NOT NULL,
  question_id bigint NOT NULL REFERENCES open_book_questions(id),
  used_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, channel_id, question_id),
  FOREIGN KEY (guild_id, channel_id)
    REFERENCES open_book_quiz_channels(guild_id, channel_id)
    ON DELETE CASCADE
);

CREATE TABLE open_book_quiz_answers (
  guild_id text NOT NULL,
  channel_id text NOT NULL,
  question_id bigint NOT NULL REFERENCES open_book_questions(id),
  user_id text NOT NULL,
  selected_index smallint NOT NULL CHECK (selected_index BETWEEN 0 AND 3),
  answered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, channel_id, question_id, user_id),
  FOREIGN KEY (guild_id, channel_id)
    REFERENCES open_book_quiz_channels(guild_id, channel_id)
    ON DELETE CASCADE
);
