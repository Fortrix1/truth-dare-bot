const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const DB_PATH = path.join(__dirname, "game.db");
const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function init() {
  await run(`
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
    )
  `);

  await run(`
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
    )
  `);
}

// ── GAME ──────────────────────────────────────────────────────────────────

async function getGame(chatId) {
  return get("SELECT * FROM games WHERE chat_id = ?", [chatId]);
}

async function createGame(chatId) {
  await run(
    "INSERT OR REPLACE INTO games (chat_id, status) VALUES (?, 'waiting')",
    [chatId]
  );
}

async function updateGame(chatId, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const vals = keys.map((k) => fields[k]);
  await run(`UPDATE games SET ${sets} WHERE chat_id = ?`, [...vals, chatId]);
}

async function endGame(chatId) {
  await run(
    "UPDATE games SET status = 'ended', ended_at = CURRENT_TIMESTAMP WHERE chat_id = ?",
    [chatId]
  );
}

async function resetGame(chatId) {
  await run("DELETE FROM games WHERE chat_id = ?", [chatId]);
  await run("DELETE FROM players WHERE chat_id = ?", [chatId]);
}

// ── PLAYERS ───────────────────────────────────────────────────────────────

async function addPlayer(chatId, userId, username, firstName) {
  try {
    await run(
      "INSERT INTO players (chat_id, user_id, username, first_name) VALUES (?, ?, ?, ?)",
      [chatId, userId, username || null, firstName || "Player"]
    );
    return true;
  } catch (e) {
    if (e.message.includes("UNIQUE")) return false; // already joined
    throw e;
  }
}

async function getPlayers(chatId, aliveOnly = false) {
  const sql = aliveOnly
    ? "SELECT * FROM players WHERE chat_id = ? AND alive = 1 ORDER BY joined_at"
    : "SELECT * FROM players WHERE chat_id = ? ORDER BY joined_at";
  return all(sql, [chatId]);
}

async function getPlayer(chatId, userId) {
  return get("SELECT * FROM players WHERE chat_id = ? AND user_id = ?", [
    chatId,
    userId,
  ]);
}

async function addPoints(chatId, userId, pts) {
  await run(
    "UPDATE players SET points = points + ? WHERE chat_id = ? AND user_id = ?",
    [pts, chatId, userId]
  );
}

async function eliminatePlayer(chatId, userId) {
  await run(
    "UPDATE players SET alive = 0 WHERE chat_id = ? AND user_id = ?",
    [chatId, userId]
  );
}

async function getLeaderboard(chatId) {
  return all(
    "SELECT * FROM players WHERE chat_id = ? ORDER BY points DESC, alive DESC",
    [chatId]
  );
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
