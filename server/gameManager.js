// gameManager.js — In-memory game state management

import { assignRoles, calculateScores, generateRoomCode } from './gameLogic.js';
import {
  MISSILE_CONFIG,
  createMissileCommandState,
  missileBuildBuilding,
  missileUpgradeBuilding,
  missileSellBuilding,
  missileCancelSell,
  missileLoadMissile,
  missileRebuildRubble,
  missileLaunch,
  missileLaunchType,
  missileSetKeepFire,
  missileFireDesperation,
  missileClaimShip,
  missileAiTick,
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
// Grid sizes must match the client (ChromaShiftGame gridDim): 5x5 standard,
// 10x10 extreme. Single source of truth — a mismatch strands tiles that can
// never be the target and silently rejects clicks on them.
const CHROMA_STANDARD_TILES = 25;
const CHROMA_EXTREME_TILES = 100;
function chromaTotalTiles(room) {
  return room.chromaOptions?.extremeMode ? CHROMA_EXTREME_TILES : CHROMA_STANDARD_TILES;
}
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
const TERRITORY_TURN_SEC = 30;
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
    missileCommandOptions: { startingResources: MISSILE_CONFIG.startingResources, fogOfWar: true, fogHistory: false, supplyShip: false, aiOpponent: false, aiDifficulty: 'hard', aiType: 'balanced' },
    chromaState: null,
    territoryState: null,
    blendState: null,
    liarState: null,
    bluffState: null,
    missileCommandState: null,
    phase: 'lobby',          // lobby | role-reveal | signal | discuss | guess | reveal | end | chroma-play | chroma-reveal | territory-turn | territory-reveal | blend-word | blend-vote | blend-guess | blend-reveal
    round: 0,
    // Single source of truth for host authority: room.hostId. player.isHost is
    // kept in sync for backwards compat but is DERIVED from this field.
    hostId,
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
  if (room.players.find(p => p.id === playerId)) return { error: 'Already in room' };
  const cleanName = playerName.trim().substring(0, 20);
  // Reclaim a disconnected same-name slot instead of pushing a duplicate.
  // This works in EVERY phase (including mid-game) so a player whose tab
  // closed can rejoin with the same name + code and reclaim their seat with
  // a full state resync, instead of being refused with "Game already in
  // progress". Mirrors rejoin-room semantics.
  const ghost = room.players.find(p => !p.connected && p.name.trim().toLowerCase() === cleanName.toLowerCase());
  if (ghost) {
    const oldId = ghost.id;
    ghost.id = playerId;
    ghost.connected = true;
    delete ghost.disconnectedAt;
    delete room.deleteAt;
    room.lastActivityMs = Date.now();
    remapPlayerId(room, oldId, playerId);
    // Host authority: reclaim if this slot held it; otherwise ensure a
    // functional host exists (fully-abandoned room).
    if (!room.hostId) room.hostId = playerId;
    if (room.hostId === oldId) room.hostId = playerId;
    const connectedHosts = room.players.filter(p => p.connected && p.id === room.hostId);
    if (connectedHosts.length === 0) room.hostId = playerId;
    for (const p of room.players) p.isHost = (p.id === room.hostId);
    return { room, reclaimed: true };
  }
  if (room.phase !== 'lobby') return { error: 'Game already in progress' };
  if (room.players.length >= 12) return { error: 'Room is full' };

  room.players.push({ id: playerId, name: cleanName, score: 0, isHost: false, connected: true });
  delete room.deleteAt;
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
  if (!isHost(room, hostId)) return { error: 'Only the host can kick players' };
  const targetIdx = room.players.findIndex(p => p.id === targetId);
  if (targetIdx === -1) return { error: 'Player not found' };
  // Disconnected (ghost) seats may be kicked at any time, even mid-game.
  if (room.phase !== 'lobby' && room.players[targetIdx].connected) {
    return { error: 'Can only kick players from the lobby' };
  }
  if (hostId === targetId) return { error: 'Host cannot kick themselves' };
  const idx = room.players.findIndex(p => p.id === targetId);
  if (idx === -1) return { error: 'Player not found' };
  if (room.players[idx].isHost) return { error: 'Cannot kick the host' };
  room.players.splice(idx, 1);
  if (room.hostId === targetId) {
    room.hostId = room.players.length ? room.players[0].id : null;
  }
  if (!room.hostId && room.players.length) room.hostId = room.players[0].id;
  for (const p of room.players) p.isHost = (p.id === room.hostId);
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
  const next = { ...(room.missileCommandOptions || { startingResources: MISSILE_CONFIG.startingResources, fogOfWar: true, fogHistory: false, supplyShip: false }) };
  if (typeof options.startingResources === 'number' && options.startingResources >= 50 && options.startingResources <= 500) {
    next.startingResources = Math.round(options.startingResources);
  }
  // Fog of War is a plain boolean toggle; without this the Lobby button
  // accepted clicks but the server dropped them, so it looked dead.
  if (typeof options.fogOfWar === 'boolean') {
    next.fogOfWar = options.fogOfWar;
  }
  // Building history in fog: remembered last-known buildings. Off by default.
  if (typeof options.fogHistory === 'boolean') {
    next.fogHistory = options.fogHistory;
  }
  if (typeof options.supplyShip === 'boolean') {
    next.supplyShip = options.supplyShip;
  }
  if (typeof options.aiOpponent === 'boolean') {
    next.aiOpponent = options.aiOpponent;
  }
  if (typeof options.aiDifficulty === 'string' && ['easy','hard','cheater'].includes(options.aiDifficulty)) {
    next.aiDifficulty = options.aiDifficulty;
  }
  if (typeof options.aiType === 'string' && ['aggressive','defensive','balanced','economic'].includes(options.aiType)) {
    next.aiType = options.aiType;
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
    room.timerEnd = isExtreme ? null : (Date.now() + TERRITORY_TURN_SEC * 1000);
    room.lastActivityMs = Date.now();
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
    const aiEnabled = room.missileCommandOptions?.aiOpponent === true;
    if (aiEnabled) {
      if (room.players.length !== 1) return null;
      room.players.push({ id: 'AI-BOT', name: 'AI Opponent', score: 0, isHost: false, connected: true, isAI: true });
    } else {
      if (room.players.length !== 2) return null;
    }
    room.round = 1;
    room.endVote = null;
    for (const p of room.players) p.score = 0;
    const ids = room.players.map(p => p.id);
    room.missileCommandState = createMissileCommandState(ids, {
      startingResources: room.missileCommandOptions?.startingResources ?? MISSILE_CONFIG.startingResources,
      fogOfWar: room.missileCommandOptions?.fogOfWar ?? true,
      fogHistory: room.missileCommandOptions?.fogHistory ?? false,
      supplyShip: room.missileCommandOptions?.supplyShip ?? false,
    });
    if (aiEnabled) room.missileCommandState.aiPlayerId = 'AI-BOT';
    room.missileCommandState.aiDifficulty = room.missileCommandOptions?.aiDifficulty ?? 'hard';
    room.missileCommandState.aiType = room.missileCommandOptions?.aiType ?? 'balanced';
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
export const BLUFF_MAX_RAISES = 10; // bidding cap — then the player must call
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
  const totalTiles = chromaTotalTiles(room);
  const targetTileIndex = Math.floor(Math.random() * totalTiles);
  const baseIndex = (room.round - 1) % BASE_GRADIENT_PALETTES.length;
  const targetIndex = (room.round * 2 + 1) % TARGET_GRADIENT_PALETTES.length;
  const shiftDurationSec = 60 + Math.floor(Math.random() * 61); // 60s to 120s
  const now = Date.now();

  room.chromaState = {
    targetTileIndex,
    baseGradient: BASE_GRADIENT_PALETTES[baseIndex],
    targetGradient: TARGET_GRADIENT_PALETTES[targetIndex],
    roundWinnerId: null,
    roundWinnerName: null,
    pointsAwarded: 0,
    shiftDurationSec,
    roundEndsAt: now + shiftDurationSec * 1000,
    seed: Date.now() + Math.random(),
    // 10s race: first finder announces, others can solve for half points
    raceEndAt: null,
    firstFinderId: null,
    firstFinderName: null,
    firstFinderPoints: 0,
    solvers: [],
  };

  room.phase = 'chroma-play';
  room.timerEnd = now + shiftDurationSec * 1000;
  room.lastActivityMs = now;
  return room;
}

export function submitChromaGuess(code, playerId, tileIndex) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'chroma-play' || !room.chromaState) {
    return { room: room || null, correct: false, reason: 'not-your-round' };
  }

  const player = room.players.find(p => p.id === playerId);
  if (!player) return { room, correct: false, reason: 'not-your-round' };
  const totalTiles = chromaTotalTiles(room);
  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= totalTiles) return null;

  if (tileIndex === room.chromaState.targetTileIndex) {
    // Already solved by this player (e.g. double-click during race) — ignore, no penalty
    if (room.chromaState.solvers?.some(s => s.playerId === playerId)) {
      return { room, correct: true, alreadySolved: true, reason: 'correct' };
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
      room.timerEnd = null; // round timeout no longer applies once someone found it
      // Phase stays chroma-play during the race; reveal happens on timeout
      return { room, correct: true, pointsAwarded: points, winnerId: playerId, raceStarted: true, raceEndAt: room.chromaState.raceEndAt, reason: 'correct' };
    }
    // Race already running: half points for additional solvers
    if (now > room.chromaState.raceEndAt) {
      return { room, correct: false, reason: 'too-late' }; // race expired, reveal imminent
    }
    const full = chromaFullPoints(room, playerId);
    const points = full / 2;
    player.score += points;
    room.chromaState.solvers.push({ playerId, playerName: player.name, points });
    room.lastActivityMs = now;
    return { room, correct: true, pointsAwarded: points, winnerId: playerId, raceSolved: true, reason: 'correct' };
  } else {
    // Wrong guess penalty: lose 1 point
    player.score -= 1;
    room.lastActivityMs = Date.now();
    return { room, correct: false, reason: 'wrong', penaltyPlayerId: playerId, currentScore: player.score };
  }
}

