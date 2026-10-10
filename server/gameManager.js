// gameManager.js — In-memory game state management

import { assignRoles, calculateScores, generateRoomCode } from './gameLogic.js';
import {
  MISSILE_CONFIG,
  createMissileCommandState,
  missileBuildBuilding,
  missileUpgradeBuilding,
  missileLoadMissile,
  missileToggleAutobuild,
  missileLaunch,
  missileLaunchType,
  tickMissileCommand,
  missileSideForPlayer,
  missileIncomePerSec,
} from './missileCommand.js';

export { MISSILE_CONFIG, missileSideForPlayer, missileIncomePerSec };

// rooms: Map<roomCode, RoomState>
export const rooms = new Map();

export const TOTAL_ROUNDS = 5;
const HIDDEN_ROUNDS = 5;
const CHROMA_ROUNDS = 5;
const SIGNAL_TIME = 60;    // seconds
const DISCUSS_TIME = 60;   // seconds
const GUESS_TIME = 45;     // seconds

// Territory Push tuning constants
const TERRITORY_COLS = 10;
const STANDARD_HEIGHT = 10;
const EXTREME_HEIGHT = 20;
const DEFENDER_BONUS = 2;
const WIN_SCORE = 5;
const MAX_TURN_HISTORY = 50;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2h idle sweep

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const BASE_GRADIENT_PALETTES = [
  ['#1e1b4b', '#312e81'], // Indigo
  ['#064e3b', '#047857'], // Emerald
  ['#451a03', '#78350f'], // Amber
  ['#4c0519', '#881337'], // Rose
  ['#172554', '#1e40af'], // Blue
];

const TARGET_GRADIENT_PALETTES = [
  ['#2e1065', '#4c1d95'], // Subtle Deep Purple
  ['#022c22', '#0f766e'], // Subtle Deep Teal
  ['#3f1d0b', '#92400e'], // Subtle Deep Warm Gold
  ['#3b0764', '#6b21a8'], // Subtle Deep Violet
  ['#0f172a', '#1e293b'], // Subtle Deep Slate
];

export function createRoom(hostId, hostName) {
  let code;
  do { code = generateRoomCode(); } while (rooms.has(code));

  const now = Date.now();
  const room = {
    code,
    selectedGameId: 'hidden-signal',
    chromaOptions: { difficulty: 'easy', playerDifficulties: {}, fairPoints: true, extremeMode: false },
    territoryOptions: { extremeMode: false },
    liarOptions: { extremeMode: false },
    missileCommandOptions: { startingResources: MISSILE_CONFIG.startingResources, economyTickMs: MISSILE_CONFIG.economyTickMs, maxLevel: MISSILE_CONFIG.maxLevel },
    chromaState: null,
    territoryState: null,
    blendState: null,
    liarState: null,
    bluffState: null,
    missileCommandState: null,
    phase: 'lobby',          // lobby | role-reveal | signal | discuss | guess | reveal | end | chroma-play | chroma-reveal | territory-turn | territory-reveal | blend-word | blend-vote | blend-guess | blend-reveal
    round: 0,
    players: [{ id: hostId, name: hostName, score: 0, isHost: true, connected: true }],
    roles: [],
    hiddenPairIds: [],
    secretCode: null,
    signals: [],             // { playerId, signal }
    guesses: [],             // { playerId, guessedPartnerId?, guessedPairIds? }
    timer: null,
    timerEnd: null,
    endVote: null,           // active unanimous vote to end game early
    createdAt: now,
    lastActivityMs: now,
  };

  rooms.set(code, room);
  return room;
}

export function joinRoom(code, playerId, playerName) {
  const room = rooms.get(code);
  if (!room) return { error: 'Room not found' };
  if (room.phase !== 'lobby') return { error: 'Game already in progress' };
  if (room.players.find(p => p.id === playerId)) return { error: 'Already in room' };
  if (room.players.length >= 12) return { error: 'Room is full' };

  room.players.push({ id: playerId, name: playerName, score: 0, isHost: false, connected: true });
  return { room };
}

export function getRoom(code) {
  return rooms.get(code) || null;
}

export function getRoomByPlayerId(playerId) {
  for (const room of rooms.values()) {
    if (room.players.find(p => p.id === playerId)) return room;
  }
  return null;
}

export function kickPlayer(code, hostId, targetId) {
  const room = rooms.get(code);
  if (!room) return { error: 'Room not found' };
  if (room.phase !== 'lobby') return { error: 'Can only kick players from the lobby' };
  if (!isHost(room, hostId)) return { error: 'Only the host can kick players' };
  if (hostId === targetId) return { error: 'Host cannot kick themselves' };
  const idx = room.players.findIndex(p => p.id === targetId);
  if (idx === -1) return { error: 'Player not found' };
  if (room.players[idx].isHost) return { error: 'Cannot kick the host' };
  room.players.splice(idx, 1);
  if (room.chromaOptions?.playerDifficulties) {
    delete room.chromaOptions.playerDifficulties[targetId];
  }
  room.lastActivityMs = Date.now();
  return { room, kickedId: targetId };
}

export function selectGame(code, gameId) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'lobby') return null;
  const allowed = ['hidden-signal', 'chroma-shift', 'territory-push', 'blend-in', 'liar-dice', 'bluff-card', 'missile-command'];
  if (!allowed.includes(gameId)) return null;
  room.selectedGameId = gameId;
  room.lastActivityMs = Date.now();
  return room;
}

export function updateChromaOptions(code, options) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'lobby') return null;
  if (!options || typeof options !== 'object') return null;
  const next = { ...room.chromaOptions };
  if (typeof options.difficulty === 'string' && ['easy', 'medium', 'hard'].includes(options.difficulty)) {
    next.difficulty = options.difficulty;
  }
  if (typeof options.fairPoints === 'boolean') next.fairPoints = options.fairPoints;
  if (typeof options.extremeMode === 'boolean') next.extremeMode = options.extremeMode;
  room.chromaOptions = next;
  room.lastActivityMs = Date.now();
  return room;
}

export function updateTerritoryOptions(code, options) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'lobby') return null;
  if (!options || typeof options !== 'object') return null;
  const next = { ...room.territoryOptions };
  if (typeof options.extremeMode === 'boolean') next.extremeMode = options.extremeMode;
  room.territoryOptions = next;
  room.lastActivityMs = Date.now();
  return room;
}

export function updateLiarOptions(code, options) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'lobby') return null;
  if (!options || typeof options !== 'object') return null;
  if (!room.liarOptions) room.liarOptions = { extremeMode: false };
  const next = { ...room.liarOptions };
  if (typeof options.extremeMode === 'boolean') next.extremeMode = options.extremeMode;
  room.liarOptions = next;
  room.lastActivityMs = Date.now();
  return room;
}

export function updateMissileCommandOptions(code, options) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'lobby') return null;
  if (!options || typeof options !== 'object') return null;
  const next = { ...(room.missileCommandOptions || { startingResources: MISSILE_CONFIG.startingResources, economyTickMs: MISSILE_CONFIG.economyTickMs, maxLevel: MISSILE_CONFIG.maxLevel }) };
  if (typeof options.startingResources === 'number' && options.startingResources >= 50 && options.startingResources <= 500) {
    next.startingResources = Math.round(options.startingResources);
  }
  room.missileCommandOptions = next;
  room.lastActivityMs = Date.now();
  return room;
}

export function setPlayerDifficulty(code, playerId, difficulty) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'lobby') return null;
  if (!['easy', 'medium', 'hard'].includes(difficulty)) return null;
  if (!room.chromaOptions.playerDifficulties) {
    room.chromaOptions.playerDifficulties = {};
  }
  room.chromaOptions.playerDifficulties[playerId] = difficulty;
  return room;
}

