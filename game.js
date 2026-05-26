const db = require("./db");
const { getRandomTruth, getRandomDare } = require("./questions");

function pickTwo(players) {
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  return [shuffled[0], shuffled[1]];
}

function displayName(player) {
  return player.username ? `@${player.username}` : player.first_name;
}

function pickNextTurn(chatId) {
  const alive = db.getPlayers(chatId, true);
  if (alive.length < 2) return null;
  const [questioner, target] = pickTwo(alive);
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
    current_questioner: null,
    current_target: null,
    current_choice: null,
    current_question: null,
  });
}

module.exports = {
  pickNextTurn,
  startGame,
  recordChoice,
  handleDone,
  handleFail,
  checkWinner,
  advanceRound,
  displayName,
  getRandomTruth,
  getRandomDare,
};