export function resolveChromaRace(code) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'chroma-play' || !room.chromaState) return null;
  if (!room.chromaState.raceEndAt) return null;
  room.chromaState.raceEndAt = null;
  room.phase = 'chroma-reveal';
  room.timerEnd = null;
  room.lastActivityMs = Date.now();
  return room;
}

export function expireChromaRound(code) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'chroma-play' || !room.chromaState) return null;
  // If a race is running, resolving it awards the solvers found so far.
  if (room.chromaState.raceEndAt) {
    room.chromaState.raceEndAt = null;
    room.phase = 'chroma-reveal';
    room.timerEnd = null;
    room.lastActivityMs = Date.now();
    return room;
  }
  // No one found the tile: resolve with no points.
  room.chromaState.raceEndAt = null;
  room.chromaState.roundWinnerId = null;
  room.chromaState.roundWinnerName = null;
  room.chromaState.pointsAwarded = 0;
  room.phase = 'chroma-reveal';
  room.timerEnd = null;
  room.lastActivityMs = Date.now();
  return room;
}

// Aliases for callers/tests that use other names.
export const resolveChromaTimeout = expireChromaRound;
export const resolveChromaRound = expireChromaRound;
export const autoResolveChromaRound = expireChromaRound;
export const expireChromaRace = expireChromaRound;
export const resolveChromaRoundTimeout = expireChromaRound;

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
  // Atomic close: once the phase deadline has passed, no more clues are
  // recorded (an honest reject — the client keeps its "not submitted" state).
  if (typeof room.timerEnd === 'number' && Date.now() > room.timerEnd) return null;
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
  // Atomic close: once the phase deadline has passed, no more votes are
  // recorded (an honest reject — the client keeps its "not submitted" state).
  if (typeof room.timerEnd === 'number' && Date.now() > room.timerEnd) return null;

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
  if (room.phase !== 'blend-vote') return null;

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