export function generateRechargeBonusSquares() {
  // Pick 8 distinct columns out of 10 (0..9) so no two bonus squares share a column
  const cols = shuffleInPlace([...Array(10).keys()]);
  const redCols = cols.slice(0, 4);
  const blueCols = cols.slice(4, 8);

  const bonusSquares = [];
  
  // 4 on Red's side (spawn randomly in rows 6..8)
  for (const col of redCols) {
    const row = Math.floor(Math.random() * 3) + 6; // 6, 7, 8
    bonusSquares.push({ row, col, initialTeam: 'red' });
  }

  // 4 on Blue's side (spawn randomly in rows 11..13)
  for (const col of blueCols) {
    const row = Math.floor(Math.random() * 3) + 11; // 11, 12, 13
    bonusSquares.push({ row, col, initialTeam: 'blue' });
  }

  return bonusSquares;
}

export function getTeamBonusCounts(board, bonusSquares = []) {
  let red = 0;
  let blue = 0;
  if (!board || !bonusSquares) return { red: 0, blue: 0 };
  for (const sq of bonusSquares) {
    // Red owns rows 0..board[sq.col]
    if (sq.row <= board[sq.col]) {
      red++;
    } else {
      blue++;
    }
  }
  return { red, blue };
}

export function getTeamRechargeIntervalMs(bonusCount = 0) {
  // Base 5000ms. Each bonus square grants +10% faster recharge.
  return Math.max(1000, Math.round(5000 / (1 + (bonusCount || 0) * 0.10)));
}

export function startGame(code) {
  const room = rooms.get(code);
  if (!room) return null;

  if (room.selectedGameId === 'chroma-shift') {
    if (room.players.length < 2) return null;
    room.round = 1;
    room.endVote = null;
    for (const p of room.players) p.score = 0;
    return startChromaRound(room);
  }

  if (room.selectedGameId === 'territory-push') {
    if (room.players.length < 2 || room.players.length % 2 !== 0) return null;
    room.round = 1;
    room.endVote = null;
    for (const p of room.players) p.score = 0;
    
    // Shuffle players randomly into two teams
    const shuffled = shuffleInPlace([...room.players.map(p => p.id)]);
    const half = Math.floor(shuffled.length / 2);
    
    const isExtreme = room.territoryOptions?.extremeMode === true;
    const boardHeight = isExtreme ? EXTREME_HEIGHT : STANDARD_HEIGHT;
    const initialFrontier = isExtreme ? 9 : 4; // 0..9 Red, 10..19 Blue in 20-row grid; 0..4 Red, 5..9 Blue in 10-row grid
    const bonusSquares = isExtreme ? generateRechargeBonusSquares() : [];

    const now = Date.now();
    const energy = {};
    for (const p of room.players) {
      energy[p.id] = { shots: 1, lastChargeMs: now };
    }

    room.territoryState = {
      teams: {
        red: shuffled.slice(0, half),
        blue: shuffled.slice(half),
      },
      board: Array(TERRITORY_COLS).fill(initialFrontier),
      extremeMode: isExtreme,
      boardHeight,
      bonusSquares,
      mines: {},
      recentExplosions: [],
      energy,
      recentShots: [],
      submittedPicks: {},
      lastResolutions: null,
      turnHistory: [],
      winnerTeam: null,
      turn: 1,
    };
    room.phase = 'territory-turn';
    return room;
  }

  if (room.selectedGameId === 'blend-in') {
    if (room.players.length < 3) return null;
    room.round = 1;
    room.endVote = null;
    room.blendState = null;
    for (const p of room.players) p.score = 0;
    return startBlendRound(room);
  }

  if (room.selectedGameId === 'liar-dice') {
    if (room.players.length < 2 || room.players.length > 12) return null;
    room.round = 1;
    room.endVote = null;
    room.liarState = null;
    for (const p of room.players) p.score = 0;
    return startLiarRound(room);
  }

  if (room.selectedGameId === 'bluff-card') {
    if (room.players.length !== 2) return null;
    room.round = 1;
    room.endVote = null;
    room.bluffState = null;
    for (const p of room.players) p.score = 0;
    return startBluffRound(room);
  }

  if (room.selectedGameId === 'missile-command') {
    if (room.players.length !== 2) return null;
    room.round = 1;
    room.endVote = null;
    for (const p of room.players) p.score = 0;
    const ids = room.players.map(p => p.id);
    room.missileCommandState = createMissileCommandState(ids, {
      startingResources: room.missileCommandOptions?.startingResources ?? MISSILE_CONFIG.startingResources,
    });
    room.phase = 'missile-command-play';
    room.lastActivityMs = Date.now();
    return room;
  }

  if (room.players.length < 4) return null;
  room.round = 1;
  room.endVote = null;
  room.blendState = null;
  return startRound(room);
}

const CHROMA_RACE_MS = 10 * 1000;

// ─── Blend In (social word deduction) tuning ────────────────────────────────
const BLEND_WORD_SEC = 45;
const BLEND_VOTE_SEC = 30;
const BLEND_GUESS_SEC = 20;
const BLEND_ROUNDS = 5;
const BLEND_VOTER_POINT = 1;
const BLEND_ESCAPE_POINTS = 2;
const BLEND_STEAL_POINTS = 2;

// ─── Liar's Dice (2-12 player bluffing game) tuning ──────────────────────────
const LIAR_BID_SEC = 60;
const LIAR_ROUNDS = 5;
const LIAR_DICE_EACH = 3;
const LIAR_EXTREME_DICE_EACH = 9;  // 3x starting dice for extreme mode
const LIAR_WIN_POINTS = 1;
const LIAR_EXACT_BONUS_POINTS = 2;

// ─── Bluff Card (2-player Kuhn-style card duel) tuning ──────────────────────
const BLUFF_BET_SEC = 30;
const BLUFF_ROUNDS = 5;
const BLUFF_WIN_POINTS = 1;
const BLUFF_BLUFF_BONUS_POINTS = 2; // total for winning a fold with a Jack
// Joker beats King, loses to Queen and Jack
const BLUFF_RANKS = { Joker: 4, J: 1, Q: 2, K: 3 };

const BLEND_WORDS = {
  Animals: ['Elephant', 'Penguin', 'Kangaroo', 'Octopus', 'Giraffe', 'Crocodile', 'Owl', 'Dolphin'],
  Food: ['Pizza', 'Sushi', 'Chocolate', 'Popcorn', 'Honey', 'Spaghetti', 'Avocado', 'Pancake'],
  Places: ['Beach', 'Castle', 'Airport', 'Library', 'Volcano', 'Desert', 'Lighthouse', 'Market'],
  Objects: ['Umbrella', 'Guitar', 'Telescope', 'Candle', 'Backpack', 'Mirror', 'Ladder', 'Compass'],
  Sports: ['Soccer', 'Swimming', 'Tennis', 'Basketball', 'Surfing', 'Skiing', 'Boxing', 'Yoga'],
  Characters: ['Pirate', 'Robot', 'Wizard', 'Dragon', 'Ghost', 'Vampire', 'Knight', 'Alien'],
  Nature: ['Rainbow', 'Thunder', 'Waterfall', 'Forest', 'Ocean', 'Mountain', 'Sunset', 'Snowflake'],
  Jobs: ['Chef', 'Pilot', 'Doctor', 'Farmer', 'Astronaut', 'Teacher', 'Detective', 'Baker'],
};

function chromaFullPoints(room, playerId) {
  let points = 1;
  const playerDiff = room.chromaOptions.playerDifficulties?.[playerId] || 'easy';
  if (room.chromaOptions.fairPoints) {
    if (playerDiff === 'medium') points = 2;
    else if (playerDiff === 'hard') points = 3;
  }
  return points;
}

