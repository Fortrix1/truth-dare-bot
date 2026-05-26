const db = require("./db");

function displayName(player) {
  return player.username ? `@${player.username}` : player.first_name;
}

// Fair rotation: pick the player with fewest turns in each role
function pickNextPair(chatId) {
  const alive = db.getPlayers(chatId, true);
  if (alive.length < 2) return null;

  // Pick target: alive player with fewest turns as target
  const target = [...alive].sort((a, b) => a.turns_as_target - b.turns_as_target)[0];

  // Pick questioner: alive player with fewest turns as questioner, excluding target
  const others = alive.filter(p => p.user_id !== target.user_id);
  const questioner = [...others].sort((a, b) => a.turns_as_questioner - b.turns_as_questioner)[0];

  return { questioner, target };
}

function startGame(chatId) {
  db.updateGame(chatId, { status: "active", round: 1, started_at: new Date().toISOString() });
}

function recordChoice(chatId, choice, question) {
  db.updateGame(chatId, { current_choice: choice, current_question: question });
}

function handleDone(chatId) {
  const game = db.getGame(chatId);
  if (!game || game.status !== "active") return null;
  db.addPoints(chatId, game.current_target, 5);
  const target = db.getPlayer(chatId, game.current_target);
  const questioner = db.getPlayer(chatId, game.current_questioner);
  return { target, questioner };
}

function handleFail(chatId) {
  const game = db.getGame(chatId);
  if (!game || game.status !== "active") return null;
  db.eliminatePlayer(chatId, game.current_target);
  const target = db.getPlayer(chatId, game.current_target);
  const alive = db.getPlayers(chatId, true);
  return { target, alive };
}

function checkWinner(chatId) {
  const alive = db.getPlayers(chatId, true);
  if (alive.length === 1) return alive[0];
  if (alive.length === 0) return "draw";
  return null;
}

function advanceRound(chatId) {
  const game = db.getGame(chatId);
  db.updateGame(chatId, {
    round: (game.round || 0) + 1,
    current_questioner: null, current_target: null,
    current_choice: null, current_question: null,
    waiting_answer: false,
  });
}

module.exports = {
  pickNextPair, startGame, recordChoice,
  handleDone, handleFail, checkWinner, advanceRound, displayName,
};