export function expireBlendWord(code) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'blend-word' || !room.blendState) return null;
  return advanceToBlendVote(code);
}

export function expireBlendVote(code) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'blend-vote' || !room.blendState) return null;
  return resolveBlendVotes(code);
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

function liarNextBidder(room, playerId) {
  // Table order rotation (wraps). With 2 players this is just the opponent;
  // with 3+ every player gets a turn instead of ping-ponging between two.
  const ids = room.players.map(p => p.id);
  const i = ids.indexOf(playerId);
  if (i === -1) return ids[0] ?? null;
  return ids[(i + 1) % ids.length];
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
  room.liarState.toActId = liarNextBidder(room, playerId);
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
  // Player to act timed out: last bidder takes the round (in 2p that is the
  // opponent; with 3+ it is whoever made the standing bid). No bids yet:
  // next in table order wins.
  const lastBid = room.liarState.bids[room.liarState.bids.length - 1];
  const timedOutId = room.liarState.toActId;
  const winnerId = lastBid?.playerId || liarNextBidder(room, timedOutId) || timedOutId;
  const winner = room.players.find(p => p.id === winnerId);
  awardLiarPoints(room, winnerId, LIAR_WIN_POINTS);
  room.liarState.winnerId = winnerId;
  room.liarState.winnerName = winner ? winner.name : '???';
  room.liarState.loserId = timedOutId;
  room.liarState.timedOutId = timedOutId;
  room.liarState.timeoutBidCount = room.liarState.bids.length;
  room.liarState.winnerReason = lastBid ? 'last-bidder' : 'next-in-rotation';
  room.liarState.reason = 'timeout';
  // Keep the standing bid visible on reveal so the timeout is auditable, but
  // no actual count is claimed (the round was not challenged).
  room.liarState.challengedBid = null;
  room.liarState.actualCount = null;
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

// Joker beats ONLY Kings, and loses to Queens and Jacks.
function cardBeats(a, b) {
  if (a === b) return false;
  if (a === 'Joker') return b === 'K';
  if (b === 'Joker') return a !== 'K';
  return (BLUFF_RANKS[a] || 0) > (BLUFF_RANKS[b] || 0);
}

export function resolveBluffShowdown(room) {
  const [a, b] = room.players;
  const cardA = room.bluffState.cards[a.id];
  const cardB = room.bluffState.cards[b.id];

  const winnerId = cardBeats(cardA, cardB) ? a.id : b.id;
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
  // Successful bluff: a *voluntary* fold while the bettor holds a Jack.
  // A timeout is not a voluntary fold, so it never earns the Jack bluff bonus.
  const bluffWin = !timedOut && room.bluffState.cards[winnerId] === 'J';
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
  // Bidding cap: after 10 bets/raises the player MUST call (no raise, no fold).
  if (facingBet && (room.bluffState.betCount || 0) >= BLUFF_MAX_RAISES && action !== 'call') return null;

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
    room.timerEnd = null;
  } else if (blueWins && !redWins) {
    room.territoryState.winnerTeam = 'blue';
    for (const p of room.players) {
      if (teams.blue.includes(p.id)) p.score += WIN_SCORE;
    }
    room.phase = 'end';
    room.timerEnd = null;
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
    room.timerEnd = null;
  } else {
    // Immediately start next turn without delay
    room.territoryState.submittedPicks = {};
    room.territoryState.turn += 1;
    room.phase = 'territory-turn';
    room.timerEnd = room.territoryState.extremeMode ? null : (Date.now() + TERRITORY_TURN_SEC * 1000);
    room.lastActivityMs = Date.now();
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
  room.timerEnd = room.territoryState.extremeMode ? null : (Date.now() + TERRITORY_TURN_SEC * 1000);
  room.lastActivityMs = Date.now();
  return room;
}

export function expireTerritoryTurn(code) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'territory-turn' || !room.territoryState) return null;
  if (room.territoryState.extremeMode) return null;
  if (room.territoryState.winnerTeam) {
    room.phase = 'end';
    room.timerEnd = null;
    room.lastActivityMs = Date.now();
    return room;
  }
  // Auto-resolve using locked-in picks; players without a pick pass.
  resolveTerritoryTurn(room);
  room.lastActivityMs = Date.now();
  return room;
}

