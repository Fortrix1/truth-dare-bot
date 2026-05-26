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
  const game = db.getGame(chatId);
  const questionerId = game.current_questioner;
  db.updateGame(chatId, { waiting_answer: true });

  const dmUrl = `https://t.me/${global.BOT_USERNAME || BOT_USERNAME}`;

  await ctx.telegram.sendMessage(chatId,
    `🎯 *Challenge!*\n\n${displayName(target)} must answer this *${choice === "truth" ? "🤔 Truth" : "🔥 Dare"}*:\n\n_"${question}"_\n\n⏰ *${TURN_TIMEOUT} seconds* to answer in DMs!\n\n${displayName(target)}, open the bot and type your answer there 👇`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.url("📱 Open Bot DM to Answer", dmUrl)],
      ])
    }
  );

  // DM the target
  try {
    await ctx.telegram.sendMessage(targetId,
      `⏰ *You have ${TURN_TIMEOUT} seconds!*\n\nYour challenge:\n\n_"${question}"_\n\n📝 *Type your answer here* (or send a photo as proof).\nIt will be posted to the group automatically!\n\n💡 Other options:\n• /skip — Skip your turn (costs 200 pts)\n• /custom — Write a custom reply (costs 100 pts)`,
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

  const dmUrl = `https://t.me/${global.BOT_USERNAME || BOT_USERNAME}`;

  await ctx.telegram.sendMessage(chatId,
    `🎲 *Round ${game.round}!*\n\n🎤 Questioner: ${displayName(questioner)}\n🎯 Target: ${displayName(target)}\n\n${displayName(target)}, open the bot DM to pick Truth or Dare!\n${displayName(questioner)}, stand by — you'll pick the question next!`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.url("📱 Open Bot DM", dmUrl)],
      ])
    }
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
      `👋 Hey *${ctx.from.first_name}*! I'm the *Truth or Dare Bot*! 🎭\n\nAdd me to a group to play with friends!\n\nWhat do you want to do?`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("📖 How to Play", "show:rules")],
          [Markup.button.callback("📊 My Score", "show:score")],
          [Markup.button.callback("💰 Points Guide", "show:points")],
        ])
      }
    );
  }
});

bot.action("show:rules", async (ctx) => {
  await ctx.answerCbQuery();
  const username = global.BOT_USERNAME || BOT_USERNAME;
  await ctx.editMessageText(
    `📖 *How to Play*\n\n` +
    `*Setting up:*\n` +
    `1. Add me to a group\n` +
    `2. Everyone sends /join in the group\n` +
    `3. Host sends /startgame\n\n` +
    `*Each round:*\n` +
    `4. Bot picks Questioner & Target fairly\n` +
    `5. Target opens DM → picks Truth or Dare\n` +
    `6. Questioner opens DM → picks the question\n` +
    `7. Target has ⏰ *30 seconds* to answer in DMs\n` +
    `8. Answer is posted to the group automatically\n` +
    `9. Questioner clicks ✅ Answered or ❌ Failed\n` +
    `10. Fail = eliminated. Last one standing wins!\n\n` +
    `👉 [Open a group and add me](https://t.me/${username})`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([[Markup.button.callback("⬅️ Back", "show:home")]])
    }
  );
});

bot.action("show:points", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `💰 *Points Guide*\n\n` +
    `*Earning points:*\n` +
    `✅ +5 pts — Answer a challenge\n\n` +
    `*Spending points:*\n` +
    `✍️ 100 pts — Write a custom question this round\n` +
    `🏊 150 pts — Add your question to the pool forever\n` +
    `⏭️ 200 pts — Skip your turn\n\n` +
    `*How to spend:*\n` +
    `• When it's your turn, you'll see options in DM\n` +
    `• Type /skip in DM to skip (costs 200 pts)\n` +
    `• Type /custom in DM to write custom reply (100 pts)`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([[Markup.button.callback("⬅️ Back", "show:home")]])
    }
  );
});

bot.action("show:score", async (ctx) => {
  await ctx.answerCbQuery();
  const userId = String(ctx.from.id);
  const myEntries = db.getAllPlayerEntries(userId);

  if (!myEntries.length) {
    return ctx.editMessageText(
      "📊 You haven't played any games yet!\n\nJoin a group and use /join to start playing.",
      { ...Markup.inlineKeyboard([[Markup.button.callback("⬅️ Back", "show:home")]]) }
    );
  }

  const lines = myEntries.map(p => `• ${p.points} pts — ${p.alive ? "🟢 Active" : "💀 Eliminated"}`);
  await ctx.editMessageText(
    `📊 *Your Stats*\n\n${lines.join("\n")}\n\nKeep playing to earn more points!`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([[Markup.button.callback("⬅️ Back", "show:home")]])
    }
  );
});