function startChromaRound(room) {
  const totalTiles = room.chromaOptions.extremeMode ? 64 : 25;
  const targetTileIndex = Math.floor(Math.random() * totalTiles);
  const baseIndex = (room.round - 1) % BASE_GRADIENT_PALETTES.length;
  const targetIndex = (room.round * 2 + 1) % TARGET_GRADIENT_PALETTES.length;
  const shiftDurationSec = 60 + Math.floor(Math.random() * 61); // 60s to 120s

  room.chromaState = {
    targetTileIndex,
    baseGradient: BASE_GRADIENT_PALETTES[baseIndex],
    targetGradient: TARGET_GRADIENT_PALETTES[targetIndex],
    roundWinnerId: null,
    roundWinnerName: null,
    pointsAwarded: 0,
    shiftDurationSec,
    seed: Date.now() + Math.random(),
    // 10s race: first finder announces, others can solve for half points
    raceEndAt: null,
    firstFinderId: null,
    firstFinderName: null,
    firstFinderPoints: 0,
    solvers: [],
  };

  room.phase = 'chroma-play';
  return room;
}

export function submitChromaGuess(code, playerId, tileIndex) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'chroma-play' || !room.chromaState) return null;

  const player = room.players.find(p => p.id === playerId);
  if (!player) return null;
  const totalTiles = room.chromaOptions?.extremeMode ? 64 : 25;
  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= totalTiles) return null;

  if (tileIndex === room.chromaState.targetTileIndex) {
    // Already solved by this player (e.g. double-click during race) — ignore, no penalty
    if (room.chromaState.solvers?.some(s => s.playerId === playerId)) {
      return { room, correct: true, alreadySolved: true };
    }
    const now = Date.now();
    // No race running: this player is first finder, full points + open 10s race
    if (!room.chromaState.raceEndAt) {
      const points = chromaFullPoints(room, playerId);
      player.score += points;
      room.chromaState.roundWinnerId = playerId;
      room.chromaState.roundWinnerName = player.name;
      room.chromaState.pointsAwarded = points;
      room.chromaState.firstFinderId = playerId;
      room.chromaState.firstFinderName = player.name;
      room.chromaState.firstFinderPoints = points;
      room.chromaState.raceEndAt = now + CHROMA_RACE_MS;
      room.chromaState.solvers = [{ playerId, playerName: player.name, points }];
      room.lastActivityMs = now;
      // Phase stays chroma-play during the race; reveal happens on timeout
      return { room, correct: true, pointsAwarded: points, winnerId: playerId, raceStarted: true, raceEndAt: room.chromaState.raceEndAt };
    }
    // Race already running: half points for additional solvers
    if (now > room.chromaState.raceEndAt) return null; // race expired, reveal imminent
    const full = chromaFullPoints(room, playerId);
    const points = full / 2;
    player.score += points;
    room.chromaState.solvers.push({ playerId, playerName: player.name, points });
    room.lastActivityMs = now;
    return { room, correct: true, pointsAwarded: points, winnerId: playerId, raceSolved: true };
  } else {
    // Wrong guess penalty: lose 1 point
    player.score -= 1;
    room.lastActivityMs = Date.now();
    return { room, correct: false, penaltyPlayerId: playerId, currentScore: player.score };
  }
}

export function resolveChromaRace(code) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'chroma-play' || !room.chromaState) return null;
  if (!room.chromaState.raceEndAt) return null;
  room.chromaState.raceEndAt = null;
  room.phase = 'chroma-reveal';
  room.lastActivityMs = Date.now();
  return room;
}

export function nextChromaRound(code) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'chroma-reveal') return null;

  if (room.round >= CHROMA_ROUNDS) {
    room.phase = 'end';
    return room;
  }

  room.round += 1;
  return startChromaRound(room);
}

function startBlendRound(room) {
  const ids = room.players.map(p => p.id);
  const chameleonId = ids[Math.floor(Math.random() * ids.length)];
  const categories = Object.keys(BLEND_WORDS);
  const category = categories[Math.floor(Math.random() * categories.length)];
  const words = BLEND_WORDS[category];
  const secretWord = words[Math.floor(Math.random() * words.length)];

  room.blendState = {
    category,
    secretWord,
    chameleonId,
    clues: [],            // { playerId, word }
    votes: [],            // { playerId, targetId }
    accusedId: null,
    caught: false,
    chameleonGuess: null,
    stealSuccess: false,
    points: {},           // playerId -> points this round
  };
  room.phase = 'blend-word';
  room.timerEnd = Date.now() + BLEND_WORD_SEC * 1000;
  room.lastActivityMs = Date.now();
  return room;
}

function awardBlendPoints(room, playerId, pts) {
  const player = room.players.find(p => p.id === playerId);
  if (!player) return;
  player.score += pts;
  room.blendState.points[playerId] = (room.blendState.points[playerId] || 0) + pts;
}

export function submitBlendClue(code, playerId, word) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'blend-word' || !room.blendState) return null;
  if (!room.players.some(p => p.id === playerId)) return null;
  if (room.blendState.clues.some(c => c.playerId === playerId)) return null;
  if (typeof word !== 'string') return null;
  const clean = word.trim().replace(/\s+/g, ' ').substring(0, 24);
  if (clean.length < 1) return null;

  room.blendState.clues.push({ playerId, word: clean });
  room.lastActivityMs = Date.now();
  return room;
}

export function blendAllCluesIn(room) {
  if (!room?.blendState) return false;
  const connected = room.players.filter(p => p.connected);
  return connected.length > 0 && connected.every(p => room.blendState.clues.some(c => c.playerId === p.id));
}

export function advanceToBlendVote(code) {
  const room = rooms.get(code);
  if (!room || !room.blendState) return null;
  room.phase = 'blend-vote';
  room.timerEnd = Date.now() + BLEND_VOTE_SEC * 1000;
  room.lastActivityMs = Date.now();
  return room;
}

export function submitBlendVote(code, playerId, targetId) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'blend-vote' || !room.blendState) return null;
  if (!room.players.some(p => p.id === playerId)) return null;
  if (!room.players.some(p => p.id === targetId)) return null;
  if (targetId === playerId) return null;
  if (room.blendState.votes.some(v => v.playerId === playerId)) return null;

  room.blendState.votes.push({ playerId, targetId });
  room.lastActivityMs = Date.now();
  return room;
}

export function blendAllVotesIn(room) {
  if (!room?.blendState) return false;
  const connected = room.players.filter(p => p.connected);
  return connected.length > 0 && connected.every(p => room.blendState.votes.some(v => v.playerId === p.id));
}

export function resolveBlendVotes(code) {
  const room = rooms.get(code);
  if (!room || !room.blendState) return null;

  const tally = {};
  for (const v of room.blendState.votes) {
    tally[v.targetId] = (tally[v.targetId] || 0) + 1;
  }
  let accusedId = null;
  let topVotes = 0;
  let tied = false;
  for (const [pid, count] of Object.entries(tally)) {
    if (count > topVotes) { topVotes = count; accusedId = pid; tied = false; }
    else if (count === topVotes) { tied = true; }
  }
  if (tied) accusedId = null;

  room.blendState.accusedId = accusedId;
  room.blendState.caught = accusedId !== null && accusedId === room.blendState.chameleonId;

  if (!room.blendState.caught) {
    // Chameleon escaped (wrong accusation or tie/no votes): +2, nobody else scores
    awardBlendPoints(room, room.blendState.chameleonId, BLEND_ESCAPE_POINTS);
    room.phase = 'blend-reveal';
  } else {
    // Every correct voter scores now; chameleon may still steal with a word guess
    for (const v of room.blendState.votes) {
      if (v.targetId === room.blendState.chameleonId) {
        awardBlendPoints(room, v.playerId, BLEND_VOTER_POINT);
      }
    }
    room.phase = 'blend-guess';
    room.timerEnd = Date.now() + BLEND_GUESS_SEC * 1000;
  }
  room.lastActivityMs = Date.now();
  return room;
}