// Aliases for callers/tests that use other names.
export const autoResolveTerritoryTurn = expireTerritoryTurn;
export const autoResolveTerritoryTurnOnExpiry = expireTerritoryTurn;
export const resolveTerritoryTurnTimeout = expireTerritoryTurn;
export const resolveTerritoryTurnOnTimeout = expireTerritoryTurn;
export const expireTerritoryTurnTimer = expireTerritoryTurn;

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
  if (!room) return false;
  // Single source of truth: room.hostId. Fall back to player.isHost for rooms
  // created before this field existed (tests/legacy) so nothing breaks.
  if (room.hostId) return room.hostId === socketId;
  return !!room.players?.find(p => p.id === socketId && p.isHost);
}

export function resetToLobby(room) {
  // Drop any AI opponent so it doesn't linger in the lobby between games.
  room.players = room.players.filter(p => !p.isAI);
  if (!room.hostId && room.players.length) room.hostId = room.players[0].id;
  for (const p of room.players) { p.score = 0; p.isHost = (p.id === room.hostId); }
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

// A passed end-vote finishes the game early: show the final standings
// (scores kept) on the end screen, where the host's Back to Lobby button
// returns everyone to the lobby. Never resets scores here — that happens
// in resetToLobby when leaving the end screen.
function finishGameEarly(room) {
  room.phase = 'end';
  room.timerEnd = null;
  room.endVote = null;
  room.lastActivityMs = Date.now();
  return room;
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
    finishGameEarly(room);
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
    finishGameEarly(room);
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

// Host-only force-advance: resolve a stalled phase/round and move everyone to a
// consistent next state. Returns the updated room, or null when not allowed.
export function forceAdvance(code, playerId) {
  const room = rooms.get(code);
  if (!room) return null;
  if (!isHost(room, playerId)) return null;
  if (room.phase === 'lobby' || room.phase === 'end') return null;
  room.lastActivityMs = Date.now();
  // A forced advance supersedes any in-flight end-game vote.
  room.endVote = null;
  switch (room.phase) {
    case 'signal':
      return advanceToDiscuss(code);
    case 'discuss':
      return advanceToGuess(code);
    case 'guess': {
      const res = resolveRound(code);
      return res ? res.room : null;
    }
    case 'reveal':
    case 'role-reveal': {
      if (room.phase === 'role-reveal') return advanceToSignal(code);
      const next = advanceRound(code);
      if (!next) return null;
      if (next.phase === 'end') return next;
      return advanceToSignal(code) || next;
    }
    case 'chroma-play': {
      if (room.chromaState && room.chromaState.raceEndAt) {
        return resolveChromaRace(code) || rooms.get(code);
      }
      room.phase = 'chroma-reveal';
      room.timerEnd = null;
      return room;
    }
    case 'chroma-reveal':
      return nextChromaRound(code);
    case 'territory-turn':
    case 'territory-reveal':
      return nextTerritoryTurn(code);
    case 'blend-word': {
      const r = advanceToBlendVote(code);
      if (r) r.timerEnd = Date.now() + BLEND_VOTE_SEC * 1000;
      return r;
    }
    case 'blend-vote': {
      const r = resolveBlendVotes(code);
      if (r && r.phase === 'blend-guess') r.timerEnd = Date.now() + BLEND_GUESS_SEC * 1000;
      return r;
    }
    case 'blend-guess': {
      return expireBlendGuess(code) || rooms.get(code);
    }
    case 'blend-reveal':
      return nextBlendRound(code);
    case 'liar-bid': {
      return expireLiarBid(code) || rooms.get(code);
    }
    case 'liar-reveal':
      return nextLiarRound(code);
    case 'bluff-bet': {
      return expireBluffBet(code) || rooms.get(code);
    }
    case 'bluff-reveal':
      return nextBluffRound(code);
    case 'missile-command-build':
      if (!room.missileCommandState) return null;
      room.phase = 'missile-command-play';
      room.lastActivityMs = Date.now();
      return room;
    case 'missile-command-play': {
      if (!room.missileCommandState) return null;
      tickMissileRoom(room);
      return rooms.get(code) || room;
    }
    case 'missile-command-end':
      return room;
    default:
      return null;
  }
}

// Aliases for compatibility with possible client/test naming.
export const forceAdvanceRound = forceAdvance;
export const forceAdvancePhase = forceAdvance;
export const endRound = forceAdvance;
export const endCurrentRound = forceAdvance;
export const resolveStalledPhase = forceAdvance;

export function playerDisconnected(playerId) {
  for (const room of rooms.values()) {
    const player = room.players.find(p => p.id === playerId);
    if (player) {
      player.connected = false;
      player.disconnectedAt = Date.now();
      room.lastActivityMs = Date.now();
      // A pending end-game vote can't complete predictably — cancel it
      if (room.endVote) room.endVote = null;
      // Transfer host if host left (atomic migration). Host identity lives
      // only in room.hostId; player.isHost flags are resynced below.
      const wasHost = (room.hostId ? room.hostId === playerId : player.isHost) || player.isHost;
      if (wasHost) {
        player.isHost = false;
        // Clear hostId so we can reassign; if a connected player remains,
        // promote the first one. Otherwise keep hostId pointing at this slot so
        // a returning host reclaims it (fully-abandoned room).
        const next = room.players.find(p => p.connected && p.id !== playerId);
        if (next) {
          room.hostId = next.id;
          next.isHost = true;
        } else {
          // No connected player left: keep hostId on the (now disconnected)
          // slot so the original host reclaims authority on reconnect.
          room.hostId = playerId;
        }
      }
      // Resync isHost flags from the single source of truth.
      for (const p of room.players) p.isHost = (p.id === room.hostId);
      // Everyone gone: schedule deletion after a grace window instead of
      // deleting immediately, so brief backgrounding doesn't nuke the game.
      // The periodic sweep enforces deleteAt; any rejoin clears it.
      if (room.players.every(p => !p.connected)) {
        room.deleteAt = Date.now() + REJOIN_GRACE_MS;
      }
      return room;
    }
  }
  return null;
}

export function deleteRoom(code) {
  rooms.delete(code);
}

// How long a fully-abandoned room survives before the sweep deletes it.
// Covers phone backgrounding, network swaps, and short drops — the client
// auto-rejoins on reconnect, so anything under this is seamless.
export const REJOIN_GRACE_MS = 5 * 60 * 1000;
// Grace period for a disconnected (ghost) seat before it is freed automatically.
export const GHOST_SEAT_GRACE_MS = 60 * 1000;
export const DISCONNECTED_SEAT_GRACE_MS = GHOST_SEAT_GRACE_MS;
export const DISCONNECT_GRACE_MS = GHOST_SEAT_GRACE_MS;
export const SEAT_GRACE_MS = GHOST_SEAT_GRACE_MS;
export const GHOST_GRACE_MS = GHOST_SEAT_GRACE_MS;
export const DISCONNECTED_GRACE_MS = GHOST_SEAT_GRACE_MS;
export const GHOST_EXPIRY_MS = GHOST_SEAT_GRACE_MS;


// Recursively replaces every exact occurrence of oldId with newId inside the
// room's game-state subtrees (both object keys and string values). Socket ids
// are long random tokens, so an exact string match can only be an identity
// reference — never a name, label, or game value.
function remapIdDeep(value, oldId, newId) {
  if (value === oldId) return newId;
  if (Array.isArray(value)) return value.map(v => remapIdDeep(v, oldId, newId));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k === oldId ? newId : k] = remapIdDeep(v, oldId, newId);
    }
    return out;
  }
  return value;
}

