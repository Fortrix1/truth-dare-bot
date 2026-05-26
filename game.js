const db = require("./db");
const { getRandomTruth, getRandomDare } = require("./questions");

// Pick 2 different random players from alive list
function pickTwo(players) {
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  return [shuffled[0], shuffled[1]];
}

function displayName(player) {
  return player.username ? `@${player.username}` : player.first_name;
}

// Returns { questioner, target } objects or null if not enough players
async function pickNextTurn(chatId) {
  const alive = await db.getPlayers(chatId, true);
  if (alive.length < 2) return null;
  const [questioner, target] = pickTwo(alive);
  return { questioner, target };
}

async function startGame(chatId) {
  await db.updateGame(chatId, {
    status: "active",
    round: 1,
    started_at: new Date().toISOString(),
  });
}

async function recordChoice(chatId, choice, question) {
  await db.updateGame(chatId, {
    current_choice: choice,
    current_question: question,
  });
}

async function handleDone(chatId) {
  const game = await db.getGame(chatId);
  if (!game || game.status !== "active") return null;
  await db.addPoints(chatId, game.current_target, 5);
  const target = await db.getPlayer(chatId, game.current_target);
  const questioner = await db.getPlayer(chatId, game.current_questioner);
  return { target, questioner };
}

async function handleFail(chatId) {
  const game = await db.getGame(chatId);
  if (!game || game.status !== "active") return null;
  await db.eliminatePlayer(chatId, game.current_target);
  const target = await db.getPlayer(chatId, game.current_target);
  const alive = await db.getPlayers(chatId, true);
  return { target, alive };
}

// Returns winner player or null if game continues
async function checkWinner(chatId) {
  const alive = await db.getPlayers(chatId, true);
  if (alive.length === 1) return alive[0];
  if (alive.length === 0) return "draw";
  return null;
}

async function advanceRound(chatId) {
  const game = await db.getGame(chatId);
  await db.updateGame(chatId, {
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
