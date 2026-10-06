export const GAME_TYPE = Object.freeze({
  numberChain: 'number_chain',
  bullsAndCows: 'bulls_and_cows',
  idiomChain: 'idiom_chain',
  openBookQuiz: 'open_book_quiz',
  werewolf: 'werewolf',
});

export async function lockChannelGame(client, guildId, channelId) {
  await client.query(
    `INSERT INTO channel_games (guild_id, channel_id, active_game)
     VALUES ($1, $2, NULL)
     ON CONFLICT DO NOTHING`,
    [guildId, channelId],
  );
  const result = await client.query(
    `SELECT active_game
     FROM channel_games
     WHERE guild_id = $1 AND channel_id = $2
     FOR UPDATE`,
    [guildId, channelId],
  );
  return result.rows[0].active_game;
}

export async function setActiveChannelGame(client, guildId, channelId, activeGame) {
  await client.query(
    `UPDATE channel_games
     SET active_game = $3, updated_at = now()
     WHERE guild_id = $1 AND channel_id = $2`,
    [guildId, channelId, activeGame],
  );
}
