const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "data.json");

// Load data from file or start fresh
function load() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return { games: {}, players: {} };
  }
}

// Save data to file
function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function init() {
  if (!fs.existsSync(DB_PATH)) save({ games: {}, players: {} });
  console.log("✅ Database initialized");
}

// ── GAMES ─────────────────────────────────────────────────────────────────

function getGame(chatId) {
  return load().games[chatId] || null;
}

function createGame(chatId) {
  const data = load();
  data.games[chatId] = { chat_id: chatId, status: "waiting", current_questioner: null, current_target: null, current_choice: null, current_question: null, round: 0 };
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
  // Remove all players for this chat
  Object.keys(data.players).forEach(key => {
    if (key.startsWith(chatId + ":")) delete data.players[key];
  });
  save(data);
}

// ── PLAYERS ───────────────────────────────────────────────────────────────

function playerKey(chatId, userId) {
  return `${chatId}:${userId}`;
}

function addPlayer(chatId, userId, username, firstName) {
  const data = load();
  const key = playerKey(chatId, userId);
  if (data.players[key]) return false; // already joined
  data.players[key] = { chat_id: chatId, user_id: userId, username: username || null, first_name: firstName || "Player", points: 0, alive: true };
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

function eliminatePlayer(chatId, userId) {
  const data = load();
  const key = playerKey(chatId, userId);
  if (data.players[key]) data.players[key].alive = false;
  save(data);
}

function getLeaderboard(chatId) {
  return getPlayers(chatId).sort((a, b) => b.points - a.points || b.alive - a.alive);
}

module.exports = {
  init, getGame, createGame, updateGame, endGame, resetGame,
  addPlayer, getPlayers, getPlayer, addPoints, eliminatePlayer, getLeaderboard,
};
