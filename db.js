const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "data.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return { games: {}, players: {}, customQuestions: { truths: [], dares: [] } };
  }
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function init() {
  if (!fs.existsSync(DB_PATH)) save({ games: {}, players: {}, customQuestions: { truths: [], dares: [] } });
  console.log("✅ Database initialized");
}

// ── GAMES ─────────────────────────────────────────────────────────────────

function getGame(chatId) {
  return load().games[chatId] || null;
}

function createGame(chatId) {
  const data = load();
  data.games[chatId] = {
    chat_id: chatId, status: "waiting",
    current_questioner: null, current_target: null,
    current_choice: null, current_question: null,
    round: 0, turn_order: [], turn_index: 0,
    questioner_index: 0, waiting_answer: false,
  };
  save(data);
}

function updateGame(chatId, fields) {
  const data = load();
  data.games[chatId] = { ...data.games[chatId], ...fields };
  save(data);
}

function endGame(chatId) {
  updateGame(chatId, { status: "ended" });
}

function resetGame(chatId) {
  const data = load();
  delete data.games[chatId];
  Object.keys(data.players).forEach(key => {
    if (key.startsWith(chatId + ":")) delete data.players[key];
  });
  save(data);
}

// ── PLAYERS ───────────────────────────────────────────────────────────────

function playerKey(chatId, userId) { return `${chatId}:${userId}`; }

function addPlayer(chatId, userId, username, firstName) {
  const data = load();
  const key = playerKey(chatId, userId);
  if (data.players[key]) return false;
  data.players[key] = {
    chat_id: chatId, user_id: userId,
    username: username || null, first_name: firstName || "Player",
    points: 0, alive: true, turns_as_target: 0, turns_as_questioner: 0,
  };
  save(data);
  return true;
}

function getPlayers(chatId, aliveOnly = false) {
  const data = load();
  return Object.values(data.players)
    .filter(p => p.chat_id === chatId && (aliveOnly ? p.alive : true));
}

function getPlayer(chatId, userId) {
  return load().players[playerKey(chatId, userId)] || null;
}

function addPoints(chatId, userId, pts) {
  const data = load();
  const key = playerKey(chatId, userId);
  if (data.players[key]) data.players[key].points += pts;
  save(data);
}

function deductPoints(chatId, userId, pts) {
  const data = load();
  const key = playerKey(chatId, userId);
  if (data.players[key]) data.players[key].points = Math.max(0, data.players[key].points - pts);
  save(data);
}

function eliminatePlayer(chatId, userId) {
  const data = load();
  const key = playerKey(chatId, userId);
  if (data.players[key]) data.players[key].alive = false;
  save(data);
}

function incrementTurnCount(chatId, userId, role) {
  const data = load();
  const key = playerKey(chatId, userId);
  if (data.players[key]) {
    if (role === "target") data.players[key].turns_as_target++;
    if (role === "questioner") data.players[key].turns_as_questioner++;
  }
  save(data);
}

function getLeaderboard(chatId) {
  return getPlayers(chatId).sort((a, b) => b.points - a.points || (b.alive ? 1 : -1));
}

// ── CUSTOM QUESTIONS ──────────────────────────────────────────────────────

function addCustomQuestion(type, question) {
  const data = load();
  if (!data.customQuestions) data.customQuestions = { truths: [], dares: [] };
  data.customQuestions[type].push(question);
  save(data);
}

function getCustomQuestions() {
  const data = load();
  return data.customQuestions || { truths: [], dares: [] };
}

module.exports = {
  init, getGame, createGame, updateGame, endGame, resetGame,
  addPlayer, getPlayers, getPlayer, addPoints, deductPoints,
  eliminatePlayer, incrementTurnCount, getLeaderboard,
  addCustomQuestion, getCustomQuestions,
};
