require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const db = require("./db");
const {
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
} = require("./game");

const bot = new Telegraf(process.env.BOT_TOKEN);

// ── HELPERS ───────────────────────────────────────────────────────────────

async function sendNextTurn(ctx, chatId) {
  const turn = await pickNextTurn(chatId);
  if (!turn) {
    const winner = await checkWinner(chatId);
    if (winner && winner !== "draw") {
      await db.endGame(chatId);
      return ctx.reply(
        `🏆 *${displayName(winner)} wins the game with ${winner.points} points!*\n\nGG everyone! Use /newgame to play again.`,
        { parse_mode: "Markdown" }
      );
    }
    if (winner === "draw") {
      await db.endGame(chatId);
      return ctx.reply("😅 Everyone got eliminated. It's a draw! Use /newgame to play again.");
    }
  }

  const { questioner, target } = turn;
  await db.updateGame(chatId, {
    current_questioner: questioner.user_id,
    current_target: target.user_id,
  });

  await ctx.reply(
    `🎲 *Round time!*\n\n👤 Questioner: ${displayName(questioner)}\n🎯 Target: ${displayName(target)}\n\n${displayName(target)}, check your DMs!`,
    { parse_mode: "Markdown" }
  );

  // DM the target
  try {
    await ctx.telegram.sendMessage(
      target.user_id,
      `🎯 You've been chosen in *Truth or Dare*!\n\n${displayName(questioner)} is asking you.\n\nWhat do you choose?`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("🤔 Truth", `choice:truth:${chatId}`),
            Markup.button.callback("🔥 Dare", `choice:dare:${chatId}`),
          ],
        ]),
      }
    );
  } catch (e) {
    await ctx.reply(
      `⚠️ Couldn't DM ${displayName(target)}. They need to start the bot first with /start in a private chat.\n\nSkipping their turn...`
    );
    await advanceRound(chatId);
    return sendNextTurn(ctx, chatId);
  }
}

// ── COMMANDS ──────────────────────────────────────────────────────────────

bot.start(async (ctx) => {
  if (ctx.chat.type === "private") {
    await ctx.reply(
      "👋 Hey! I'm the *Truth or Dare Bot*.\n\nAdd me to a group to play with friends!\n\nCommands:\n/join — Join the game\n/startgame — Start the game (host)\n/score — See current scores\n/newgame — Reset and start fresh",
      { parse_mode: "Markdown" }
    );
  }
});

bot.command("join", async (ctx) => {
  if (ctx.chat.type === "private") {
    return ctx.reply("Join a group first, then use /join there!");
  }

  const chatId = String(ctx.chat.id);
  const userId = String(ctx.from.id);

  let game = await db.getGame(chatId);
  if (!game) {
    await db.createGame(chatId);
    game = await db.getGame(chatId);
  }

  if (game.status === "active") {
    return ctx.reply("⚠️ A game is already running! Wait for it to finish.");
  }
  if (game.status === "ended") {
    return ctx.reply("⚠️ Game over. Use /newgame to start fresh.");
  }

  const joined = await db.addPlayer(
    chatId,
    userId,
    ctx.from.username,
    ctx.from.first_name
  );

  if (!joined) {
    return ctx.reply(`${ctx.from.first_name}, you already joined! 😄`);
  }

  const players = await db.getPlayers(chatId);
  ctx.reply(
    `✅ *${ctx.from.first_name}* joined the game!\n\n👥 Players (${players.length}): ${players.map(displayName).join(", ")}\n\nWaiting for more... Host can /startgame when ready.`,
    { parse_mode: "Markdown" }
  );
});

bot.command("startgame", async (ctx) => {
  if (ctx.chat.type === "private") {
    return ctx.reply("This command only works in groups!");
  }

  const chatId = String(ctx.chat.id);
  const game = await db.getGame(chatId);

  if (!game) return ctx.reply("No game session. Use /join first!");
  if (game.status === "active") return ctx.reply("Game already started!");
  if (game.status === "ended") return ctx.reply("Use /newgame to reset.");

  const players = await db.getPlayers(chatId);
  if (players.length < 2) {
    return ctx.reply("Need at least 2 players! Use /join to add more.");
  }

  await startGame(chatId);

  await ctx.reply(
    `🎉 *Truth or Dare starts NOW!*\n\n${players.length} players: ${players.map(displayName).join(", ")}\n\nFirst turn incoming...`,
    { parse_mode: "Markdown" }
  );

  await sendNextTurn(ctx, chatId);
});

