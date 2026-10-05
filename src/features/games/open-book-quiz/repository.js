import {
  GAME_TYPE,
  lockChannelGame,
  setActiveChannelGame,
} from '../channel-game-registry.js';

function toQuestion(row, prefix = '') {
  const get = (name) => row[`${prefix}${name}`];
  return {
    id: Number(get('id')),
    subject: get('subject'),
    question: get('question'),
    options: get('options'),
    answerIndex: get('answer_index'),
  };
}

async function pickQuestion(client, guildId, channelId, subject, avoidId = null) {
  const query = async () => client.query(
    `SELECT q.id, q.subject, q.question, q.options, q.answer_index
     FROM open_book_questions q
     WHERE q.active = true
       AND ($3 = '全部' OR q.subject = $3)
       AND ($4::bigint IS NULL OR q.id <> $4)
       AND NOT EXISTS (
         SELECT 1 FROM open_book_quiz_used used
         WHERE used.guild_id = $1 AND used.channel_id = $2 AND used.question_id = q.id
       )
     ORDER BY random()
     LIMIT 1`,
    [guildId, channelId, subject, avoidId],
  );
  let result = await query();
  if (result.rowCount === 0) {
    await client.query(
      'DELETE FROM open_book_quiz_used WHERE guild_id = $1 AND channel_id = $2',
      [guildId, channelId],
    );
    result = await query();
  }
  if (result.rowCount === 0 && avoidId !== null) {
    const fallback = await client.query(
      `SELECT id, subject, question, options, answer_index
       FROM open_book_questions
       WHERE active = true AND ($1 = '全部' OR subject = $1)
       ORDER BY random() LIMIT 1`,
      [subject],
    );
    result = fallback;
  }
  if (!result.rows[0]) throw new Error(`開卷有益沒有可用題目：${subject}`);
  return toQuestion(result.rows[0]);
}

