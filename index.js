require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const db = require("./db");
const {
  pickNextTurn, startGame, recordChoice, handleDone, handleFail,
  checkWinner, advanceRound, displayName,
} = require("./game");
const { truths, dares } = require("./questions");

const bot = new Telegraf(process.env.BOT_TOKEN);

// Send 5 random questions as buttons for questioner to pick
async function sendQuestionPicker(ctx, questionerId, targetId, chatId, choice) {
  const list = choice === "truth" ? truths : dares;
  // Pick 5 random options
  const shuffled = [...list].sort(() => Math.random() - 0.5).slice(0, 5);

  const target = db.getPlayer(chatId, targetId);
  const buttons = shuffled.map((q, i) =>
    [Markup.button.callback(`${i + 1}. ${q.slice(0, 40)}...`, `pick:${chatId}:${i}:${encodeURIComponent(q)}`)]
  );

  try {
    await ctx.telegram.sendMessage(
      questionerId,
      `📋 ${displayName(target)} chose *${choice === "truth" ? "🤔 Truth" : "🔥 Dare"}*!\n\nPick a question to ask them:`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard(buttons),
      }
    );
  } catch (e) {
    // Questioner can't receive DMs — pick random automatically
    const question = shuffled[0];
    recordChoice(chatId, choice, question);
    await ctx.telegram.sendMessage(
      chatId,
      `🎯 *Challenge Revealed!*\n\n${displayName(target)} chose *${choice === "truth" ? "🤔 Truth" : "🔥 Dare"}*:\n\n_"${question}"_\n\n⚠️ Question was picked automatically (questioner has no DMs open).`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([[
          Markup.button.callback("✅ DONE (+5 pts)", `result:done:${chatId}`),
          Markup.button.callback("❌ FAIL (eliminated)", `result:fail:${chatId}`),
        ]]),
      }
    );
  }
}

async function sendNextTurn(ctx, chatId) {
  const turn = pickNextTurn(chatId);
  if (!turn) {
    const winner = checkWinner(chatId);
    if (winner && winner !== "draw") {
      db.endGame(chatId);
      return ctx.reply(`🏆 *${displayName(winner)} wins the game with ${winner.points} points!*\n\nGG everyone! Use /newgame to play again.`, { parse_mode: "Markdown" });
    }
    if (winner === "draw") {
      db.endGame(chatId);
      return ctx.reply("😅 Everyone got eliminated. It's a draw! Use /newgame to play again.");
    }
  }

  const { questioner, target } = turn;
  db.updateGame(chatId, { current_questioner: questioner.user_id, current_target: target.user_id });

  await ctx.reply(
    `🎲 *Round time!*\n\n🎤 Questioner: ${displayName(questioner)}\n🎯 Target: ${displayName(target)}\n\n${displayName(target)}, check your DMs and pick Truth or Dare!`,
    { parse_mode: "Markdown" }
  );

  try {
    await ctx.telegram.sendMessage(
      target.user_id,
      `🎯 You've been chosen in *Truth or Dare*!\n\n*${displayName(questioner)}* is asking you.\n\nWhat do you choose?`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([[
          Markup.button.callback("🤔 Truth", `choice:truth:${chatId}`),
          Markup.button.callback("🔥 Dare", `choice:dare:${chatId}`),
        ]]),
      }
    );
  } catch (e) {
    await ctx.reply(`⚠️ Couldn't DM ${displayName(target)}. They need to start the bot first!\n\nSkipping their turn...`);
    advanceRound(chatId);
    return sendNextTurn(ctx, chatId);
  }
}

// ── COMMANDS ──────────────────────────────────────────────────────────────

bot.start(async (ctx) => {
  if (ctx.chat.type === "private") {
    await ctx.reply("👋 Hey! I'm the *Truth or Dare Bot*.\n\nAdd me to a group to play!\n\nCommands:\n/join — Join the game\n/startgame — Start (host)\n/score — Leaderboard\n/newgame — Reset", { parse_mode: "Markdown" });
  }
});

bot.command("join", async (ctx) => {
  if (ctx.chat.type === "private") return ctx.reply("Join a group first, then use /join there!");
  const chatId = String(ctx.chat.id);
  const userId = String(ctx.from.id);

  let game = db.getGame(chatId);
  if (!game) { db.createGame(chatId); game = db.getGame(chatId); }
  if (game.status === "active") return ctx.reply("⚠️ A game is already running!");
  if (game.status === "ended") return ctx.reply("⚠️ Game over. Use /newgame to start fresh.");

  const joined = db.addPlayer(chatId, userId, ctx.from.username, ctx.from.first_name);
  if (!joined) return ctx.reply(`${ctx.from.first_name}, you already joined! 😄`);

  const players = db.getPlayers(chatId);
  ctx.reply(`✅ *${ctx.from.first_name}* joined!\n\n👥 Players (${players.length}): ${players.map(displayName).join(", ")}\n\nHost can /startgame when ready.`, { parse_mode: "Markdown" });
});

bot.command("startgame", async (ctx) => {
  if (ctx.chat.type === "private") return ctx.reply("This command only works in groups!");
  const chatId = String(ctx.chat.id);
  const game = db.getGame(chatId);
  if (!game) return ctx.reply("No game session. Use /join first!");
  if (game.status === "active") return ctx.reply("Game already started!");
  if (game.status === "ended") return ctx.reply("Use /newgame to reset.");

  const players = db.getPlayers(chatId);
  if (players.length < 2) return ctx.reply("Need at least 2 players! Use /join.");

  startGame(chatId);
  await ctx.reply(`🎉 *Truth or Dare starts NOW!*\n\n${players.length} players: ${players.map(displayName).join(", ")}\n\nFirst turn incoming...`, { parse_mode: "Markdown" });
  await sendNextTurn(ctx, chatId);
});

