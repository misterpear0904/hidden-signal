const fs = require('fs');
const content = fs.readFileSync('server/gameManager.js', 'utf8');

// Update BLUFF_RANKS
let newContent = content.replace(
  'const BLUFF_RANKS = { J: 1, Q: 2, K: 3 };',
  '// Joker beats King, loses to Queen and Jack\nconst BLUFF_RANKS = { Joker: 4, J: 1, Q: 2, K: 3 };'
);

// Update startBluffRound
const oldStartBluff = `function startBluffRound(room) {
  const deck = shuffleInPlace(['J', 'Q', 'K']);
  const cards = {};
  room.players.forEach((p, i) => { cards[p.id] = deck[i]; });
  // First to act alternates each round for fairness
  const firstId = room.players[(room.round - 1) % room.players.length].id;

  room.bluffState = {
    cards,
    firstId,
    history: [],            // { playerId, playerName, action: 'check'|'bet'|'call'|'fold' }
    toActId: firstId,
    winnerId: null,
    winnerName: null,
    loserId: null,
    reason: null,           // 'showdown' | 'fold' | 'timeout'
    bluffWin: false,        // folded out holding a Jack
    showdownCards: null,
    points: {},
  };
  room.phase = 'bluff-bet';
  room.timerEnd = Date.now() + BLUFF_BET_SEC * 1000;
  room.lastActivityMs = Date.now();
  return room;
}`;

const newStartBluff = `function startBluffRound(room) {
  // Deck includes Joker (beats King, loses to Q/J)
  const deck = shuffleInPlace(['Joker', 'J', 'Q', 'K']);
  const cards = {};
  room.players.forEach((p, i) => { cards[p.id] = deck[i]; });
  // First to act alternates each round for fairness
  const firstId = room.players[(room.round - 1) % room.players.length].id;

  room.bluffState = {
    cards,
    firstId,
    history: [],            // { playerId, playerName, action: 'check'|'bet'|'raise'|'call'|'fold' }
    toActId: firstId,
    winnerId: null,
    winnerName: null,
    loserId: null,
    reason: null,           // 'showdown' | 'fold' | 'timeout'
    bluffWin: false,        // folded out holding a Jack
    showdownCards: null,
    points: {},
    betCount: 0,            // track number of bets/raises for scoring
  };
  room.phase = 'bluff-bet';
  room.timerEnd = Date.now() + BLUFF_BET_SEC * 1000;
  room.lastActivityMs = Date.now();
  return room;
}`;

let newContent = content.replace(
  'const BLUFF_RANKS = { J: 1, Q: 2, K: 3 };',
  '// Joker beats King, loses to Queen and Jack\nconst BLUFF_RANKS = { Joker: 4, J: 1, Q: 2, K: 3 };'
);

newContent = newContent.replace(oldStartBluff, newStartBluff);
fs.writeFileSync('server/gameManager.js', newContent);
console.log('Updated gameManager.js');