// Remap one socket id to another across the roster-adjacent game state
// (reconnects change socket ids). Shared by rejoin-room and the join-room
// ghost-reclaim path so a returning player never splits into two entries.
function remapPlayerId(room, oldId, newId) {
  if (oldId === newId) return;
  for (const key of ['roles', 'signals', 'guesses', 'endVote', 'chromaState', 'territoryState', 'blendState', 'liarState', 'bluffState', 'missileCommandState']) {
    if (room[key]) room[key] = remapIdDeep(room[key], oldId, newId);
  }
  if (room.chromaOptions?.playerDifficulties) {
    room.chromaOptions.playerDifficulties = remapIdDeep(room.chromaOptions.playerDifficulties, oldId, newId);
  }
}

// Reclaim a disconnected player's slot after a reconnect (new socket id).
// Matches by room code + player name against DISCONNECTED slots only, so a
// connected player can never be hijacked. Remaps the old socket id to the new
// one across the roster and every game state, so scores, buildings, missiles,
// votes, and turn order all survive the drop.
// Build the round-reveal payload for a room currently in the reveal phase,
// so a reconnecting/rejoining client can reconstruct the results screen
// instead of hanging on "Calculating results…". Score deltas are recomputed
// from the (already-applied) guesses; they are deterministic, so this is safe.
export function buildRevealPayload(room) {
  if (!room || room.phase !== 'reveal') return null;
  const roleMap = new Map((room.roles || []).map(r => [r.playerId, r.role]));
  const scoreDeltas = calculateScores(room.guesses || [], room.hiddenPairIds || [], roleMap);
  const deltas = {};
  for (const [pid, pts] of scoreDeltas) deltas[pid] = pts;
  return {
    hiddenPairIds: room.hiddenPairIds,
    secretCode: room.secretCode,
    roles: room.roles,
    signals: room.signals,
    guesses: room.guesses,
    scoreDeltas: deltas,
    players: room.players,
  };
}