bot.command("score", async (ctx) => {
  if (ctx.chat.type === "private") return;

  const chatId = String(ctx.chat.id);
  const board = await db.getLeaderboard(chatId);

  if (!board.length) return ctx.reply("No players yet! Use /join to start.");

  const lines = board.map((p, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
    const status = p.alive ? "" : " 💀";
    return `${medal} ${displayName(p)}${status} — ${p.points} pts`;
  });

  ctx.reply(`📊 *Scoreboard*\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
});

bot.command("newgame", async (ctx) => {
  if (ctx.chat.type === "private") return;

  const chatId = String(ctx.chat.id);
  await db.resetGame(chatId);
  ctx.reply("🔄 Game reset! Use /join to register players, then /startgame.");
});

// ── CALLBACKS ─────────────────────────────────────────────────────────────

// Target chooses Truth or Dare
bot.action(/^choice:(truth|dare):(-?\d+)$/, async (ctx) => {
  const choice = ctx.match[1];
  const chatId = ctx.match[2];
  const userId = String(ctx.from.id);

  await ctx.answerCbQuery();

  const game = await db.getGame(chatId);
  if (!game || game.status !== "active") {
    return ctx.editMessageText("❌ No active game.");
  }
  if (game.current_target !== userId) {
    return ctx.answerCbQuery("This isn't your turn!", { show_alert: true });
  }

  const question = choice === "truth" ? getRandomTruth() : getRandomDare();
  await recordChoice(chatId, choice, question);

  await ctx.editMessageText(
    `You chose *${choice === "truth" ? "🤔 Truth" : "🔥 Dare"}*!\n\nWaiting for your questioner to get their question...`,
    { parse_mode: "Markdown" }
  );

  // DM the questioner
  const questioner = { user_id: game.current_questioner };
  const target = await db.getPlayer(chatId, userId);

  try {
    await ctx.telegram.sendMessage(
      game.current_questioner,
      `📋 ${displayName(target)} chose *${choice === "truth" ? "🤔 Truth" : "🔥 Dare"}*!\n\nTheir challenge:\n\n_"${question}"_\n\nRead it out in the group!`,
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    // Questioner can't receive DMs — post in group anyway
  }

  // Post challenge in the group
  await ctx.telegram.sendMessage(
    chatId,
    `🎯 *Challenge Revealed!*\n\n${displayName(target)} chose *${choice === "truth" ? "🤔 Truth" : "🔥 Dare"}*:\n\n_"${question}"_`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback("✅ DONE (+5 pts)", `result:done:${chatId}`),
          Markup.button.callback("❌ FAIL (eliminated)", `result:fail:${chatId}`),
        ],
      ]),
    }
  );
});

// DONE or FAIL buttons (anyone in group can press — host typically)
bot.action(/^result:(done|fail):(-?\d+)$/, async (ctx) => {
  const result = ctx.match[1];
  const chatId = ctx.match[2];

  await ctx.answerCbQuery();

  const game = await db.getGame(chatId);
  if (!game || game.status !== "active") {
    return ctx.editMessageText("❌ No active game.");
  }

  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); // remove buttons

  if (result === "done") {
    const { target } = await handleDone(chatId);
    await ctx.reply(
      `✅ *${displayName(target)} completed the challenge! +5 points* 🎉`,
      { parse_mode: "Markdown" }
    );
  } else {
    const { target, alive } = await handleFail(chatId);
    await ctx.reply(
      `💀 *${displayName(target)} failed and is eliminated!*\n\n${alive.length} players remaining.`,
      { parse_mode: "Markdown" }
    );
  }

  // Check for winner
  const winner = await checkWinner(chatId);
  if (winner && winner !== "draw") {
    await db.endGame(chatId);
    return ctx.reply(
      `🏆 *${displayName(winner)} WINS THE GAME!* 🎊\n\nFinal score: ${winner.points} points\n\nUse /newgame to play again!`,
      { parse_mode: "Markdown" }
    );
  }
  if (winner === "draw") {
    await db.endGame(chatId);
    return ctx.reply("😅 Everyone is eliminated! It's a draw! Use /newgame to play again.");
  }

  await advanceRound(chatId);
  setTimeout(() => sendNextTurn(ctx, chatId), 2000);
});

// ── LAUNCH ────────────────────────────────────────────────────────────────

async function main() {
  await db.init();
  console.log("✅ Database initialized");

  bot.launch();
  console.log("🤖 Truth or Dare Bot is running...");

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

main().catch(console.error);
