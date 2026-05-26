const truths = [
  "What's the most embarrassing thing you've done in public?",
  "Have you ever lied to get out of trouble? What was the lie?",
  "What's the worst gift you've ever received?",
  "Have you ever cheated on a test or exam?",
  "What's a secret you've never told anyone in this group?",
  "Who was your first crush and what happened?",
  "What's the most childish thing you still do?",
  "Have you ever blamed someone else for something you did?",
  "What's your most embarrassing nickname?",
  "What's the biggest lie you've told your parents?",
  "Have you ever stood someone up on a date?",
  "What's your most irrational fear?",
  "What's the worst thing you've ever said to someone?",
  "Have you ever pretended to be sick to avoid something?",
  "What's a habit you have that you're ashamed of?",
  "What's the most trouble you've ever been in?",
  "Have you ever stolen anything?",
  "What's the most embarrassing thing in your search history?",
  "Who in this group would you least want to be stranded with?",
  "What's a rumor you've spread that wasn't true?",
];

const dares = [
  "Send a voice message singing 'Happy Birthday' to someone in this group.",
  "Change your profile picture to a funny face for 1 hour.",
  "Send a cringe-worthy selfie to the group chat.",
  "Write a short poem about the person to your left (or the next player).",
  "Do your best impression of a person in this group — describe it in text.",
  "Send a message to someone outside this group saying 'I miss you' with no explanation.",
  "Type with your elbows for the next 3 minutes.",
  "Tell a joke so bad the group has to groan.",
  "Confess your most recent embarrassing moment.",
  "Send a thumbs-up emoji to 5 different contacts right now.",
  "Describe your morning routine in the most dramatic way possible.",
  "Change your display name to 'Potato' for the rest of the game.",
  "Do 10 push-ups and send proof (describe it at least).",
  "Tell everyone your WiFi password. (Or make one up that's funny.)",
  "Send the 7th photo in your camera roll to the group.",
  "Say something nice about every single player in the group.",
  "Speak in rhymes for the next 2 minutes.",
  "Share your most recent meme you saved.",
  "Pretend to be a news anchor and deliver today's 'breaking news'.",
  "Write a one-sentence horror story.",
];

function getRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

module.exports = {
  getRandomTruth: () => getRandom(truths),
  getRandomDare: () => getRandom(dares),
  truths,
  dares,
  addTruth: (q) => truths.push(q),
  addDare: (q) => dares.push(q),
};
