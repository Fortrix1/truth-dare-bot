require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const db = require("./db");
const { truths, dares, addTruth, addDare } = require("./questions");
const {
  pickNextPair, startGame, recordChoice, handleDone, handleFail,
  checkWinner, advanceRound, displayName,
} = require("./game");

const bot = new Telegraf(process.env.BOT_TOKEN);
const BOT_USERNAME = process.env.BOT_USERNAME || "your_bot";
const TURN_TIMEOUT = 30; // seconds
const timers = {}; // store active timers

function botLink() {
  const username = global.BOT_USERNAME || BOT_USERNAME;
  return `👉 [Open bot DM](https://t.me/${global.BOT_USERNAME || BOT_USERNAME})`;
}

function clearTimer(chatId) {
  if (timers[chatId]) { clearTimeout(timers[chatId]); delete timers[chatId]; }
}

function startTimer(ctx, chatId, targetId, targetName) {
  clearTimer(chatId);
  timers[chatId] = setTimeout(async () => {
    const game = db.getGame(chatId);
    if (!game || game.status !== "active") return;
    if (game.current_target !== targetId) return;
    if (!game.waiting_answer) return; // already answered

    db.eliminatePlayer(chatId, targetId);
    const alive = db.getPlayers(chatId, true);
    await ctx.telegram.sendMessage(chatId,
      `⏰ *Time's up! ${targetName} didn't answer in ${TURN_TIMEOUT} seconds and is eliminated!*\n\n${alive.length} players remaining.`,
      { parse_mode: "Markdown" }
    );

    const winner = checkWinner(chatId);
    if (winner && winner !== "draw") {
      db.endGame(chatId);
      return ctx.telegram.sendMessage(chatId,
        `🏆 *${displayName(winner)} WINS!* 🎊\n\nFinal score: ${winner.points} points\n\nUse /newgame to play again!`,
        { parse_mode: "Markdown" }
      );
    }
    if (winner === "draw") {
      db.endGame(chatId);
      return ctx.telegram.sendMessage(chatId, "😅 Everyone eliminated! Draw! Use /newgame.");
    }

    advanceRound(chatId);
    setTimeout(() => sendNextTurn(ctx, chatId), 2000);
  }, TURN_TIMEOUT * 1000);
}

// Pick 5 questions as buttons for questioner
async function sendQuestionPicker(ctx, questionerId, targetId, chatId, choice) {
  const custom = db.getCustomQuestions();
  const baseList = choice === "truth" ? truths : dares;
  const customList = choice === "truth" ? custom.truths : custom.dares;
  const fullList = [...baseList, ...customList];
  const shuffled = [...fullList].sort(() => Math.random() - 0.5).slice(0, 5);

  const target = db.getPlayer(chatId, targetId);
  const buttons = shuffled.map((q, i) =>
    [Markup.button.callback(`${i + 1}. ${q.slice(0, 50)}${q.length > 50 ? "..." : ""}`, `pick:${chatId}:${encodeURIComponent(q.slice(0, 200))}`)]
  );

  // Add custom question option
  buttons.push([Markup.button.callback("✍️ Write custom question", `custompick:${chatId}:${choice}`)]);

  try {
    await ctx.telegram.sendMessage(questionerId,
      `📋 *${displayName(target)}* chose *${choice === "truth" ? "🤔 Truth" : "🔥 Dare"}*!\n\nPick a question or write your own:`,
      { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) }
    );
  } catch (e) {
    // fallback: random question
    const question = shuffled[0];
    recordChoice(chatId, choice, question);
    await postChallengeToGroup(ctx, chatId, targetId, choice, question);
  }
}