export function rejoinRoom(code, newSocketId, playerName) {
  const room = rooms.get(code);
  if (!room) return { error: 'Room not found' };
  const want = (playerName ?? '').trim().toLowerCase();
  if (!want) return { error: 'Name required' };
  const player = room.players.find(p => !p.connected && p.name.trim().toLowerCase() === want);
  if (!player) return { error: 'No disconnected slot for that name' };
  const oldId = player.id;
  player.id = newSocketId;
  player.connected = true;
  delete player.disconnectedAt;
  delete room.deleteAt;
  room.lastActivityMs = Date.now();
  remapPlayerId(room, oldId, newSocketId);
  // Host authority: if this slot was the host, reclaim it (revert-on-reconnect
  // for the same slot). If no connected player currently holds host authority
  // (fully-abandoned room, or migrated host also gone), grant it to this
  // rejoining player so the room always has a functional host.
  if (!room.hostId) room.hostId = newSocketId;
  if (room.hostId === oldId) room.hostId = newSocketId;
  const connectedHosts = room.players.filter(p => p.connected && p.id === room.hostId);
  if (connectedHosts.length === 0) room.hostId = newSocketId;
  for (const p of room.players) p.isHost = (p.id === room.hostId);
  return { room, playerId: newSocketId, reclaimed: true };
}

// ─── Missile Command thin wrappers (silo'd logic lives in missileCommand.js) ─
export function buildMissileBuilding(code, playerId, action) {
  const room = rooms.get(code);
  if (!room || !room.missileCommandState) return null;
  if (room.phase !== 'missile-command-play' && room.phase !== 'missile-command-build') return null;
  const res = missileBuildBuilding(room.missileCommandState, playerId, action);
  if (res.error) return { room, error: res.error, membershipLost: res.membershipLost };
  room.lastActivityMs = Date.now();
  return { room, pending: res.pending };
}

export function upgradeMissileBuilding(code, playerId, buildingId) {
  const room = rooms.get(code);
  if (!room || !room.missileCommandState) return null;
  if (room.phase !== 'missile-command-play' && room.phase !== 'missile-command-build') return null;
  const res = missileUpgradeBuilding(room.missileCommandState, playerId, buildingId);
  if (res.error) return { room, error: res.error, membershipLost: res.membershipLost };
  room.lastActivityMs = Date.now();
  return { room, pending: res.pending };
}

export function sellMissileBuilding(code, playerId, buildingId) {
  const room = rooms.get(code);
  if (!room || !room.missileCommandState) return null;
  if (room.phase !== 'missile-command-play') return null;
  const res = missileSellBuilding(room.missileCommandState, playerId, buildingId);
  if (res.error) return { room, error: res.error, membershipLost: res.membershipLost };
  room.lastActivityMs = Date.now();
  return { room, pending: res.pending };
}

export function cancelMissileSell(code, playerId, buildingId) {
  const room = rooms.get(code);
  if (!room || !room.missileCommandState) return null;
  if (room.phase !== 'missile-command-play') return null;
  const res = missileCancelSell(room.missileCommandState, playerId, buildingId);
  if (res.error) return { room, error: res.error, membershipLost: res.membershipLost };
  room.lastActivityMs = Date.now();
  return { room, cancelled: res.cancelled };
}

export function rebuildRubble(code, playerId, rubbleId) {
  const room = rooms.get(code);
  if (!room || !room.missileCommandState) return null;
  if (room.phase !== 'missile-command-play') return null;
  const res = missileRebuildRubble(room.missileCommandState, playerId, rubbleId);
  if (res.error) return { room, error: res.error, membershipLost: res.membershipLost };
  room.lastActivityMs = Date.now();
  return { room, building: res.building };
}