bot.action("show:home", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `👋 Hey *${ctx.from.first_name}*! I'm the *Truth or Dare Bot*! 🎭\n\nAdd me to a group to play with friends!\n\nWhat do you want to do?`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("📖 How to Play", "show:rules")],
        [Markup.button.callback("📊 My Score", "show:score")],
        [Markup.button.callback("💰 Points Guide", "show:points")],
      ])
    }
  );
});

bot.command("rules", async (ctx) => {
  const username = global.BOT_USERNAME || BOT_USERNAME;
  await ctx.reply(
    `📖 *How to Play*\n\n` +
    `1. Everyone sends /join in the group\n` +
    `2. Host sends /startgame (need 2+ players)\n` +
    `3. Bot picks Questioner & Target fairly each round\n` +
    `4. Target opens bot DM → picks Truth or Dare\n` +
    `5. Questioner opens bot DM → picks the question\n` +
    `6. Target has ⏰ *30 seconds* to type/send answer in DM\n` +
    `7. Answer is posted to the group automatically\n` +
    `8. Questioner clicks ✅ Answered or ❌ Failed\n` +
    `9. Fail = eliminated. Last standing wins!\n\n` +
    `💰 *Points:*\n` +
    `• ✅ +5 pts — Answer a challenge\n` +
    `• ✍️ 100 pts — Custom question this round\n` +
    `• 🏊 150 pts — Add to pool permanently\n` +
    `• ⏭️ 200 pts — Skip your turn\n\n` +
    `👉 [Open Bot DM](https://t.me/${username})`,
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
  if (ctx.chat.type === "private") {
    const userId = String(ctx.from.id);
    const myEntries = db.getAllPlayerEntries(userId);
    if (!myEntries.length) return ctx.reply("📊 You haven't played any games yet!\n\nJoin a group, use /join and start playing!");
    const lines = myEntries.map(p => `• ${p.points} pts — ${p.alive ? "🟢 Active" : "💀 Eliminated"}`);
    return ctx.reply(`📊 *Your Score*\n\n${lines.join("\n")}\n\nKeep playing to earn more points! 💪`, { parse_mode: "Markdown" });
  }
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
    const questionerId = game.current_questioner;
    await ctx.reply("✅ Answer sent to the group! Waiting for questioner to mark it...");

    // Post answer to group — NO buttons here (so only questioner can judge)
    if (ctx.message.photo) {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      await ctx.telegram.sendPhoto(chatId, photo.file_id, {
        caption: `📸 *${displayName(player)}'s answer:*${ctx.message.caption ? "\n" + ctx.message.caption : ""}`,
        parse_mode: "Markdown",
      });
    } else if (ctx.message.text) {
      await ctx.telegram.sendMessage(chatId,
        `💬 *${displayName(player)}'s answer:*\n\n"${ctx.message.text}"`,
        { parse_mode: "Markdown" }
      );
    } else if (ctx.message.voice) {
      await ctx.telegram.forwardMessage(chatId, ctx.chat.id, ctx.message.message_id);
      await ctx.telegram.sendMessage(chatId,
        `🎤 *${displayName(player)} sent a voice message as their answer!*`,
        { parse_mode: "Markdown" }
      );
    } else {
      await ctx.telegram.forwardMessage(chatId, ctx.chat.id, ctx.message.message_id);
      await ctx.telegram.sendMessage(chatId,
        `*${displayName(player)} sent their answer above!*`,
        { parse_mode: "Markdown" }
      );
    }

    // Send DONE/FAIL buttons ONLY to the questioner's DM
    try {
      await ctx.telegram.sendMessage(questionerId,
        `👀 *${displayName(player)} has answered!*\n\nCheck the group to see their answer, then mark it:`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([[
            Markup.button.callback("✅ Answered (+5 pts)", `answered:${chatId}`),
            Markup.button.callback("❌ Failed", `fail:${chatId}`),
          ]])
        }
      );
    } catch (e) {
      // Questioner has no DM open — post buttons in group as fallback with note
      await ctx.telegram.sendMessage(chatId,
        `⚠️ Questioner needs to open bot DM to judge!\n\n${displayName(player)}, the questioner hasn't started the bot in DM. Ask them to tap Start in the bot first.`
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