async function postChallengeToGroup(ctx, chatId, targetId, choice, question) {
  const target = db.getPlayer(chatId, targetId);
  db.updateGame(chatId, { waiting_answer: true });

  await ctx.telegram.sendMessage(chatId,
    `🎯 *Challenge!*\n\n${displayName(target)} must answer this *${choice === "truth" ? "🤔 Truth" : "🔥 Dare"}*:\n\n_"${question}"_\n\n⏰ ${TURN_TIMEOUT} seconds to answer in DMs!\n\n${botLink()}`,
    { parse_mode: "Markdown" }
  );

  // DM the target telling them to answer
  try {
    await ctx.telegram.sendMessage(targetId,
      `⏰ *You have ${TURN_TIMEOUT} seconds!*\n\nYour challenge:\n\n_"${question}"_\n\n📝 Type your answer here (or send a photo as proof). It will be posted to the group!\n\n💡 Options:\n• Just type/send your answer\n• Use /skip to skip (costs 200 pts)\n• Use /custom to send a custom reply (costs 100 pts)`,
      { parse_mode: "Markdown" }
    );
  } catch (e) {}

  startTimer(ctx, chatId, targetId, displayName(target));
}

async function sendNextTurn(ctx, chatId) {
  const turn = pickNextPair(chatId);
  if (!turn) {
    const winner = checkWinner(chatId);
    if (winner && winner !== "draw") {
      db.endGame(chatId);
      const board = db.getLeaderboard(chatId);
      const lines = board.map((p, i) => `${i + 1}. ${displayName(p)} — ${p.points} pts${p.alive ? "" : " 💀"}`).join("\n");
      return ctx.telegram.sendMessage(chatId,
        `🏆 *${displayName(winner)} WINS!* 🎊\n\n📊 Final Scoreboard:\n${lines}\n\nUse /newgame to play again!`,
        { parse_mode: "Markdown" }
      );
    }
    if (winner === "draw") {
      db.endGame(chatId);
      return ctx.telegram.sendMessage(chatId, "😅 Draw! Use /newgame.");
    }
  }

  const { questioner, target } = turn;
  db.updateGame(chatId, {
    current_questioner: questioner.user_id,
    current_target: target.user_id,
    waiting_answer: false,
  });
  db.incrementTurnCount(chatId, target.user_id, "target");
  db.incrementTurnCount(chatId, questioner.user_id, "questioner");

  const game = db.getGame(chatId);

  await ctx.telegram.sendMessage(chatId,
    `🎲 *Round ${game.round}!*\n\n🎤 Questioner: ${displayName(questioner)}\n🎯 Target: ${displayName(target)}\n\n${displayName(target)}, check your DMs and pick Truth or Dare!\n\n${botLink()}`,
    { parse_mode: "Markdown" }
  );

  try {
    await ctx.telegram.sendMessage(target.user_id,
      `🎯 *You've been chosen!*\n\n*${displayName(questioner)}* is asking you.\n\nWhat do you choose?`,
      { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback("🤔 Truth", `choice:truth:${chatId}`), Markup.button.callback("🔥 Dare", `choice:dare:${chatId}`)]]) }
    );
  } catch (e) {
    await ctx.telegram.sendMessage(chatId, `⚠️ Couldn't DM ${displayName(target)}. They need to /start the bot first! Skipping...`);
    advanceRound(chatId);
    return sendNextTurn(ctx, chatId);
  }
}

// ── COMMANDS ──────────────────────────────────────────────────────────────

bot.start(async (ctx) => {
  if (ctx.chat.type === "private") {
    await ctx.reply(
      "👋 Hey! I'm the *Truth or Dare Bot*!\n\nAdd me to a group to play with friends!\n\n📖 Commands:\n/join — Join the game\n/startgame — Start (host)\n/score — Leaderboard\n/rules — How to play\n/newgame — Reset",
      { parse_mode: "Markdown" }
    );
  }
});

bot.command("rules", async (ctx) => {
  await ctx.reply(
    `📖 *Truth or Dare — Rules*\n\n` +
    `1. Everyone does /join in the group\n` +
    `2. Host does /startgame\n` +
    `3. Each round: a Questioner and Target are picked fairly\n` +
    `4. Target chooses Truth or Dare via DM\n` +
    `5. Questioner picks the question from a list\n` +
    `6. Target has *30 seconds* to answer in DMs\n` +
    `7. Answer is posted to the group\n` +
    `8. Questioner marks as ✅ Answered or ❌ Failed\n` +
    `9. Fail = eliminated. Last one standing wins!\n\n` +
    `💰 *Points System:*\n` +
    `• +5 pts — Answer a challenge\n` +
    `• 100 pts — Send a custom question this round\n` +
    `• 150 pts — Add question to the pool permanently\n` +
    `• 200 pts — Skip your turn\n\n` +
    `⏰ *Timer:* 30 seconds to answer or you're out!\n\n` +
    `${botLink()}`,
    { parse_mode: "Markdown" }
  );
});