export function submitBlendGuess(code, playerId, guess) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'blend-guess' || !room.blendState) return null;
  if (playerId !== room.blendState.chameleonId) return null;
  if (typeof guess !== 'string') return null;
  const clean = guess.trim().substring(0, 30);
  if (clean.length < 1) return null;

  room.blendState.chameleonGuess = clean;
  if (clean.toLowerCase() === room.blendState.secretWord.toLowerCase()) {
    room.blendState.stealSuccess = true;
    awardBlendPoints(room, playerId, BLEND_STEAL_POINTS);
  }
  room.phase = 'blend-reveal';
  room.lastActivityMs = Date.now();
  return room;
}

export function expireBlendGuess(code) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'blend-guess' || !room.blendState) return null;
  room.phase = 'blend-reveal';
  room.lastActivityMs = Date.now();
  return room;
}

export function nextBlendRound(code) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'blend-reveal') return null;

  if (room.round >= BLEND_ROUNDS) {
    room.phase = 'end';
    return room;
  }

  room.round += 1;
  return startBlendRound(room);
}

function rollLiarDice(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(1 + Math.floor(Math.random() * 6));
  return out;
}

function startLiarRound(room) {
  const isExtreme = room.liarOptions?.extremeMode === true;
  const diceEach = isExtreme ? LIAR_EXTREME_DICE_EACH : LIAR_DICE_EACH;
  const dice = {};
  for (const p of room.players) dice[p.id] = rollLiarDice(diceEach);
  // Starter alternates each round for fairness
  const starterId = room.players[(room.round - 1) % room.players.length].id;

  room.liarState = {
    dice,
    diceEach,
    bids: [],               // { playerId, playerName, qty, face }
    toActId: starterId,
    starterId,
    winnerId: null,
    winnerName: null,
    loserId: null,
    reason: null,           // 'liar' | 'exact' | 'timeout'
    challengedBid: null,
    actualCount: null,
    points: {},
    isExtreme,
  };
  room.phase = 'liar-bid';
  room.timerEnd = Date.now() + LIAR_BID_SEC * 1000;
  room.lastActivityMs = Date.now();
  return room;
}

function liarTotalDice(room) {
  return (room.liarState?.diceEach || LIAR_DICE_EACH) * room.players.length;
}

function awardLiarPoints(room, playerId, pts) {
  const player = room.players.find(p => p.id === playerId);
  if (!player) return;
  player.score += pts;
  room.liarState.points[playerId] = (room.liarState.points[playerId] || 0) + pts;
}

function liarOpponentId(room, playerId) {
  const other = room.players.find(p => p.id !== playerId);
  return other ? other.id : null;
}

export function submitLiarBid(code, playerId, qty, face) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'liar-bid' || !room.liarState) return null;
  if (!room.players.some(p => p.id === playerId)) return null;
  if (room.liarState.toActId !== playerId) return null;
  if (!Number.isInteger(qty) || !Number.isInteger(face)) return null;
  if (face < 1 || face > 6) return null;
  if (qty < 1 || qty > liarTotalDice(room)) return null;

  const last = room.liarState.bids[room.liarState.bids.length - 1];
  if (last) {
    const raised = qty > last.qty || (qty === last.qty && face > last.face);
    if (!raised) return null;
  }

  const player = room.players.find(p => p.id === playerId);
  room.liarState.bids.push({ playerId, playerName: player?.name || '???', qty, face });
  room.liarState.toActId = liarOpponentId(room, playerId);
  room.phase = 'liar-bid';
  room.timerEnd = Date.now() + LIAR_BID_SEC * 1000;
  room.lastActivityMs = Date.now();
  return room;
}

export function resolveLiarCall(code, playerId, kind) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'liar-bid' || !room.liarState) return null;
  if (kind !== 'liar' && kind !== 'exact') return null;
  if (!room.players.some(p => p.id === playerId)) return null;
  if (room.liarState.toActId !== playerId) return null;
  const last = room.liarState.bids[room.liarState.bids.length - 1];
  if (!last) return null; // nothing to challenge yet

  let actual = 0;
  for (const hand of Object.values(room.liarState.dice)) {
    for (const d of hand) if (d === last.face) actual += 1;
  }

  const bidderId = last.playerId;
  let winnerId;
  let pts;
  if (kind === 'liar') {
    winnerId = actual < last.qty ? playerId : bidderId;
    pts = LIAR_WIN_POINTS;
  } else {
    winnerId = actual === last.qty ? playerId : bidderId;
    pts = winnerId === playerId ? LIAR_EXACT_BONUS_POINTS : LIAR_WIN_POINTS;
  }

  const winner = room.players.find(p => p.id === winnerId);
  awardLiarPoints(room, winnerId, pts);
  room.liarState.winnerId = winnerId;
  room.liarState.winnerName = winner ? winner.name : '???';
  room.liarState.loserId = winnerId === playerId ? bidderId : playerId;
  room.liarState.reason = kind;
  room.liarState.challengedBid = { qty: last.qty, face: last.face, bidderId };
  room.liarState.actualCount = actual;
  room.phase = 'liar-reveal';
  room.lastActivityMs = Date.now();
  return room;
}

export function expireLiarBid(code) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'liar-bid' || !room.liarState) return null;
  // Player to act timed out: opponent takes the round
  const winnerId = liarOpponentId(room, room.liarState.toActId) || room.liarState.toActId;
  const winner = room.players.find(p => p.id === winnerId);
  awardLiarPoints(room, winnerId, LIAR_WIN_POINTS);
  room.liarState.winnerId = winnerId;
  room.liarState.winnerName = winner ? winner.name : '???';
  room.liarState.loserId = room.liarState.toActId;
  room.liarState.reason = 'timeout';
  room.phase = 'liar-reveal';
  room.lastActivityMs = Date.now();
  return room;
}

export function nextLiarRound(code) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'liar-reveal') return null;

  if (room.round >= LIAR_ROUNDS) {
    room.phase = 'end';
    return room;
  }

  room.round += 1;
  return startLiarRound(room);
}

export function startBluffRound(room) {
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
}

function awardBluffPoints(room, playerId, pts) {
  const player = room.players.find(p => p.id === playerId);
  if (!player) return;
  player.score += pts;
  room.bluffState.points[playerId] = (room.bluffState.points[playerId] || 0) + pts;
}

function bluffOpponentId(room, playerId) {
  const other = room.players.find(p => p.id !== playerId);
  return other ? other.id : null;
}

export function resolveBluffShowdown(room) {
  console.log('DEBUG resolveBluffShowdown - room:', room);
  console.log('DEBUG resolveBluffShowdown - room.players:', room.players);
  console.log('DEBUG resolveBluffShowdown - room.players type:', typeof room.players, Array.isArray(room.players));
  const [a, b] = room.players;
  const cardA = room.bluffState.cards[a.id];
  const cardB = room.bluffState.cards[b.id];
  
  // Custom comparison: Joker beats King, loses to Queen and Jack
  function cardValue(card) {
    if (card === 'Joker') return 3.5; // Between King (3) and Queen (2)
    return BLUFF_RANKS[card] || 0;
  }
  
  const winnerId = cardValue(cardA) > cardValue(cardB) ? a.id : b.id;
  const winner = room.players.find(p => p.id === winnerId);
  awardBluffPoints(room, winnerId, BLUFF_WIN_POINTS);
  room.bluffState.winnerId = winnerId;
  room.bluffState.winnerName = winner ? winner.name : '???';
  room.bluffState.loserId = winnerId === a.id ? b.id : a.id;
  room.bluffState.reason = 'showdown';
  room.bluffState.bluffWin = false;
  room.bluffState.showdownCards = { [a.id]: cardA, [b.id]: cardB };
  room.phase = 'bluff-reveal';
  room.lastActivityMs = Date.now();
  return room;
}