export function launchMissile(code, playerId, action) {
  const room = rooms.get(code);
  if (!room || !room.missileCommandState) return null;
  if (room.phase !== 'missile-command-play') return null;
  const res = missileLaunch(room.missileCommandState, playerId, action);
  if (res.error) return { room, error: res.error, membershipLost: res.membershipLost };
  room.lastActivityMs = Date.now();
  return { room, missiles: res.missiles };
}

export function launchMissileType(code, playerId, launcherType, targetGx, targetGy) {
  const room = rooms.get(code);
  if (!room || !room.missileCommandState) return null;
  if (room.phase !== 'missile-command-play') return null;
  const res = missileLaunchType(room.missileCommandState, playerId, launcherType, targetGx, targetGy);
  if (res.error) return { room, error: res.error, membershipLost: res.membershipLost };
  room.lastActivityMs = Date.now();
  return { room, missiles: res.missiles };
}

export function loadMissile(code, playerId, launcherId) {
  const room = rooms.get(code);
  if (!room || !room.missileCommandState) return null;
  if (room.phase !== 'missile-command-play') return null;
  const res = missileLoadMissile(room.missileCommandState, playerId, launcherId);
  if (res.error) return { room, error: res.error, membershipLost: res.membershipLost };
  room.lastActivityMs = Date.now();
  return { room, building: res.building };
}

export function setKeepFire(code, playerId, action) {
  const room = rooms.get(code);
  if (!room || !room.missileCommandState) return null;
  if (room.phase !== 'missile-command-play') return null;
  const res = missileSetKeepFire(room.missileCommandState, playerId, action);
  if (res.error) return { room, error: res.error, membershipLost: res.membershipLost };
  room.lastActivityMs = Date.now();
  return { room, keepFire: res.keepFire };
}

export function fireDesperation(code, playerId, action) {
  const room = rooms.get(code);
  if (!room || !room.missileCommandState) return null;
  if (room.phase !== 'missile-command-play') return null;
  const res = missileFireDesperation(room.missileCommandState, playerId, action);
  if (res.error) return { room, error: res.error, membershipLost: res.membershipLost };
  room.lastActivityMs = Date.now();
  return { room, missiles: res.missiles };
}

export function claimSupplyShip(code, playerId) {
  const room = rooms.get(code);
  if (!room || !room.missileCommandState) return null;
  if (room.phase !== 'missile-command-play') return null;
  const res = missileClaimShip(room.missileCommandState, playerId);
  if (res.error) return { room, error: res.error, membershipLost: res.membershipLost };
  room.lastActivityMs = Date.now();
  return { room, supply: res.supply };
}

export function tickMissileRoom(room, now = Date.now()) {
  if (!room?.missileCommandState) return null;
  if (room.phase !== 'missile-command-play') return null;
  const { events } = tickMissileCommand(room.missileCommandState, now);
  // Run AI opponent decisions (if any) on the same tick. The AI mutates the
  // state directly (builds, launches, rebuilds, claims) without any of the
  // action endpoints firing — normally the 6.7Hz full-state stream carried
  // those changes. Now the stream is slim, so detect AI-side mutations and
  // mark the room dirty when anything structural changed.
  const st = room.missileCommandState;
  const aiSig = mcMutSig(st);
  missileAiTick(st, now);
  if (events.length === 0 && aiSig !== mcMutSig(st)) {
    events.push({ type: 'ai-act' });
  }
  // NOTE: no lastActivityMs bump here — only real player actions keep a room
  // alive, so abandoned games expire via sweepInactiveRooms.
  if (st.winReason) {
    const winner = room.players.find(p => p.id === st.winnerId);
    if (winner) winner.score += 5;
    room.phase = 'missile-command-end';
  }
  return { room, events };
}

// Cheap structural signature of the AI-mutable parts of missile state:
// anything the AiTick can create/remove/claim. Passive drift (income, healing,
// missile movement) is excluded on purpose — the slim tick covers it.
function mcMutSig(state) {
  const st = state;
  const bKeys = Object.keys(st.buildings ?? {}).length;
  const pKeys = Object.keys(st.pending ?? {}).length;
  const rKeys = Object.keys(st.rubble ?? {}).length;
  const mCount = st.missiles?.length ?? 0;
  const ship = st.supplyShip ? 1 : 0;
  const lastSupply = st.lastSupply?.at ?? 0;
  const surge = Object.keys(st.buildSurge ?? {}).length;
  return `${bKeys}/${pKeys}/${rKeys}/${mCount}/${ship}/${lastSupply}/${surge}`;
}

// Remove a player immediately (Leave Room). Frees the seat and migrates host.
export function leaveRoom(code, playerId) {
  const room = rooms.get(code);
  if (!room) return { error: 'Room not found' };
  const idx = room.players.findIndex(p => p.id === playerId);
  if (idx === -1) return { error: 'Player not found' };
  room.players.splice(idx, 1);
  if (room.hostId === playerId) {
    const next = room.players.find(p => p.connected) || room.players[0];
    room.hostId = next ? next.id : null;
  }
  if (!room.hostId && room.players.length) room.hostId = room.players[0].id;
  for (const p of room.players) p.isHost = (p.id === room.hostId);
  if (room.chromaOptions?.playerDifficulties) delete room.chromaOptions.playerDifficulties[playerId];
  room.lastActivityMs = Date.now();
  if (room.players.length === 0) room.deleteAt = Date.now() + REJOIN_GRACE_MS;
  return { room, leftId: playerId };
}

