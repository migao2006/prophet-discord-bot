import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import {
  OpenBookQuizService,
  createQuestionPayload,
} from '../src/features/games/open-book-quiz/service.js';
import { data, execute } from '../src/commands/games/open-book-quiz.js';

const question = {
  id: 12,
  subject: '社會',
  question: '臺灣最高的山是哪一座？',
  options: ['玉山', '雪山', '合歡山', '阿里山'],
  answerIndex: 0,
};
const nextQuestion = {
  id: 13,
  subject: '自然',
  question: '植物主要透過哪個構造行光合作用？',
  options: ['根', '葉', '花', '果實'],
  answerIndex: 1,
};

function createButtonInteraction(repositoryResult, selected = 0) {
  const payload = createQuestionPayload(question);
  const edits = [];
  const replies = [];
  const sent = [];
  const saved = [];
  const repository = {
    submitAnswer: async (...args) => {
      saved.push(args);
      return repositoryResult;
    },
    setMessageId: async (...args) => saved.push(args),
  };
  const interaction = {
    customId: `openbook:${question.id}:${selected}`,
    guildId: 'guild',
    channelId: 'channel',
    user: { id: 'user', bot: false },
    message: {
      components: payload.components,
      edit: async (value) => edits.push(value),
    },
    channel: {
      send: async (value) => {
        sent.push(value);
        return { id: 'next-message' };
      },
    },
    reply: async (value) => replies.push(value),
    deferUpdate: async () => { interaction.deferred = true; },
    replies,
    edits,
    sent,
    saved,
  };
  return { interaction, service: new OpenBookQuizService(repository, { error: () => {} }) };
}

test('open-book dataset contains clean four-choice questions for every subject', async () => {
  const dataset = JSON.parse(await readFile(
    new URL('../data/open-book-cap-390fcf615d08.json', import.meta.url),
    'utf8',
  ));
  assert.equal(dataset.sourceVersion, '390fcf615d08362e4885c43058f4ac3c128c2ec2');
  assert.equal(dataset.questions.length, 360);
  assert.deepEqual(new Set(dataset.questions.map((item) => item.subject)), new Set([
    '國文', '數學', '社會', '自然', '英語',
  ]));
  assert.equal(new Set(dataset.questions.map((item) => item.sourceId)).size, 360);
  assert.ok(dataset.questions.every((item) => (
    item.options.length === 4
    && item.answerIndex >= 0
    && item.answerIndex <= 3
    && item.question.length > 0
  )));
});

test('question payload stays clean and only exposes subject, question, choices, and buttons', () => {
  const payload = createQuestionPayload(question);
  const embed = payload.embeds[0].toJSON();
  assert.equal(embed.title, '📖 開卷有益・社會');
  assert.match(embed.description, /臺灣最高的山/);
  assert.match(embed.description, /A．/);
  assert.doesNotMatch(JSON.stringify(payload), /來源|exam_year|question_number/);
  assert.deepEqual(
    payload.components[0].components.map((button) => button.data.label),
    ['A', 'B', 'C', 'D'],
  );
});

test('wrong and repeated answers receive private feedback', async () => {
  for (const [status, phrase] of [['incorrect', '不對'], ['already_answered', '已經回答過']]) {
    const { interaction, service } = createButtonInteraction({ status }, 2);
    assert.equal(await service.handleButton(interaction), true);
    assert.equal(interaction.replies[0].flags, MessageFlags.Ephemeral);
    assert.match(interaction.replies[0].content, new RegExp(phrase));
    assert.deepEqual(interaction.saved[0], ['guild', 'channel', 12, 'user', 2]);
    assert.equal(interaction.sent.length, 0);
  }
});

test('first correct answer disables the old buttons and publishes the next clean question', async () => {
  const { interaction, service } = createButtonInteraction({
    status: 'correct',
    question,
    nextQuestion,
  });
  assert.equal(await service.handleButton(interaction), true);
  assert.equal(interaction.deferred, true);
  assert.ok(interaction.edits[0].components[0].components.every((button) => button.data.disabled));
  assert.equal(interaction.sent.length, 1);
  assert.match(interaction.sent[0].content, /答對啦/);
  assert.match(interaction.sent[0].content, /A．玉山/);
  assert.doesNotMatch(JSON.stringify(interaction.sent[0]), /來源|題號/);
  assert.deepEqual(interaction.saved.at(-1), ['guild', 'channel', 13, 'next-message']);
});

test('open-book command is public, offers Chinese subjects, and opens without scoring options', async () => {
  const definition = data.toJSON();
  assert.equal(definition.name, '開卷有益');
  assert.equal(definition.default_member_permissions, undefined);
  assert.deepEqual(definition.options.map((option) => option.name), ['狀態', '科目']);
  assert.deepEqual(definition.options[1].choices.map((choice) => choice.name), [
    '全部', '國文', '英文', '數學', '社會', '自然',
  ]);

  let saved;
  let published;
  const interaction = {
    inGuild: () => true,
    guild: { id: 'guild' },
    guildId: 'guild',
    channelId: 'channel',
    channel: { type: ChannelType.GuildText },
    user: { id: 'starter' },
    memberPermissions: { has: (permission) => permission === PermissionFlagsBits.Administrator ? false : false },
    appPermissions: { has: () => true },
    options: {
      getString: (name, required) => {
        if (name === '狀態') return '開啟';
        if (name === '科目') return '社會';
        return required ? '開啟' : null;
      },
    },
  };
  await execute(interaction, {
    openBookQuizRepository: {
      setEnabled: async (...args) => {
        saved = args;
        return { changed: true, enabled: true, question };
      },
    },
    openBookQuizService: {
      publishInteractionQuestion: async (...args) => { published = args; },
    },
  });
  assert.deepEqual(saved, [
    'guild',
    'channel',
    true,
    { userId: 'starter', isAdmin: false, subject: '社會' },
  ]);
  assert.equal(published[1], question);
});

test('only the starter or an administrator can close open-book quiz', async () => {
  let reply;
  const interaction = {
    inGuild: () => true,
    guild: { id: 'guild' },
    guildId: 'guild',
    channelId: 'channel',
    channel: { type: ChannelType.GuildText },
    user: { id: 'other' },
    memberPermissions: { has: () => false },
    options: { getString: (name) => (name === '狀態' ? '關閉' : null) },
    reply: async (value) => { reply = value; },
  };
  await execute(interaction, {
    openBookQuizRepository: { setEnabled: async () => ({ forbidden: true, enabled: true }) },
    openBookQuizService: {},
  });
  assert.equal(reply.flags, MessageFlags.Ephemeral);
  assert.match(reply.content, /開啟遊戲的人或管理員/);
});