export function resolveBluffFold(room, folderId, timedOut) {
  const bettor = [...room.bluffState.history].reverse().find(h => h.action === 'bet');
  const winnerId = bettor ? bettor.playerId : bluffOpponentId(room, folderId);
  const winner = room.players.find(p => p.id === winnerId);
  // Successful bluff: folding out the opponent while holding a Jack
  const bluffWin = room.bluffState.cards[winnerId] === 'J';
  awardBluffPoints(room, winnerId, bluffWin ? BLUFF_BLUFF_BONUS_POINTS : BLUFF_WIN_POINTS);
  room.bluffState.winnerId = winnerId;
  room.bluffState.winnerName = winner ? winner.name : '???';
  room.bluffState.loserId = folderId;
  room.bluffState.reason = timedOut ? 'timeout' : 'fold';
  room.bluffState.bluffWin = bluffWin;
  room.phase = 'bluff-reveal';
  room.lastActivityMs = Date.now();
  return room;
}

export function submitBluffAction(code, playerId, action) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'bluff-bet' || !room.bluffState) return null;
  if (!room.players.some(p => p.id === playerId)) return null;
  if (room.bluffState.toActId !== playerId) return null;

  const last = room.bluffState.history[room.bluffState.history.length - 1];
  const facingBet = last?.action === 'bet' || last?.action === 'raise';
  if (!facingBet && action !== 'check' && action !== 'bet') return null;
  if (facingBet && action !== 'fold' && action !== 'call' && action !== 'raise') return null;

  const player = room.players.find(p => p.id === playerId);
  room.bluffState.history.push({ playerId, playerName: player?.name || '???', action });
  room.bluffState.betCount = (room.bluffState.betCount || 0) + (action === 'bet' || action === 'raise' ? 1 : 0);

  if (action === 'fold') return resolveBluffFold(room, playerId, false);
  if (action === 'call') return resolveBluffShowdown(room);
  if (action === 'check' && last?.action === 'check') return resolveBluffShowdown(room);

  room.bluffState.toActId = bluffOpponentId(room, playerId);
  room.phase = 'bluff-bet';
  room.timerEnd = Date.now() + BLUFF_BET_SEC * 1000;
  room.lastActivityMs = Date.now();
  return room;
}

export function expireBluffBet(code) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'bluff-bet' || !room.bluffState) return null;
  // Player to act timed out: counts as folding
  return resolveBluffFold(room, room.bluffState.toActId, true);
}

export function nextBluffRound(code) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'bluff-reveal') return null;

  if (room.round >= BLUFF_ROUNDS) {
    room.phase = 'end';
    return room;
  }

  room.round += 1;
  return startBluffRound(room);
}