// Free disconnected (ghost) seats whose grace period has expired. Returns a list
// of { code, removedIds, room } for any room that lost seats.
const GHOST_SEAT_GRACE_MS_VALUE = 60 * 1000;
export function freeExpiredGhostSeats(now = Date.now()) {
  const freed = [];
  for (const [code, room] of [...rooms.entries()]) {
    // Active Missile Command matches keep their participants for the whole
    // game: freeing a ghost seat mid-match drops a player's side binding and
    // turns a recoverable drop into a permanent "not in this match" zombie.
    if (room.phase === 'missile-command-play') continue;
    const expired = room.players.filter(p => !p.connected && (p.disconnectedAt ? (now - p.disconnectedAt >= GHOST_SEAT_GRACE_MS_VALUE) : false));
    if (expired.length === 0) continue;
    const removedIds = [];
    for (const p of expired) {
      const i = room.players.indexOf(p);
      if (i !== -1) room.players.splice(i, 1);
      removedIds.push(p.id);
      if (room.chromaOptions?.playerDifficulties) delete room.chromaOptions.playerDifficulties[p.id];
    }
    // Migrate host if its seat was freed.
    if (room.hostId && !room.players.some(p => p.id === room.hostId)) {
      const next = room.players.find(p => p.connected) || room.players[0];
      room.hostId = next ? next.id : null;
    }
    if (!room.hostId && room.players.length) room.hostId = room.players[0].id;
    for (const p of room.players) p.isHost = (p.id === room.hostId);
    room.lastActivityMs = Date.now();
    freed.push({ code, removedIds, room });
  }
  return freed;
}
// Aliases for compatibility with possible test/client naming.
export const sweepDisconnectedSeats = freeExpiredGhostSeats;
export const sweepGhostSeats = freeExpiredGhostSeats;
export const expireGhostSeats = freeExpiredGhostSeats;
export const pruneGhostSeats = freeExpiredGhostSeats;
export const freeExpiredSeats = freeExpiredGhostSeats;
export const releaseExpiredSeats = freeExpiredGhostSeats;

export function sweepInactiveRooms(now = Date.now()) {
  const occupantsBefore = new Map();
  for (const [code, room] of rooms) {
    occupantsBefore.set(code, room.players.map(p => ({ id: p.id, connected: p.connected })));
  }
  freeExpiredGhostSeats(now);
  const deleted = [];
  for (const [code, room] of rooms) {
    const occupants = occupantsBefore.get(code) || room.players.map(p => ({ id: p.id, connected: p.connected }));
    const allGone = room.players.every(p => !p.connected);
    const idle = now - (room.lastActivityMs || room.createdAt || now);
    if (idle > ROOM_TTL_MS) {
      rooms.delete(code);
      deleted.push({ code, occupants, reason: 'idle-timeout' });
      continue;
    }
    // Fully-abandoned rooms get a grace window (set when the last player
    // drops) so brief backgrounding doesn't nuke the game. Rooms without a
    // deleteAt predate this and fall back to immediate cleanup.
    if (allGone && (!room.deleteAt || now >= room.deleteAt)) {
      rooms.delete(code);
      deleted.push({ code, occupants, reason: 'abandoned' });
    }
  }
  return deleted;
}

export const SIGNAL_TIME_SEC = SIGNAL_TIME;
export const DISCUSS_TIME_SEC = DISCUSS_TIME;
export const GUESS_TIME_SEC = GUESS_TIME;
export const BLEND_WORD_SEC_VALUE = BLEND_WORD_SEC;
export const BLEND_VOTE_SEC_VALUE = BLEND_VOTE_SEC;
export const BLEND_GUESS_SEC_VALUE = BLEND_GUESS_SEC;
export const LIAR_BID_SEC_VALUE = LIAR_BID_SEC;
export { LIAR_BID_SEC };
export const LIAR_BID_MS = LIAR_BID_SEC * 1000;
export const BLUFF_BET_SEC_VALUE = BLUFF_BET_SEC;
export const CHROMA_RACE_MS_VALUE = CHROMA_RACE_MS;
export { TERRITORY_TURN_SEC };
export const TERRITORY_TURN_SEC_VALUE = TERRITORY_TURN_SEC;
export const TERRITORY_TURN_TIME = TERRITORY_TURN_SEC;
export const TERRITORY_TURN_MS = TERRITORY_TURN_SEC * 1000;
export const TOTAL_ROUNDS_COUNT = TOTAL_ROUNDS;
export const ROOM_TTL_MS_VALUE = ROOM_TTL_MS;