export class OpenBookQuizRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async setEnabled(guildId, channelId, enabled, { userId, isAdmin = false, subject = '全部' }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO guild_settings (guild_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [guildId],
      );
      const activeGame = await lockChannelGame(client, guildId, channelId);
      const existing = await client.query(
        `SELECT enabled, started_by, subject, current_question_id, message_id
         FROM open_book_quiz_channels
         WHERE guild_id = $1 AND channel_id = $2
         FOR UPDATE`,
        [guildId, channelId],
      );
      const state = existing.rows[0];

      if (enabled && activeGame && activeGame !== GAME_TYPE.openBookQuiz) {
        await client.query('COMMIT');
        return { changed: false, enabled: false, conflict: activeGame };
      }
      if (enabled && state?.enabled) {
        const questionResult = await client.query(
          `SELECT id, subject, question, options, answer_index
           FROM open_book_questions WHERE id = $1`,
          [state.current_question_id],
        );
        await client.query('COMMIT');
        return {
          changed: false,
          enabled: true,
          startedBy: state.started_by,
          selectedSubject: state.subject,
          question: toQuestion(questionResult.rows[0]),
        };
      }

      if (enabled) {
        const question = await pickQuestion(client, guildId, channelId, subject);
        await client.query(
          `INSERT INTO open_book_quiz_channels
             (guild_id, channel_id, enabled, started_by, subject, current_question_id, message_id)
           VALUES ($1, $2, true, $3, $4, $5, NULL)
           ON CONFLICT (guild_id, channel_id) DO UPDATE SET
             enabled = true, started_by = EXCLUDED.started_by, subject = EXCLUDED.subject,
             current_question_id = EXCLUDED.current_question_id, message_id = NULL,
             updated_at = now()`,
          [guildId, channelId, userId, subject, question.id],
        );
        await client.query(
          'DELETE FROM open_book_quiz_used WHERE guild_id = $1 AND channel_id = $2',
          [guildId, channelId],
        );
        await client.query(
          'DELETE FROM open_book_quiz_answers WHERE guild_id = $1 AND channel_id = $2',
          [guildId, channelId],
        );
        await client.query(
          `INSERT INTO open_book_quiz_used (guild_id, channel_id, question_id)
           VALUES ($1, $2, $3)`,
          [guildId, channelId, question.id],
        );
        await setActiveChannelGame(client, guildId, channelId, GAME_TYPE.openBookQuiz);
        await client.query('COMMIT');
        return { changed: true, enabled: true, selectedSubject: subject, question };
      }

      if (!state?.enabled) {
        await client.query('COMMIT');
        return { changed: false, enabled: false };
      }
      if (!isAdmin && state.started_by !== userId) {
        await client.query('COMMIT');
        return { changed: false, enabled: true, forbidden: true };
      }
      await client.query(
        `UPDATE open_book_quiz_channels
         SET enabled = false, started_by = NULL, current_question_id = NULL,
             message_id = NULL, updated_at = now()
         WHERE guild_id = $1 AND channel_id = $2`,
        [guildId, channelId],
      );
      await client.query(
        'DELETE FROM open_book_quiz_answers WHERE guild_id = $1 AND channel_id = $2',
        [guildId, channelId],
      );
      await client.query(
        'DELETE FROM open_book_quiz_used WHERE guild_id = $1 AND channel_id = $2',
        [guildId, channelId],
      );
      if (activeGame === GAME_TYPE.openBookQuiz) {
        await setActiveChannelGame(client, guildId, channelId, null);
      }
      await client.query('COMMIT');
      return { changed: true, enabled: false, messageId: state.message_id };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async submitAnswer(guildId, channelId, questionId, userId, selectedIndex) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const stateResult = await client.query(
        `SELECT enabled, subject, current_question_id
         FROM open_book_quiz_channels
         WHERE guild_id = $1 AND channel_id = $2
         FOR UPDATE`,
        [guildId, channelId],
      );
      const state = stateResult.rows[0];
      if (!state?.enabled) {
        await client.query('COMMIT');
        return { status: 'disabled' };
      }
      if (Number(state.current_question_id) !== questionId) {
        await client.query('COMMIT');
        return { status: 'stale' };
      }
      const questionResult = await client.query(
        `SELECT id, subject, question, options, answer_index
         FROM open_book_questions WHERE id = $1`,
        [questionId],
      );
      const question = toQuestion(questionResult.rows[0]);
      const inserted = await client.query(
        `INSERT INTO open_book_quiz_answers
           (guild_id, channel_id, question_id, user_id, selected_index)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING
         RETURNING user_id`,
        [guildId, channelId, questionId, userId, selectedIndex],
      );
      if (inserted.rowCount === 0) {
        await client.query('COMMIT');
        return { status: 'already_answered' };
      }
      if (selectedIndex !== question.answerIndex) {
        await client.query('COMMIT');
        return { status: 'incorrect' };
      }

      const nextQuestion = await pickQuestion(
        client,
        guildId,
        channelId,
        state.subject,
        questionId,
      );
      await client.query(
        'DELETE FROM open_book_quiz_answers WHERE guild_id = $1 AND channel_id = $2',
        [guildId, channelId],
      );
      await client.query(
        `INSERT INTO open_book_quiz_used (guild_id, channel_id, question_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [guildId, channelId, nextQuestion.id],
      );
      await client.query(
        `UPDATE open_book_quiz_channels
         SET current_question_id = $3, message_id = NULL, updated_at = now()
         WHERE guild_id = $1 AND channel_id = $2`,
        [guildId, channelId, nextQuestion.id],
      );
      await client.query('COMMIT');
      return { status: 'correct', question, nextQuestion };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async setMessageId(guildId, channelId, questionId, messageId) {
    await this.pool.query(
      `UPDATE open_book_quiz_channels
       SET message_id = $4, updated_at = now()
       WHERE guild_id = $1 AND channel_id = $2
         AND enabled = true AND current_question_id = $3`,
      [guildId, channelId, questionId, messageId],
    );
  }

  async listEnabled() {
    const result = await this.pool.query(
      `SELECT state.guild_id, state.channel_id, state.message_id,
              q.id AS question_id, q.subject AS question_subject,
              q.question AS question_question, q.options AS question_options,
              q.answer_index AS question_answer_index
       FROM open_book_quiz_channels state
       JOIN open_book_questions q ON q.id = state.current_question_id
       WHERE state.enabled = true`,
    );
    return result.rows.map((row) => ({
      guildId: row.guild_id,
      channelId: row.channel_id,
      messageId: row.message_id,
      question: toQuestion(row, 'question_'),
    }));
  }
}