bot.command("score", async (ctx) => {
  if (ctx.chat.type === "private") return;
  const chatId = String(ctx.chat.id);
  const board = db.getLeaderboard(chatId);
  if (!board.length) return ctx.reply("No players yet! Use /join to start.");
  const lines = board.map((p, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
    return `${medal} ${displayName(p)}${p.alive ? "" : " 💀"} — ${p.points} pts`;
  });
  ctx.reply(`📊 *Scoreboard*\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
});

bot.command("newgame", async (ctx) => {
  if (ctx.chat.type === "private") return;
  db.resetGame(String(ctx.chat.id));
  ctx.reply("🔄 Game reset! Use /join to register players, then /startgame.");
});

// ── CALLBACKS ─────────────────────────────────────────────────────────────

// Target picks Truth or Dare → questioner gets question picker
bot.action(/^choice:(truth|dare):(-?\d+)$/, async (ctx) => {
  const choice = ctx.match[1];
  const chatId = ctx.match[2];
  const userId = String(ctx.from.id);
  await ctx.answerCbQuery();

  const game = db.getGame(chatId);
  if (!game || game.status !== "active") return ctx.editMessageText("❌ No active game.");
  if (game.current_target !== userId) return ctx.answerCbQuery("This isn't your turn!", { show_alert: true });

  await ctx.editMessageText(
    `You chose *${choice === "truth" ? "🤔 Truth" : "🔥 Dare"}*!\n\nWaiting for the questioner to pick your question... 👀`,
    { parse_mode: "Markdown" }
  );

  // Tell the group
  const target = db.getPlayer(chatId, userId);
  await ctx.telegram.sendMessage(
    chatId,
    `${displayName(target)} chose *${choice === "truth" ? "🤔 Truth" : "🔥 Dare"}*!\n\n⏳ Waiting for the questioner to pick a question...`,
    { parse_mode: "Markdown" }
  );

  // Send question picker to questioner
  await sendQuestionPicker(ctx, game.current_questioner, userId, chatId, choice);
});

// Questioner picks a question from the list
bot.action(/^pick:(-?\d+):(\d+):(.+)$/, async (ctx) => {
  const chatId = ctx.match[1];
  const question = decodeURIComponent(ctx.match[3]);
  const userId = String(ctx.from.id);
  await ctx.answerCbQuery("Question selected! ✅");

  const game = db.getGame(chatId);
  if (!game || game.status !== "active") return ctx.editMessageText("❌ No active game.");
  if (game.current_questioner !== userId) return ctx.answerCbQuery("You're not the questioner!", { show_alert: true });

  recordChoice(chatId, game.current_choice, question);

  // Confirm to questioner
  await ctx.editMessageText(
    `✅ You picked:\n\n_"${question}"_\n\nThe challenge has been posted in the group!`,
    { parse_mode: "Markdown" }
  );

  const target = db.getPlayer(chatId, game.current_target);
  const choice = game.current_choice;

  // Post challenge in group with DONE/FAIL buttons
  await ctx.telegram.sendMessage(
    chatId,
    `🎯 *Challenge Revealed!*\n\n${displayName(target)} chose *${choice === "truth" ? "🤔 Truth" : "🔥 Dare"}*:\n\n_"${question}"_`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([[
        Markup.button.callback("✅ DONE (+5 pts)", `result:done:${chatId}`),
        Markup.button.callback("❌ FAIL (eliminated)", `result:fail:${chatId}`),
      ]]),
    }
  );
});

// DONE or FAIL
bot.action(/^result:(done|fail):(-?\d+)$/, async (ctx) => {
  const result = ctx.match[1];
  const chatId = ctx.match[2];
  await ctx.answerCbQuery();

  const game = db.getGame(chatId);
  if (!game || game.status !== "active") return ctx.editMessageText("❌ No active game.");
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

  if (result === "done") {
    const { target } = handleDone(chatId);
    await ctx.reply(`✅ *${displayName(target)} completed the challenge! +5 points* 🎉`, { parse_mode: "Markdown" });
  } else {
    const { target, alive } = handleFail(chatId);
    await ctx.reply(`💀 *${displayName(target)} failed and is eliminated!*\n\n${alive.length} players remaining.`, { parse_mode: "Markdown" });
  }

  const winner = checkWinner(chatId);
  if (winner && winner !== "draw") {
    db.endGame(chatId);
    return ctx.reply(`🏆 *${displayName(winner)} WINS THE GAME!* 🎊\n\nFinal score: ${winner.points} points\n\nUse /newgame to play again!`, { parse_mode: "Markdown" });
  }
  if (winner === "draw") {
    db.endGame(chatId);
    return ctx.reply("😅 Everyone eliminated! It's a draw! Use /newgame to play again.");
  }

  advanceRound(chatId);
  setTimeout(() => sendNextTurn(ctx, chatId), 2000);
});

// ── LAUNCH ────────────────────────────────────────────────────────────────

async function main() {
  db.init();
  console.log("✅ Database initialized");
  bot.launch();
  console.log("🤖 Truth or Dare Bot is running...");
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

main().catch(console.error);