bot.command("join", async (ctx) => {
  if (ctx.chat.type === "private") return ctx.reply("Join a group first, then use /join there!");
  const chatId = String(ctx.chat.id);
  const userId = String(ctx.from.id);

  let game = db.getGame(chatId);
  if (!game) { db.createGame(chatId); game = db.getGame(chatId); }
  if (game.status === "active") return ctx.reply("⚠️ A game is already running!");
  if (game.status === "ended") return ctx.reply("⚠️ Game over. Use /newgame.");

  const joined = db.addPlayer(chatId, userId, ctx.from.username, ctx.from.first_name);
  if (!joined) return ctx.reply(`${ctx.from.first_name}, you already joined! 😄`);

  const players = db.getPlayers(chatId);
  ctx.reply(
    `✅ *${ctx.from.first_name}* joined!\n\n👥 Players (${players.length}): ${players.map(displayName).join(", ")}\n\nHost can /startgame when ready.\n\n${botLink()}`,
    { parse_mode: "Markdown" }
  );
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
  await ctx.reply(
    `🎉 *Truth or Dare starts NOW!*\n\n${players.length} players: ${players.map(displayName).join(", ")}\n\n📖 Use /rules to see how to play\n${botLink()}`,
    { parse_mode: "Markdown" }
  );
  await sendNextTurn(ctx, chatId);
});

