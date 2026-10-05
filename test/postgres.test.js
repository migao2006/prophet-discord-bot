import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { migrate } from '../src/infrastructure/database/migrate.js';
import { seedIdioms } from '../src/infrastructure/database/seed-idioms.js';
import { seedOpenBookQuestions } from '../src/infrastructure/database/seed-open-book-questions.js';
import { ActivityRepository } from '../src/features/activity/repository.js';
import { MemberRepository } from '../src/features/members/repository.js';
import { NumberChainRepository } from '../src/features/games/number-chain/repository.js';
import { BullsAndCowsRepository } from '../src/features/games/bulls-and-cows/repository.js';
import { IdiomChainRepository } from '../src/features/games/idiom-chain/repository.js';
import { OpenBookQuizRepository } from '../src/features/games/open-book-quiz/repository.js';

const connectionString = process.env.TEST_DATABASE_URL;

test('PostgreSQL migration and activity writes are idempotent', {
  skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
}, async () => {
  const pool = new pg.Pool({ connectionString });
  try {
    await migrate(pool);
    await migrate(pool);
    const firstSeed = await seedIdioms(pool);
    const secondSeed = await seedIdioms(pool);
    assert.equal(firstSeed.entryCount, 5310);
    assert.deepEqual(secondSeed, { imported: false, entryCount: 5310 });
    assert.equal(
      Number((await pool.query('SELECT count(*) FROM idioms WHERE active = true')).rows[0].count),
      5310,
    );
    const firstQuizSeed = await seedOpenBookQuestions(pool);
    const secondQuizSeed = await seedOpenBookQuestions(pool);
    assert.equal(firstQuizSeed.questionCount, 360);
    assert.deepEqual(secondQuizSeed, { imported: false, questionCount: 360 });
    assert.equal(
      Number((await pool.query(
        'SELECT count(*) FROM open_book_questions WHERE active = true',
      )).rows[0].count),
      360,
    );
    const repository = new ActivityRepository(pool);
    const guildId = `test-${Date.now()}`;
    await repository.ensureGuild(guildId, new Date('2026-10-04T00:00:00Z'));
    const message = {
      messageId: `message-${Date.now()}`,
      guildId,
      channelId: 'channel',
      userId: 'user',
      localDate: '2026-10-04',
      createdAt: new Date('2026-10-04T01:00:00Z'),
    };

    assert.equal(await repository.recordMessage(message), true);
    assert.equal(await repository.recordMessage(message), false);
    assert.equal(
      await repository.countMessages(guildId, 'user', '2026-10-04', ['channel']),
      1,
    );
    assert.equal(await repository.deleteMessage(message.messageId), true);
    assert.equal(
      await repository.countMessages(guildId, 'user', '2026-10-04', ['channel']),
      0,
    );
    const cursor = await repository.getCursor(guildId, 'channel');
    assert.equal(cursor.last_message_id, message.messageId);

    await repository.prepareChannelBackfill(
      guildId,
      'channel',
      new Date('2026-09-05T16:00:00Z'),
    );
    assert.deepEqual(await repository.getBackfillStatus(guildId, ['channel']), {
      total: 1,
      incomplete: 1,
    });
    await repository.updateChannelBackfill(guildId, 'channel', message.messageId, true);
    assert.deepEqual(await repository.getBackfillStatus(guildId, ['channel']), {
      total: 1,
      incomplete: 0,
    });

    const joinedAt = new Date('2026-10-04T02:00:00Z');
    await repository.ensureVoiceTrackingStarted(guildId, joinedAt);
    await repository.transitionVoiceSession({
      guildId,
      userId: 'user',
      channelId: 'voice',
      at: joinedAt,
    });
    await repository.transitionVoiceSession({
      guildId,
      userId: 'user',
      channelId: null,
      at: new Date('2026-10-04T03:00:00Z'),
    });
    const activity = await repository.getMemberActivity(
      guildId,
      'user',
      '2026-09-06',
      new Date('2026-09-05T16:00:00Z'),
      new Date('2026-10-05T00:00:00Z'),
      ['channel'],
    );
    assert.equal(activity.voiceSessions.length, 1);
    assert.equal(activity.voiceSessions[0].channel_id, 'voice');

    const members = new MemberRepository(pool);
    const syncedAt = new Date('2026-10-04T04:00:00Z');
    const initial = await members.syncMembers(guildId, [
      { userId: 'user', joinedAt: new Date('2026-10-01T00:00:00Z') },
      { userId: 'sleeper', joinedAt: new Date('2026-10-02T00:00:00Z') },
    ], new Date('2026-09-05T16:00:00Z'), syncedAt);
    assert.deepEqual(initial, { members: 2, joined: 2, left: 0, firstSync: true });

    await repository.recordMessage({
      ...message,
      messageId: `active-${Date.now()}`,
      createdAt: new Date('2026-10-04T04:30:00Z'),
    });
    const serverStats = await members.getServerStats(
      guildId,
      '2026-09-06',
      new Date('2026-09-05T16:00:00Z'),
      new Date('2026-10-05T00:00:00Z'),
      ['channel'],
    );
    assert.equal(serverStats.currentMembers, 2);
    assert.equal(serverStats.activeMembers, 1);
    const joined = serverStats.events
      .filter((event) => event.event_type === 'join')
      .reduce((sum, event) => sum + event.count, 0);
    assert.equal(joined, 2);

    assert.equal(await members.removeMember(guildId, 'sleeper', new Date('2026-10-04T05:00:00Z')), true);
    assert.equal(await members.removeMember(guildId, 'sleeper', new Date('2026-10-04T05:01:00Z')), false);

    const numberChain = new NumberChainRepository(pool);
    assert.deepEqual(await numberChain.setEnabled(guildId, 'game', true), {
      changed: true,
      enabled: true,
      currentNumber: '0',
    });

    await numberChain.setEnabled(guildId, 'game', false);
    const openBook = new OpenBookQuizRepository(pool);
    const openedQuiz = await openBook.setEnabled(guildId, 'game', true, {
      userId: 'starter',
      subject: '社會',
    });
    assert.equal(openedQuiz.changed, true);
    assert.equal(openedQuiz.enabled, true);
    assert.equal(openedQuiz.question.subject, '社會');
    assert.equal((await openBook.setEnabled(guildId, 'game', true, {
      userId: 'other',
      subject: '自然',
    })).question.id, openedQuiz.question.id);
    const wrongIndex = (openedQuiz.question.answerIndex + 1) % 4;
    assert.equal((await openBook.submitAnswer(
      guildId, 'game', openedQuiz.question.id, 'wrong-player', wrongIndex,
    )).status, 'incorrect');
    assert.equal((await openBook.submitAnswer(
      guildId, 'game', openedQuiz.question.id, 'wrong-player', openedQuiz.question.answerIndex,
    )).status, 'already_answered');
    const quizRace = await Promise.all([
      openBook.submitAnswer(
        guildId, 'game', openedQuiz.question.id, 'player-a', openedQuiz.question.answerIndex,
      ),
      openBook.submitAnswer(
        guildId, 'game', openedQuiz.question.id, 'player-b', openedQuiz.question.answerIndex,
      ),
    ]);
    assert.equal(quizRace.filter((result) => result.status === 'correct').length, 1);
    assert.equal(quizRace.filter((result) => result.status === 'stale').length, 1);
    const nextQuizQuestion = quizRace.find((result) => result.status === 'correct').nextQuestion;
    assert.notEqual(nextQuizQuestion.id, openedQuiz.question.id);
    assert.deepEqual(await numberChain.setEnabled(guildId, 'game', true), {
      changed: false,
      enabled: false,
      conflict: 'open_book_quiz',
    });
    assert.equal((await openBook.setEnabled(guildId, 'game', false, {
      userId: 'other',
      isAdmin: false,
    })).forbidden, true);
    assert.equal((await openBook.setEnabled(guildId, 'game', false, {
      userId: 'admin',
      isAdmin: true,
    })).changed, true);
    assert.deepEqual(await numberChain.setEnabled(guildId, 'game', true), {
      changed: true,
      enabled: true,
      currentNumber: '0',
    });
    const secrets = ['0123', '4567', '8901'];
    const bullsAndCows = new BullsAndCowsRepository(pool, () => secrets.shift() ?? '2345');
    assert.deepEqual(await bullsAndCows.setEnabled(guildId, 'game', true), {
      changed: false,
      enabled: false,
      conflict: 'number_chain',
    });
    const concurrent = await Promise.all([
      numberChain.tryAdvance(guildId, 'game', 'player-a', 1n),
      numberChain.tryAdvance(guildId, 'game', 'player-b', 1n),
    ]);
    assert.equal(concurrent.filter((result) => result.status === 'correct').length, 1);
    assert.equal(concurrent.filter((result) => result.status === 'incorrect').length, 1);
    assert.equal(
      (await numberChain.tryAdvance(guildId, 'game', 'player-c', 1n)).status,
      'correct',
    );
    assert.equal((await numberChain.setEnabled(guildId, 'game', false)).changed, true);
    assert.deepEqual(await bullsAndCows.setEnabled(guildId, 'game', true), {
      changed: true,
      enabled: true,
      guessCount: 0,
    });
    assert.deepEqual(await bullsAndCows.submitGuess(guildId, 'game', '1038'), {
      status: 'guessed',
      a: 0,
      b: 3,
      attempt: 1,
    });
    assert.equal((await bullsAndCows.submitGuess(guildId, 'game', null)).status, 'invalid');
    assert.deepEqual(await bullsAndCows.submitGuess(guildId, 'game', '0123'), {
      status: 'won',
      a: 4,
      b: 0,
      attempt: 2,
      answer: '0123',
    });
    assert.deepEqual(await numberChain.setEnabled(guildId, 'game', true), {
      changed: false,
      enabled: false,
      conflict: 'bulls_and_cows',
    });
    assert.equal((await bullsAndCows.setEnabled(guildId, 'game', false)).changed, true);
    assert.deepEqual(await numberChain.setEnabled(guildId, 'game', true), {
      changed: true,
      enabled: true,
      currentNumber: '0',
    });

    const idiomChain = new IdiomChainRepository(pool);
    assert.deepEqual(await idiomChain.setEnabled(guildId, 'game', true), {
      changed: false,
      enabled: false,
      conflict: 'number_chain',
    });
    await numberChain.setEnabled(guildId, 'game', false);
    const idiomOpening = await idiomChain.setEnabled(guildId, 'game', true);
    assert.equal(idiomOpening.changed, true);
    assert.equal(idiomOpening.enabled, true);
    assert.match(idiomOpening.currentIdiom, /^\p{Script=Han}{4}$/u);
    assert.equal(
      (await idiomChain.tryAdvance(guildId, 'game', 'player-a', '龘龘龘龘')).reason,
      'not_found',
    );
    const candidate = (await pool.query(
      `SELECT candidate.idiom
       FROM idioms candidate
       WHERE candidate.active = true
         AND left(candidate.idiom, 1) = right($1, 1)
         AND candidate.idiom <> $1
         AND EXISTS (
           SELECT 1 FROM idioms next
           WHERE next.active = true
             AND left(next.idiom, 1) = right(candidate.idiom, 1)
             AND next.idiom <> candidate.idiom
         )
       LIMIT 1`,
      [idiomOpening.currentIdiom],
    )).rows[0].idiom;
    assert.equal(
      (await idiomChain.tryAdvance(guildId, 'game', 'player-a', candidate)).status,
      'correct',
    );
    assert.equal(
      (await idiomChain.tryAdvance(guildId, 'game', 'player-a', candidate)).reason,
      'same_user',
    );
    const deadEndPair = (await pool.query(
      `SELECT previous.idiom AS previous_idiom, answer.idiom AS answer_idiom
       FROM idioms previous
       JOIN idioms answer ON left(answer.idiom, 1) = right(previous.idiom, 1)
       WHERE previous.active = true
         AND answer.active = true
         AND NOT EXISTS (
           SELECT 1 FROM idioms next
           WHERE next.active = true
             AND left(next.idiom, 1) = right(answer.idiom, 1)
         )
       LIMIT 1`,
    )).rows[0];
    await pool.query(
      'DELETE FROM idiom_chain_used WHERE guild_id = $1 AND channel_id = $2',
      [guildId, 'game'],
    );
    await pool.query(
      `UPDATE idiom_chain_channels
       SET current_idiom = $3, last_user_id = NULL
       WHERE guild_id = $1 AND channel_id = $2`,
      [guildId, 'game', deadEndPair.previous_idiom],
    );
    await pool.query(
      `INSERT INTO idiom_chain_used (guild_id, channel_id, idiom)
       VALUES ($1, $2, $3)`,
      [guildId, 'game', deadEndPair.previous_idiom],
    );
    const completedRound = await idiomChain.tryAdvance(
      guildId,
      'game',
      'player-b',
      deadEndPair.answer_idiom,
    );
    assert.equal(completedRound.status, 'round_complete');
    assert.match(completedRound.openingIdiom, /^\p{Script=Han}{4}$/u);
    assert.deepEqual(await numberChain.setEnabled(guildId, 'game', true), {
      changed: false,
      enabled: false,
      conflict: 'idiom_chain',
    });
    assert.equal((await idiomChain.setEnabled(guildId, 'game', false)).changed, true);
    assert.deepEqual(await numberChain.setEnabled(guildId, 'game', true), {
      changed: true,
      enabled: true,
      currentNumber: '0',
    });

    const raceResults = await Promise.all([
      numberChain.setEnabled(guildId, 'race-game', true),
      bullsAndCows.setEnabled(guildId, 'race-game', true),
    ]);
    assert.equal(raceResults.filter((result) => result.changed && result.enabled).length, 1);
    assert.equal(raceResults.filter((result) => result.conflict).length, 1);
    if (raceResults[0].enabled) {
      await numberChain.setEnabled(guildId, 'race-game', false);
    } else {
      await bullsAndCows.setEnabled(guildId, 'race-game', false);
    }
  } finally {
    await pool.end();
  }
});
