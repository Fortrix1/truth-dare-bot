const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "game.db");
const db = new Database(DB_PATH);

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT,
      first_name TEXT,
      points INTEGER DEFAULT 0,
      alive INTEGER DEFAULT 1,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(chat_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'waiting',
      current_questioner TEXT,
      current_target TEXT,
      current_choice TEXT,
      current_question TEXT,
      round INTEGER DEFAULT 0,
      started_at DATETIME,
      ended_at DATETIME
    );
  `);
}

function getGame(chatId) {
  return db.prepare("SELECT * FROM games WHERE chat_id = ?").get(chatId);
}

function createGame(chatId) {
  db.prepare("INSERT OR REPLACE INTO games (chat_id, status) VALUES (?, 'waiting')").run(chatId);
}

function updateGame(chatId, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const vals = keys.map((k) => fields[k]);
  db.prepare(`UPDATE games SET ${sets} WHERE chat_id = ?`).run(...vals, chatId);
}

function endGame(chatId) {
  db.prepare("UPDATE games SET status = 'ended', ended_at = CURRENT_TIMESTAMP WHERE chat_id = ?").run(chatId);
}

function resetGame(chatId) {
  db.prepare("DELETE FROM games WHERE chat_id = ?").run(chatId);
  db.prepare("DELETE FROM players WHERE chat_id = ?").run(chatId);
}

function addPlayer(chatId, userId, username, firstName) {
  try {
    db.prepare("INSERT INTO players (chat_id, user_id, username, first_name) VALUES (?, ?, ?, ?)").run(chatId, userId, username || null, firstName || "Player");
    return true;
  } catch (e) {
    if (e.message.includes("UNIQUE")) return false;
    throw e;
  }
}

function getPlayers(chatId, aliveOnly = false) {
  const sql = aliveOnly
    ? "SELECT * FROM players WHERE chat_id = ? AND alive = 1 ORDER BY joined_at"
    : "SELECT * FROM players WHERE chat_id = ? ORDER BY joined_at";
  return db.prepare(sql).all(chatId);
}

function getPlayer(chatId, userId) {
  return db.prepare("SELECT * FROM players WHERE chat_id = ? AND user_id = ?").get(chatId, userId);
}

function addPoints(chatId, userId, pts) {
  db.prepare("UPDATE players SET points = points + ? WHERE chat_id = ? AND user_id = ?").run(pts, chatId, userId);
}

function eliminatePlayer(chatId, userId) {
  db.prepare("UPDATE players SET alive = 0 WHERE chat_id = ? AND user_id = ?").run(chatId, userId);
}

function getLeaderboard(chatId) {
  return db.prepare("SELECT * FROM players WHERE chat_id = ? ORDER BY points DESC, alive DESC").all(chatId);
}

module.exports = {
  init,
  getGame,
  createGame,
  updateGame,
  endGame,
  resetGame,
  addPlayer,
  getPlayers,
  getPlayer,
  addPoints,
  eliminatePlayer,
  getLeaderboard,
};