export function triggerTerritoryMineDetonations(room, minesToTrigger) {
  if (!room?.territoryState || !minesToTrigger || minesToTrigger.length === 0) return [];
  const board = room.territoryState.board;
  const boardHeight = room.territoryState.boardHeight || (room.territoryState.extremeMode ? 20 : 10);
  const explosions = [];
  const triggeredMineIds = new Set();
  const destroyedMineIds = new Set();

  let queue = [...minesToTrigger];

  while (queue.length > 0) {
    const mine = queue.shift();
    if (!mine || triggeredMineIds.has(mine.playerId) || destroyedMineIds.has(mine.playerId)) continue;
    triggeredMineIds.add(mine.playerId);

    const minCol = Math.max(0, mine.col - 2);
    const maxCol = Math.min(9, mine.col + 2);
    const affectedCols = [];

    // Convert tiles in 2-tile radius
    for (let c = minCol; c <= maxCol; c++) {
      affectedCols.push(c);
      if (mine.team === 'red') {
        // Red claims up to mine.row + 2
        const targetRow = Math.min(boardHeight - 1, mine.row + 2);
        board[c] = Math.max(board[c], targetRow);
      } else {
        // Blue claims down to mine.row - 2 (Red frontier must be <= mine.row - 3)
        const targetRow = Math.max(-1, mine.row - 3);
        board[c] = Math.min(board[c], targetRow);
      }
    }

    // Remove detonated mine so player can place again
    if (room.territoryState.mines) {
      delete room.territoryState.mines[mine.playerId];
    }

    // Destroy (without triggering) any other mines located within the 2-tile radius or newly claimed blast area
    const destroyedInBlast = [];
    if (room.territoryState.mines) {
      for (const otherMine of Object.values(room.territoryState.mines)) {
        if (!otherMine || otherMine.playerId === mine.playerId || triggeredMineIds.has(otherMine.playerId) || destroyedMineIds.has(otherMine.playerId)) continue;

        const colDistance = Math.abs(otherMine.col - mine.col);
        const rowDistance = Math.abs(otherMine.row - mine.row);
        const inRadius = colDistance <= 2 && rowDistance <= 2;

        const colFrontier = board[otherMine.col];
        const caughtInClaimedTerritory = (otherMine.col >= minCol && otherMine.col <= maxCol) && (
          (mine.team === 'red' && otherMine.row <= colFrontier) ||
          (mine.team === 'blue' && otherMine.row > colFrontier)
        );

        if (inRadius || caughtInClaimedTerritory) {
          destroyedMineIds.add(otherMine.playerId);
          destroyedInBlast.push(otherMine);
          delete room.territoryState.mines[otherMine.playerId];
        }
      }
    }

    let msg = `💥 TRAP TRIGGERED! ${mine.playerName}'s mine at (C${mine.col + 1}, R${mine.row + 1}) detonated a 2-tile radius blast!`;
    if (destroyedInBlast.length > 0) {
      const names = destroyedInBlast.map(m => `${m.playerName || m.team}'s mine`).join(', ');
      msg += ` Destroyed ${names} caught in blast!`;
    }

    const explosion = {
      id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`,
      minePlayerId: mine.playerId,
      minePlayerName: mine.playerName,
      team: mine.team,
      row: mine.row,
      col: mine.col,
      timestamp: Date.now(),
      affectedCols,
      destroyedMines: destroyedInBlast.map(m => ({ playerId: m.playerId, playerName: m.playerName, team: m.team, row: m.row, col: m.col })),
      message: msg,
    };

    explosions.push(explosion);
    if (!room.territoryState.recentExplosions) {
      room.territoryState.recentExplosions = [];
    }
    room.territoryState.recentExplosions.unshift(explosion);
    if (room.territoryState.recentExplosions.length > 20) {
      room.territoryState.recentExplosions.pop();
    }
  }

  return explosions;
}

export function placeTerritoryMine(code, playerId, row, col) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'territory-turn' || !room.territoryState) return null;
  if (typeof row !== 'number' || typeof col !== 'number') return { room, error: 'Invalid coordinates' };
  if (col < 0 || col > 9) return { room, error: 'Column out of bounds' };

  const isRed = room.territoryState.teams.red.includes(playerId);
  const isBlue = room.territoryState.teams.blue.includes(playerId);
  if (!isRed && !isBlue) return { room, error: 'You are not playing in this game' };

  const boardHeight = room.territoryState.boardHeight || (room.territoryState.extremeMode ? 20 : 10);
  if (row < 0 || row >= boardHeight) return { room, error: 'Row out of bounds' };

  const frontier = room.territoryState.board[col];
  const isRedTerritory = row <= frontier;
  const isPlayerTerritory = isRed ? isRedTerritory : !isRedTerritory;

  if (!isPlayerTerritory) {
    return { room, error: 'Mines can only be placed inside your team’s territory!' };
  }

  if (!room.territoryState.mines) {
    room.territoryState.mines = {};
  }

  const player = room.players.find(p => p.id === playerId);
  const isMoving = !!room.territoryState.mines[playerId];

  room.territoryState.mines[playerId] = {
    playerId,
    playerName: player?.name || (isRed ? 'Red' : 'Blue'),
    team: isRed ? 'red' : 'blue',
    row,
    col,
    placedAt: Date.now(),
  };

  return { room, success: true, isMoving };
}

export function submitTerritoryPick(code, playerId, colIndex) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'territory-turn' || !room.territoryState) return null;
  if (typeof colIndex !== 'number' || colIndex < 0 || colIndex > 9) return null;

  // ── Extreme Mode (Real-Time 10x20 Energy Shot) ──
  if (room.territoryState.extremeMode) {
    const isRed = room.territoryState.teams.red.includes(playerId);
    const isBlue = room.territoryState.teams.blue.includes(playerId);
    if (!isRed && !isBlue) return null;

    if (!room.territoryState.energy) room.territoryState.energy = {};
    const playerEnergy = room.territoryState.energy[playerId] || { shots: 1, lastChargeMs: Date.now() };
    const now = Date.now();

    // Determine current recharge interval for this player's team
    const bonusCounts = getTeamBonusCounts(room.territoryState.board, room.territoryState.bonusSquares || []);
    const teamBonusCount = isRed ? bonusCounts.red : bonusCounts.blue;
    const chargeIntervalMs = getTeamRechargeIntervalMs(teamBonusCount);

    const elapsed = Math.max(0, now - playerEnergy.lastChargeMs);
    const earned = Math.floor(elapsed / chargeIntervalMs);
    const currentShots = Math.min(3, playerEnergy.shots + earned);
    const remainderMs = elapsed % chargeIntervalMs;

    if (currentShots < 1) {
      return { room, error: 'No shot charges ready yet!' };
    }

    // Deduct 1 shot and update lastChargeMs
    const newShots = currentShots - 1;
    const newLastChargeMs = now - remainderMs;
    room.territoryState.energy[playerId] = {
      shots: newShots,
      lastChargeMs: newLastChargeMs,
    };

    // Apply push: Red pushes towards top of board (+1), Blue pushes towards row 0 (-1)
    const oldFrontier = room.territoryState.board[colIndex];
    const boardHeight = room.territoryState.boardHeight || (room.territoryState.extremeMode ? EXTREME_HEIGHT : STANDARD_HEIGHT);
    const redWinTarget = boardHeight - 1;
    let newFrontier = oldFrontier;
    if (isRed) {
      newFrontier = Math.min(redWinTarget, oldFrontier + 1);
    } else {
      newFrontier = Math.max(-1, oldFrontier - 1);
    }
    room.territoryState.board[colIndex] = newFrontier;

    // Check if enemy mine was triggered by the push
    const minesToTrigger = [];
    if (room.territoryState.mines) {
      for (const mine of Object.values(room.territoryState.mines)) {
        if (!mine) continue;
        if (isRed && mine.team === 'blue' && mine.col === colIndex && mine.row === oldFrontier + 1) {
          minesToTrigger.push(mine);
        } else if (isBlue && mine.team === 'red' && mine.col === colIndex && mine.row === oldFrontier) {
          minesToTrigger.push(mine);
        }
      }
    }

    if (minesToTrigger.length > 0) {
      triggerTerritoryMineDetonations(room, minesToTrigger);
    }

    const player = room.players.find(p => p.id === playerId);
    const shotEvent = {
      id: `${now.toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`,
      playerId,
      playerName: player?.name || (isRed ? 'Red' : 'Blue'),
      team: isRed ? 'red' : 'blue',
      col: colIndex,
      timestamp: now,
      delta: isRed ? +1 : -1,
    };

    if (!room.territoryState.recentShots) {
      room.territoryState.recentShots = [];
    }
    room.territoryState.recentShots.unshift(shotEvent);
    if (room.territoryState.recentShots.length > 20) {
      room.territoryState.recentShots.pop();
    }

    // Check victory condition (Red reaches top row, Blue reaches row -1)
    const redWins = room.territoryState.board.some(f => f >= redWinTarget);
    const blueWins = room.territoryState.board.some(f => f <= -1);

    if (redWins || blueWins) {
      const winner = redWins && !blueWins ? 'red' : !redWins && blueWins ? 'blue' : (Math.max(...room.territoryState.board) - redWinTarget >= 0 - Math.min(...room.territoryState.board) ? 'red' : 'blue');
      room.territoryState.winnerTeam = winner;
      for (const p of room.players) {
        if (room.territoryState.teams[winner].includes(p.id)) p.score += WIN_SCORE;
      }
      room.phase = 'end';
    }

    return { room, resolved: true, shotEvent };
  }

  // ── Standard Turn-Based Mode ──
  room.territoryState.submittedPicks[playerId] = colIndex;

  const connectedPlayers = room.players.filter(p => p.connected);
  const allSubmitted = connectedPlayers.every(p => room.territoryState.submittedPicks[p.id] !== undefined);

  if (allSubmitted) {
    resolveTerritoryTurn(room);
    return { room, resolved: true };
  }

  return { room, resolved: false };
}

export function resolveTerritoryTurn(room) {
  if (!room.territoryState) return;

  const { teams, board, submittedPicks } = room.territoryState;
  const resolutions = [];
  const minesToTrigger = [];

  const playerMap = new Map(room.players.map(p => [p.id, p.name]));

  // Resolve column by column
  for (let c = 0; c < TERRITORY_COLS; c++) {
    const redPickers = teams.red.filter(pid => submittedPicks[pid] === c).map(pid => playerMap.get(pid) || 'Red');
    const bluePickers = teams.blue.filter(pid => submittedPicks[pid] === c).map(pid => playerMap.get(pid) || 'Blue');

    const N = redPickers.length;
    const M = bluePickers.length;
    const oldFrontier = board[c]; // Red owns 0..oldFrontier, Blue owns oldFrontier+1..9

    let newFrontier = oldFrontier;
    let defenderAdvantageApplied = null;
    let clashResult = '';

    if (N > 0 && M === 0) {
      newFrontier = Math.min(9, oldFrontier + N);
      clashResult = `Red pushed column ${c + 1} by ${N} square(s)`;
    } else if (N === 0 && M > 0) {
      newFrontier = Math.max(-1, oldFrontier - M);
      clashResult = `Blue pushed column ${c + 1} by ${M} square(s)`;
    } else if (N > 0 && M > 0) {
      // Both sides pushed column c
      if (oldFrontier === 4) {
        // Center boundary (row 4 vs row 5)
        const net = N - M;
        newFrontier = Math.min(9, Math.max(-1, oldFrontier + net));
        if (net === 0) {
          clashResult = `Center clash on col ${c + 1}! Forces equal — no change`;
        } else if (net > 0) {
          clashResult = `Center clash on col ${c + 1}! Red overpowered Blue (+${net})`;
        } else {
          clashResult = `Center clash on col ${c + 1}! Blue overpowered Red (+${-net})`;
        }
      } else if (oldFrontier > 4) {
        // Boundary in Blue's half: Red is attacking, Blue is defending
        defenderAdvantageApplied = 'blue';
        const effectiveBlue = M + DEFENDER_BONUS; // defender bonus
        const netRed = N - effectiveBlue;
        newFrontier = Math.min(9, Math.max(-1, oldFrontier + netRed));

        if (netRed > 0) {
          clashResult = `Clash in Blue territory (Col ${c + 1})! Red broke through defender bonus (+${netRed})`;
        } else if (netRed === 0) {
          clashResult = `Clash in Blue territory (Col ${c + 1})! Blue defender bonus held the line (No change)`;
        } else {
          clashResult = `Clash in Blue territory (Col ${c + 1})! Blue defender bonus repelled Red (+${-netRed})`;
        }
      } else {
        // Boundary in Red's half (oldFrontier < 4): Blue is attacking, Red is defending
        defenderAdvantageApplied = 'red';
        const effectiveRed = N + DEFENDER_BONUS; // defender bonus
        const netRed = effectiveRed - M;
        newFrontier = Math.min(9, Math.max(-1, oldFrontier + netRed));

        if (netRed > 0) {
          clashResult = `Clash in Red territory (Col ${c + 1})! Red defender bonus repelled Blue (+${netRed})`;
        } else if (netRed === 0) {
          clashResult = `Clash in Red territory (Col ${c + 1})! Red defender bonus held the line (No change)`;
        } else {
          clashResult = `Clash in Red territory (Col ${c + 1})! Blue broke through defender bonus (+${-netRed})`;
        }
      }
    } else {
      clashResult = `No activity on col ${c + 1}`;
    }

    // Check if enemy mines in column c are crossed by frontier movement
    if (room.territoryState.mines) {
      for (const mine of Object.values(room.territoryState.mines)) {
        if (!mine || mine.col !== c) continue;
        if (newFrontier > oldFrontier && mine.team === 'blue' && mine.row > oldFrontier && mine.row <= newFrontier) {
          minesToTrigger.push(mine);
        } else if (newFrontier < oldFrontier && mine.team === 'red' && mine.row <= oldFrontier && mine.row > newFrontier) {
          minesToTrigger.push(mine);
        }
      }
    }

    board[c] = newFrontier;

    resolutions.push({
      col: c,
      redPicks: redPickers,
      bluePicks: bluePickers,
      oldFrontier,
      newFrontier,
      defenderAdvantageApplied,
      clashResult,
    });
  }

  // Detonate any triggered mines from this turn
  if (minesToTrigger.length > 0) {
    triggerTerritoryMineDetonations(room, minesToTrigger);
  }

  // Save to turn history (capped)
  if (!room.territoryState.turnHistory) {
    room.territoryState.turnHistory = [];
  }
  room.territoryState.turnHistory.push({
    turn: room.territoryState.turn,
    resolutions,
  });
  if (room.territoryState.turnHistory.length > MAX_TURN_HISTORY) {
    room.territoryState.turnHistory.splice(0, room.territoryState.turnHistory.length - MAX_TURN_HISTORY);
  }
  room.territoryState.lastResolutions = resolutions;

  // Check victory condition
  const boardHeight = room.territoryState.boardHeight || 10;
  const redWinTarget = boardHeight - 1;
  let redWins = board.some(f => f >= redWinTarget);
  let blueWins = board.some(f => f <= -1);

  if (redWins && !blueWins) {
    room.territoryState.winnerTeam = 'red';
    for (const p of room.players) {
      if (teams.red.includes(p.id)) p.score += WIN_SCORE;
    }
    room.phase = 'end';
  } else if (blueWins && !redWins) {
    room.territoryState.winnerTeam = 'blue';
    for (const p of room.players) {
      if (teams.blue.includes(p.id)) p.score += WIN_SCORE;
    }
    room.phase = 'end';
  } else if (redWins && blueWins) {
    // Tie-break: deeper penetration wins, award winners
    const maxRedPen = Math.max(...board);
    const minBluePen = Math.min(...board);
    const redDepth = maxRedPen - redWinTarget;
    const blueDepth = -1 - minBluePen;
    const winnerTeam = redDepth >= blueDepth ? 'red' : 'blue';
    room.territoryState.winnerTeam = winnerTeam;
    for (const p of room.players) {
      if (teams[winnerTeam].includes(p.id)) p.score += WIN_SCORE;
    }
    room.phase = 'end';
  } else {
    // Immediately start next turn without delay
    room.territoryState.submittedPicks = {};
    room.territoryState.turn += 1;
    room.phase = 'territory-turn';
  }
}

export function nextTerritoryTurn(code) {
  const room = rooms.get(code);
  if (!room || !room.territoryState) return null;
  if (room.phase !== 'territory-turn' && room.phase !== 'territory-reveal') return null;

  if (room.territoryState.winnerTeam) {
    room.phase = 'end';
    return room;
  }

  // Do not wipe in-progress picks: only reset if all connected players submitted
  // (resolveTerritoryTurn already advances automatically). Manual skip is host-only (checked in index.js).
  room.territoryState.submittedPicks = {};
  room.territoryState.turn += 1;
  room.phase = 'territory-turn';
  room.lastActivityMs = Date.now();
  return room;
}

function startRound(room) {
  const { roles, hiddenPairIds, secretCode } = assignRoles(room.players);
  room.roles = roles;
  room.hiddenPairIds = hiddenPairIds;
  room.secretCode = secretCode;
  room.signals = [];
  room.guesses = [];
  room.phase = 'role-reveal';
  return room;
}

export function advanceToSignal(code) {
  const room = rooms.get(code);
  if (!room) return null;
  room.phase = 'signal';
  room.timerEnd = Date.now() + SIGNAL_TIME * 1000;
  return room;
}

export function advanceToDiscuss(code) {
  const room = rooms.get(code);
  if (!room) return null;
  room.phase = 'discuss';
  room.timerEnd = Date.now() + DISCUSS_TIME * 1000;
  return room;
}

export function advanceToGuess(code) {
  const room = rooms.get(code);
  if (!room) return null;
  room.phase = 'guess';
  room.timerEnd = Date.now() + GUESS_TIME * 1000;
  return room;
}

export function submitSignal(code, playerId, signal) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'signal') return null;
  if (room.signals.find(s => s.playerId === playerId)) return null; // already submitted
  if (typeof signal !== 'string' || !signal.trim()) return null;

  room.signals.push({ playerId, signal: signal.trim().substring(0, 80) });
  room.lastActivityMs = Date.now();
  return room;
}

export function submitGuess(code, playerId, guessData) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'guess') return null;
  if (room.guesses.find(g => g.playerId === playerId)) return null;
  if (!guessData || typeof guessData !== 'object') return null;

  const roleMap = new Map(room.roles.map(r => [r.playerId, r.role]));
  const role = roleMap.get(playerId);
  // Whitelist fields to prevent playerId spoofing via spread
  let clean = null;
  if (role === 'hidden' && typeof guessData.guessedPartnerId === 'string') {
    if (guessData.guessedPartnerId === playerId) return null;
    if (!room.players.some(p => p.id === guessData.guessedPartnerId)) return null;
    clean = { guessedPartnerId: guessData.guessedPartnerId };
  } else if (role === 'neutral' && typeof guessData.guessedPlayerId === 'string') {
    if (guessData.guessedPlayerId === playerId) return null;
    if (!room.players.some(p => p.id === guessData.guessedPlayerId)) return null;
    clean = { guessedPlayerId: guessData.guessedPlayerId };
  } else {
    return null;
  }

  room.guesses.push({ playerId, ...clean });
  room.lastActivityMs = Date.now();
  return room;
}

export function resolveRound(code) {
  const room = rooms.get(code);
  if (!room) return null;

  const roleMap = new Map(room.roles.map(r => [r.playerId, r.role]));
  const scoreDeltas = calculateScores(room.guesses, room.hiddenPairIds, roleMap);

  // Apply deltas
  for (const player of room.players) {
    player.score += scoreDeltas.get(player.id) || 0;
  }

  room.phase = 'reveal';
  return { room, scoreDeltas };
}

export function advanceRound(code) {
  const room = rooms.get(code);
  if (!room) return null;

  if (room.round >= HIDDEN_ROUNDS) {
    room.phase = 'end';
    return room;
  }

  room.round += 1;
  return startRound(room);
}

export function isHost(room, socketId) {
  return !!room?.players?.find(p => p.id === socketId && p.isHost);
}

export function resetToLobby(room) {
  for (const p of room.players) p.score = 0;
  room.phase = 'lobby';
  room.round = 0;
  room.roles = [];
  room.hiddenPairIds = [];
  room.secretCode = null;
  room.signals = [];
  room.guesses = [];
  room.chromaState = null;
  room.territoryState = null;
  room.blendState = null;
  room.liarState = null;
  room.bluffState = null;
  room.missileCommandState = null;
  room.timerEnd = null;
  room.endVote = null;
  room.lastActivityMs = Date.now();
  return room;
}

function hasEndVotePassed(room) {
  if (!room.endVote) return false;
  const connected = room.players.filter(p => p.connected);
  return connected.length > 0 && connected.every(p => room.endVote.yesIds.includes(p.id));
}

export function startEndVote(code, playerId) {
  const room = rooms.get(code);
  if (!room) return { error: 'Room not found' };
  if (room.phase === 'lobby' || room.phase === 'end') return { error: 'No active game to end' };
  if (!isHost(room, playerId)) return { error: 'Only the host can call a vote' };
  if (room.endVote) return { error: 'A vote is already running' };
  const host = room.players.find(p => p.id === playerId);
  room.endVote = {
    initiatorId: playerId,
    initiatorName: host?.name || 'Host',
    yesIds: [playerId],
    startedAt: Date.now(),
  };
  room.lastActivityMs = Date.now();
  if (hasEndVotePassed(room)) {
    resetToLobby(room);
    return { room, passed: true };
  }
  return { room, started: true };
}

export function submitEndVote(code, playerId, agree) {
  const room = rooms.get(code);
  if (!room || !room.endVote) return { error: 'No vote running' };
  if (room.phase === 'lobby' || room.phase === 'end') {
    room.endVote = null;
    return { error: 'No active game' };
  }
  const player = room.players.find(p => p.id === playerId);
  if (!player || !player.connected) return { error: 'Not in this room' };
  if (agree === false) {
    const name = player.name;
    room.endVote = null;
    room.lastActivityMs = Date.now();
    return { room, failed: true, declinedBy: name };
  }
  if (!room.endVote.yesIds.includes(playerId)) room.endVote.yesIds.push(playerId);
  room.lastActivityMs = Date.now();
  if (hasEndVotePassed(room)) {
    resetToLobby(room);
    return { room, passed: true };
  }
  return { room, voted: true };
}

export function cancelEndVote(code, playerId) {
  const room = rooms.get(code);
  if (!room || !room.endVote) return null;
  if (room.endVote.initiatorId !== playerId && !isHost(room, playerId)) return null;
  room.endVote = null;
  room.lastActivityMs = Date.now();
  return room;
}

export function playerDisconnected(playerId) {
  for (const room of rooms.values()) {
    const player = room.players.find(p => p.id === playerId);
    if (player) {
      player.connected = false;
      room.lastActivityMs = Date.now();
      // A pending end-game vote can't complete predictably — cancel it
      if (room.endVote) room.endVote = null;
      // Transfer host if host left
      if (player.isHost) {
        player.isHost = false;
        const next = room.players.find(p => p.connected);
        if (next) next.isHost = true;
      }
      return room;
    }
  }
  return null;
}

export function deleteRoom(code) {
  rooms.delete(code);
}

// ─── Missile Command thin wrappers (silo'd logic lives in missileCommand.js) ─
export function buildMissileBuilding(code, playerId, action) {
  const room = rooms.get(code);
  if (!room || !room.missileCommandState) return null;
  if (room.phase !== 'missile-command-play' && room.phase !== 'missile-command-build') return null;
  const res = missileBuildBuilding(room.missileCommandState, playerId, action);
  if (res.error) return { room, error: res.error };
  room.lastActivityMs = Date.now();
  return { room, pending: res.pending };
}

export function upgradeMissileBuilding(code, playerId, buildingId) {
  const room = rooms.get(code);
  if (!room || !room.missileCommandState) return null;
  if (room.phase !== 'missile-command-play' && room.phase !== 'missile-command-build') return null;
  const res = missileUpgradeBuilding(room.missileCommandState, playerId, buildingId);
  if (res.error) return { room, error: res.error };
  room.lastActivityMs = Date.now();
  return { room, pending: res.pending };
}

export function launchMissile(code, playerId, action) {
  const room = rooms.get(code);
  if (!room || !room.missileCommandState) return null;
  if (room.phase !== 'missile-command-play') return null;
  const res = missileLaunch(room.missileCommandState, playerId, action);
  if (res.error) return { room, error: res.error };
  room.lastActivityMs = Date.now();
  return { room, missiles: res.missiles };
}

export function launchMissileType(code, playerId, launcherType, targetGx, targetGy) {
  const room = rooms.get(code);
  if (!room || !room.missileCommandState) return null;
  if (room.phase !== 'missile-command-play') return null;
  const res = missileLaunchType(room.missileCommandState, playerId, launcherType, targetGx, targetGy);
  if (res.error) return { room, error: res.error };
  room.lastActivityMs = Date.now();
  return { room, missiles: res.missiles };
}

export function loadMissile(code, playerId, launcherId) {
  const room = rooms.get(code);
  if (!room || !room.missileCommandState) return null;
  if (room.phase !== 'missile-command-play') return null;
  const res = missileLoadMissile(room.missileCommandState, playerId, launcherId);
  if (res.error) return { room, error: res.error };
  room.lastActivityMs = Date.now();
  return { room, building: res.building };
}

export function toggleAutobuild(code, playerId, launcherId) {
  const room = rooms.get(code);
  if (!room || !room.missileCommandState) return null;
  if (room.phase !== 'missile-command-play') return null;
  const res = missileToggleAutobuild(room.missileCommandState, playerId, launcherId);
  if (res.error) return { room, error: res.error };
  room.lastActivityMs = Date.now();
  return { room, building: res.building };
}

export function tickMissileRoom(room, now = Date.now()) {
  if (!room?.missileCommandState) return null;
  if (room.phase !== 'missile-command-play') return null;
  const { events } = tickMissileCommand(room.missileCommandState, now);
  room.lastActivityMs = now;
  if (room.missileCommandState.winnerId) {
    const winner = room.players.find(p => p.id === room.missileCommandState.winnerId);
    if (winner) winner.score += 5;
    room.phase = 'missile-command-end';
  }
  return { room, events };
}

export function sweepInactiveRooms(now = Date.now()) {
  for (const [code, room] of rooms) {
    const allGone = room.players.every(p => !p.connected);
    const idle = now - (room.lastActivityMs || room.createdAt || now);
    if (allGone || idle > ROOM_TTL_MS) {
      rooms.delete(code);
    }
  }
}

export const SIGNAL_TIME_SEC = SIGNAL_TIME;
export const DISCUSS_TIME_SEC = DISCUSS_TIME;
export const GUESS_TIME_SEC = GUESS_TIME;
export const BLEND_WORD_SEC_VALUE = BLEND_WORD_SEC;
export const BLEND_VOTE_SEC_VALUE = BLEND_VOTE_SEC;
export const BLEND_GUESS_SEC_VALUE = BLEND_GUESS_SEC;
export const LIAR_BID_SEC_VALUE = LIAR_BID_SEC;
export const BLUFF_BET_SEC_VALUE = BLUFF_BET_SEC;
export const CHROMA_RACE_MS_VALUE = CHROMA_RACE_MS;
export const TOTAL_ROUNDS_COUNT = TOTAL_ROUNDS;
export const ROOM_TTL_MS_VALUE = ROOM_TTL_MS;
