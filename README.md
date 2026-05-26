# 🎭 Truth or Dare Telegram Bot

A multiplayer Truth or Dare bot for Telegram groups. Players join, get randomly paired each round, choose Truth or Dare via DM, and earn points or get eliminated.

## Features
- `/join` — players register before the game
- `/startgame` — host kicks off the game
- Random questioner + target selection each round
- DM-based choice (Truth or Dare) for privacy
- DONE (+5 pts) / FAIL (eliminated) buttons
- Auto-detects winner when 1 player remains
- Persistent SQLite database
- `/score` leaderboard anytime
- `/newgame` to reset

---

## Setup

### 1. Create the bot
1. Open [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot`
3. Choose a name and username
4. Copy the `BOT_TOKEN`

### 2. Clone / setup project

```bash
git clone <your-repo>
cd truth-dare-bot
npm install
```

Or from scratch:
```bash
mkdir truth-dare-bot && cd truth-dare-bot
npm install
```

### 3. Configure environment
```bash
cp .env.example .env
# Edit .env and paste your token:
# BOT_TOKEN=123456789:ABCdef...
```

### 4. Install SQLite (if not installed)
```bash
npm install sqlite3
```
> Note: `sqlite3` requires native compilation. If it fails:
> - **Ubuntu/Debian**: `sudo apt-get install python3 make g++` then retry
> - **Mac**: Should work out of the box
> - **Windows**: Install Visual Studio Build Tools

### 5. Run the bot
```bash
node index.js
# or
npm start
```

---

## How to Play

1. Add the bot to a Telegram group
2. Everyone sends `/join` in the group
3. Host sends `/startgame`
4. Each round:
   - Bot announces questioner + target
   - Target gets a DM: choose **Truth** or **Dare**
   - Questioner gets the question/dare via DM
   - Bot announces the challenge in the group
   - Group votes **✅ DONE** or **❌ FAIL**
5. DONE = +5 points | FAIL = eliminated
6. Last player standing wins!

---

## Commands

| Command | Description |
|---------|-------------|
| `/join` | Join the current game session |
| `/startgame` | Start the game (need 2+ players) |
| `/score` | Show current leaderboard |
| `/newgame` | Reset everything, start fresh |

---

## Git Setup & Push

```bash
# First time — init and push to GitHub
git init
git add .
git commit -m "feat: initial truth or dare bot"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/truth-dare-bot.git
git push -u origin main

# After changes
git add .
git commit -m "feat: add timer feature"
git push
```

---

## Deploy to Railway

1. Push to GitHub (above)
2. Go to [railway.app](https://railway.app)
3. New Project → Deploy from GitHub repo
4. Add environment variable: `BOT_TOKEN=your_token`
5. Done — bot runs 24/7

---

## Project Structure

```
truth-dare-bot/
├── index.js       ← Bot setup, commands, callback handlers
├── game.js        ← Game logic (turns, scoring, elimination)
├── db.js          ← SQLite database layer
├── questions.js   ← Truth and dare question lists
├── .env           ← Your BOT_TOKEN (never commit this!)
├── .gitignore     ← Ignores node_modules, .env, game.db
└── package.json
```

---

## Extending the Bot

Ask Claude to add features one at a time:

- `"Add a 60-second timer per turn using setTimeout"`
- `"Add /addtruth and /adddare commands for custom questions"`
- `"Add a skip command that costs 2 points"`
- `"Add a /stats command showing win/loss history"`