bot.command("score", async (ctx) => {
  if (ctx.chat.type === "private") return;
  const chatId = String(ctx.chat.id);
  const board = db.getLeaderboard(chatId);
  if (!board.length) return ctx.reply("No players yet!");
  const lines = board.map((p, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
    return `${medal} ${displayName(p)}${p.alive ? "" : " 💀"} — ${p.points} pts`;
  });
  ctx.reply(`📊 *Scoreboard*\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
});

bot.command("newgame", async (ctx) => {
  if (ctx.chat.type === "private") return;
  const chatId = String(ctx.chat.id);
  clearTimer(chatId);
  db.resetGame(chatId);
  ctx.reply("🔄 Game reset! Use /join to register players, then /startgame.");
});

// Skip command (in private DM)
bot.command("skip", async (ctx) => {
  if (ctx.chat.type !== "private") return;
  const userId = String(ctx.from.id);

  // Find which game this player is target in
  const data = require("./db");
  // We need to find the chatId — store it in a pending map
  const pending = pendingTargets[userId];
  if (!pending) return ctx.reply("You don't have an active turn to skip!");

  const { chatId } = pending;
  const player = db.getPlayer(chatId, userId);
  if (!player) return ctx.reply("You're not in a game!");
  if (player.points < 200) return ctx.reply(`❌ You need 200 points to skip. You have ${player.points} pts.`);

  db.deductPoints(chatId, userId, 200);
  clearTimer(chatId);
  delete pendingTargets[userId];

  await ctx.reply("⏭️ Turn skipped! (-200 pts)");
  await bot.telegram.sendMessage(chatId,
    `⏭️ *${displayName(player)} used 200 points to skip their turn!*`,
    { parse_mode: "Markdown" }
  );

  advanceRound(chatId);
  setTimeout(() => sendNextTurn(ctx, chatId), 2000);
});

// Custom question command (in private DM) - spend 100 pts to write custom
bot.command("custom", async (ctx) => {
  if (ctx.chat.type !== "private") return;
  const userId = String(ctx.from.id);
  const pending = pendingTargets[userId];
  if (!pending) return ctx.reply("You don't have an active turn!");

  const { chatId } = pending;
  const player = db.getPlayer(chatId, userId);
  if (player.points < 100) return ctx.reply(`❌ You need 100 points to send a custom reply. You have ${player.points} pts.`);

  pendingCustom[userId] = { chatId, type: "reply" };
  ctx.reply("✍️ Type your custom answer/reply. It will be posted to the group for 100 pts:");
});

// Track players waiting to answer and custom states
const pendingTargets = {}; // userId -> { chatId }
const pendingCustom = {}; // userId -> { chatId, type }
const pendingPoolAdd = {}; // userId -> { chatId, questionType }
const pendingCustomPick = {}; // userId -> { chatId, choice } (questioner writing custom question)

// ── CALLBACKS ─────────────────────────────────────────────────────────────

// Target picks Truth or Dare
bot.action(/^choice:(truth|dare):(-?\d+)$/, async (ctx) => {
  const choice = ctx.match[1];
  const chatId = ctx.match[2];
  const userId = String(ctx.from.id);
  await ctx.answerCbQuery();

  const game = db.getGame(chatId);
  if (!game || game.status !== "active") return ctx.editMessageText("❌ No active game.");
  if (game.current_target !== userId) return ctx.answerCbQuery("This isn't your turn!", { show_alert: true });

  await ctx.editMessageText(
    `You chose *${choice === "truth" ? "🤔 Truth" : "🔥 Dare"}*!\n\nWaiting for the questioner to pick your challenge... 👀`,
    { parse_mode: "Markdown" }
  );

  const target = db.getPlayer(chatId, userId);
  await ctx.telegram.sendMessage(chatId,
    `${displayName(target)} chose *${choice === "truth" ? "🤔 Truth" : "🔥 Dare"}*!\n\n⏳ Questioner is picking the question...`,
    { parse_mode: "Markdown" }
  );

  await sendQuestionPicker(ctx, game.current_questioner, userId, chatId, choice);
});

// Questioner picks a question
bot.action(/^pick:(-?\d+):(.+)$/, async (ctx) => {
  const chatId = ctx.match[1];
  const question = decodeURIComponent(ctx.match[2]);
  const userId = String(ctx.from.id);
  await ctx.answerCbQuery("Question selected! ✅");

  const game = db.getGame(chatId);
  if (!game || game.status !== "active") return ctx.editMessageText("❌ No active game.");
  if (game.current_questioner !== userId) return ctx.answerCbQuery("You're not the questioner!", { show_alert: true });

  recordChoice(chatId, game.current_choice, question);
  await ctx.editMessageText(`✅ You picked:\n\n_"${question}"_\n\nPosted to the group!`, { parse_mode: "Markdown" });

  // Track target as pending answer
  pendingTargets[game.current_target] = { chatId };

  await postChallengeToGroup(ctx, chatId, game.current_target, game.current_choice, question);
});

// Questioner wants to write a custom question
bot.action(/^custompick:(-?\d+):(truth|dare)$/, async (ctx) => {
  const chatId = ctx.match[1];
  const choice = ctx.match[2];
  const userId = String(ctx.from.id);
  await ctx.answerCbQuery();

  const game = db.getGame(chatId);
  if (!game || game.status !== "active") return;
  if (game.current_questioner !== userId) return ctx.answerCbQuery("You're not the questioner!", { show_alert: true });

  const player = db.getPlayer(chatId, userId);
  if (player.points < 100) {
    return ctx.editMessageText(`❌ You need 100 points to write a custom question. You have ${player.points} pts.\n\nPick from the list instead.`);
  }

  pendingCustomPick[userId] = { chatId, choice };
  await ctx.editMessageText(
    `✍️ Write your custom *${choice}* question/dare.\n\nWant it added to the pool permanently? It costs 150 pts instead of 100.\n\nJust type your question now:`,
    { parse_mode: "Markdown" }
  );
});

// DONE button - questioner marks answer as accepted
bot.action(/^answered:(-?\d+)$/, async (ctx) => {
  const chatId = ctx.match[1];
  const userId = String(ctx.from.id);
  await ctx.answerCbQuery();

  const game = db.getGame(chatId);
  if (!game || game.status !== "active") return ctx.editMessageText("❌ No active game.");
  if (game.current_questioner !== userId) return ctx.answerCbQuery("Only the questioner can mark this!", { show_alert: true });

  clearTimer(chatId);
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

  const { target } = handleDone(chatId);
  const targetPlayer = db.getPlayer(chatId, target.user_id);
  delete pendingTargets[target.user_id];

  await ctx.reply(`✅ *${displayName(target)} answered the challenge! +5 points* 🎉`, { parse_mode: "Markdown" });

  // Notify target
  try {
    await ctx.telegram.sendMessage(target.user_id, "✅ Your answer was accepted! +5 points 🎉");
  } catch (e) {}

  const winner = checkWinner(chatId);
  if (winner && winner !== "draw") {
    db.endGame(chatId);
    const board = db.getLeaderboard(chatId);
    const lines = board.map((p, i) => `${i + 1}. ${displayName(p)} — ${p.points} pts${p.alive ? "" : " 💀"}`).join("\n");
    return ctx.reply(`🏆 *${displayName(winner)} WINS!* 🎊\n\n📊 Final Scoreboard:\n${lines}\n\nUse /newgame to play again!`, { parse_mode: "Markdown" });
  }
  if (winner === "draw") {
    db.endGame(chatId);
    return ctx.reply("😅 Draw! Use /newgame.");
  }

  advanceRound(chatId);
  setTimeout(() => sendNextTurn(ctx, chatId), 2000);
});

// FAIL button
bot.action(/^fail:(-?\d+)$/, async (ctx) => {
  const chatId = ctx.match[1];
  const userId = String(ctx.from.id);
  await ctx.answerCbQuery();

  const game = db.getGame(chatId);
  if (!game || game.status !== "active") return ctx.editMessageText("❌ No active game.");
  if (game.current_questioner !== userId) return ctx.answerCbQuery("Only the questioner can mark this!", { show_alert: true });

  clearTimer(chatId);
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

  const { target, alive } = handleFail(chatId);
  delete pendingTargets[target.user_id];

  await ctx.reply(`💀 *${displayName(target)} failed and is eliminated!*\n\n${alive.length} players remaining.`, { parse_mode: "Markdown" });

  const winner = checkWinner(chatId);
  if (winner && winner !== "draw") {
    db.endGame(chatId);
    const board = db.getLeaderboard(chatId);
    const lines = board.map((p, i) => `${i + 1}. ${displayName(p)} — ${p.points} pts${p.alive ? "" : " 💀"}`).join("\n");
    return ctx.reply(`🏆 *${displayName(winner)} WINS!* 🎊\n\n📊 Final Scoreboard:\n${lines}\n\nUse /newgame to play again!`, { parse_mode: "Markdown" });
  }
  if (winner === "draw") {
    db.endGame(chatId);
    return ctx.reply("😅 Draw! Use /newgame.");
  }

  advanceRound(chatId);
  setTimeout(() => sendNextTurn(ctx, chatId), 2000);
});

// Add to pool buttons
bot.action(/^addpool:(yes|no):(-?\d+)$/, async (ctx) => {
  const addToPool = ctx.match[1] === "yes";
  const chatId = ctx.match[2];
  const userId = String(ctx.from.id);
  await ctx.answerCbQuery();

  const pending = pendingPoolAdd[userId];
  if (!pending) return ctx.editMessageText("Session expired.");

  const { question, choice } = pending;
  const player = db.getPlayer(chatId, userId);
  const cost = addToPool ? 150 : 100;

  if (player.points < cost) {
    delete pendingPoolAdd[userId];
    return ctx.editMessageText(`❌ Not enough points. Need ${cost}, you have ${player.points}.`);
  }

  db.deductPoints(chatId, userId, cost);
  if (addToPool) {
    db.addCustomQuestion(choice === "truth" ? "truths" : "dares", question);
    if (choice === "truth") addTruth(question);
    else addDare(question);
  }

  delete pendingPoolAdd[userId];

  await ctx.editMessageText(`✅ Custom question sent! (-${cost} pts)${addToPool ? "\n🏊 Added to the pool permanently!" : ""}`);

  // Now post it as the challenge
  const game = db.getGame(chatId);
  recordChoice(chatId, choice, question);
  pendingTargets[game.current_target] = { chatId };
  await postChallengeToGroup(ctx, chatId, game.current_target, choice, question);
});

// ── MESSAGE HANDLER (answers in DM) ───────────────────────────────────────

bot.on("message", async (ctx) => {
  if (ctx.chat.type !== "private") return;
  const userId = String(ctx.from.id);

  // Questioner writing custom question
  if (pendingCustomPick[userId]) {
    const { chatId, choice } = pendingCustomPick[userId];
    const question = ctx.message.text;
    if (!question) return ctx.reply("Please type a text question.");

    delete pendingCustomPick[userId];
    pendingPoolAdd[userId] = { chatId, question, choice };

    return ctx.reply(
      `Your custom question:\n\n_"${question}"_\n\nDo you want to add it to the pool permanently?\n• Yes = 150 pts\n• No = 100 pts (one time use)`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🏊 Yes, add to pool (150 pts)", `addpool:yes:${chatId}`)],
          [Markup.button.callback("📤 No, just this round (100 pts)", `addpool:no:${chatId}`)],
        ])
      }
    );
  }

  // Target sending their answer
  if (pendingTargets[userId]) {
    const { chatId } = pendingTargets[userId];
    const game = db.getGame(chatId);
    if (!game || game.status !== "active") return;
    if (game.current_target !== userId) return;
    if (!game.waiting_answer) return;

    clearTimer(chatId);
    db.updateGame(chatId, { waiting_answer: false });
    delete pendingTargets[userId];

    const player = db.getPlayer(chatId, userId);
    await ctx.reply("✅ Answer sent to the group!");

    // Forward answer to group
    if (ctx.message.photo) {
      // It's a photo
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      await ctx.telegram.sendPhoto(chatId, photo.file_id, {
        caption: `📸 *${displayName(player)}'s answer:*${ctx.message.caption ? "\n" + ctx.message.caption : ""}`,
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([[
          Markup.button.callback("✅ Answered (+5 pts)", `answered:${chatId}`),
          Markup.button.callback("❌ Failed", `fail:${chatId}`),
        ]])
      });
    } else if (ctx.message.text) {
      await ctx.telegram.sendMessage(chatId,
        `💬 *${displayName(player)}'s answer:*\n\n"${ctx.message.text}"`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([[
            Markup.button.callback("✅ Answered (+5 pts)", `answered:${chatId}`),
            Markup.button.callback("❌ Failed", `fail:${chatId}`),
          ]])
        }
      );
    } else if (ctx.message.voice) {
      await ctx.telegram.forwardMessage(chatId, ctx.chat.id, ctx.message.message_id);
      await ctx.telegram.sendMessage(chatId,
        `🎤 *${displayName(player)} sent a voice message as their answer!*`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([[
            Markup.button.callback("✅ Answered (+5 pts)", `answered:${chatId}`),
            Markup.button.callback("❌ Failed", `fail:${chatId}`),
          ]])
        }
      );
    } else {
      // Other media - forward it
      await ctx.telegram.forwardMessage(chatId, ctx.chat.id, ctx.message.message_id);
      await ctx.telegram.sendMessage(chatId,
        `*${displayName(player)} sent their answer above!*`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([[
            Markup.button.callback("✅ Answered (+5 pts)", `answered:${chatId}`),
            Markup.button.callback("❌ Failed", `fail:${chatId}`),
          ]])
        }
      );
    }
    return;
  }
});

// ── LAUNCH ────────────────────────────────────────────────────────────────

async function main() {
  db.init();
  console.log("✅ Database initialized");

  // Get bot username for links
  const me = await bot.telegram.getMe();
  Object.assign(module.exports, { BOT_USERNAME: me.username });
  // Update botLink dynamically
  global.BOT_USERNAME = me.username;

  bot.launch();
  console.log(`🤖 Truth or Dare Bot @${me.username} is running...`);
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

main().catch(console.error);
