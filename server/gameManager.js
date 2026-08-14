// gameManager.js — In-memory game state management

import { assignRoles, calculateScores, generateRoomCode } from './gameLogic.js';

// rooms: Map<roomCode, RoomState>
const rooms = new Map();

const TOTAL_ROUNDS = 5;
const SIGNAL_TIME = 60;    // seconds
const DISCUSS_TIME = 60;   // seconds
const GUESS_TIME = 45;     // seconds

const BASE_GRADIENT_PALETTES = [
  ['#1e1b4b', '#312e81'], // Indigo
  ['#064e3b', '#047857'], // Emerald
  ['#451a03', '#78350f'], // Amber
  ['#4c0519', '#881337'], // Rose
  ['#172554', '#1e40af'], // Blue
];

const TARGET_GRADIENT_PALETTES = [
  ['#ec4899', '#f59e0b'], // Pink to Amber
  ['#22d3ee', '#3b82f6'], // Cyan to Blue
  ['#a855f7', '#ec4899'], // Purple to Pink
  ['#10b981', '#06b6d4'], // Emerald to Cyan
  ['#f97316', '#e11d48'], // Orange to Rose
];

export function createRoom(hostId, hostName) {
  let code;
  do { code = generateRoomCode(); } while (rooms.has(code));

  const room = {
    code,
    selectedGameId: 'hidden-signal',
    chromaOptions: { difficulty: 'easy', fairPoints: true },
    chromaState: null,
    phase: 'lobby',          // lobby | role-reveal | signal | discuss | guess | reveal | end | chroma-play | chroma-reveal
    round: 0,
    players: [{ id: hostId, name: hostName, score: 0, isHost: true, connected: true }],
    roles: [],
    hiddenPairIds: [],
    secretCode: null,
    signals: [],             // { playerId, signal }
    guesses: [],             // { playerId, guessedPartnerId?, guessedPairIds? }
    timer: null,
    timerEnd: null,
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

export function selectGame(code, gameId) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'lobby') return null;
  room.selectedGameId = gameId;
  return room;
}

export function updateChromaOptions(code, options) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'lobby') return null;
  room.chromaOptions = { ...room.chromaOptions, ...options };
  return room;
}

export function startGame(code) {
  const room = rooms.get(code);
  if (!room) return null;

  if (room.selectedGameId === 'chroma-shift') {
    if (room.players.length < 2) return null;
    room.round = 1;
    for (const p of room.players) p.score = 0;
    return startChromaRound(room);
  }

  if (room.players.length < 4) return null;
  room.round = 1;
  return startRound(room);
}

function startChromaRound(room) {
  const targetTileIndex = Math.floor(Math.random() * 25);
  const baseIndex = (room.round - 1) % BASE_GRADIENT_PALETTES.length;
  const targetIndex = (room.round * 2 + 1) % TARGET_GRADIENT_PALETTES.length;

  room.chromaState = {
    targetTileIndex,
    baseGradient: BASE_GRADIENT_PALETTES[baseIndex],
    targetGradient: TARGET_GRADIENT_PALETTES[targetIndex],
    roundWinnerId: null,
    roundWinnerName: null,
    pointsAwarded: 0,
    seed: Date.now() + Math.random(),
  };

  room.phase = 'chroma-play';
  return room;
}

export function submitChromaGuess(code, playerId, tileIndex) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'chroma-play' || !room.chromaState) return null;

  const player = room.players.find(p => p.id === playerId);
  if (!player) return null;

  if (tileIndex === room.chromaState.targetTileIndex) {
    // Correct!
    let points = 1;
    if (room.chromaOptions.fairPoints) {
      if (room.chromaOptions.difficulty === 'medium') points = 2;
      else if (room.chromaOptions.difficulty === 'hard') points = 3;
    }
    player.score += points;
    room.chromaState.roundWinnerId = playerId;
    room.chromaState.roundWinnerName = player.name;
    room.chromaState.pointsAwarded = points;
    room.phase = 'chroma-reveal';

    return { room, correct: true, pointsAwarded: points, winnerId: playerId };
  } else {
    // Wrong guess penalty: lose 1 point
    player.score -= 1;
    return { room, correct: false, penaltyPlayerId: playerId, currentScore: player.score };
  }
}

export function nextChromaRound(code) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'chroma-reveal') return null;

  if (room.round >= TOTAL_ROUNDS) {
    room.phase = 'end';
    return room;
  }

  room.round += 1;
  return startChromaRound(room);
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

  room.signals.push({ playerId, signal: signal.trim().substring(0, 80) });
  return room;
}

export function submitGuess(code, playerId, guessData) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'guess') return null;
  if (room.guesses.find(g => g.playerId === playerId)) return null;

  room.guesses.push({ playerId, ...guessData });
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

  if (room.round >= TOTAL_ROUNDS) {
    room.phase = 'end';
    return room;
  }

  room.round += 1;
  return startRound(room);
}

export function playerDisconnected(playerId) {
  for (const room of rooms.values()) {
    const player = room.players.find(p => p.id === playerId);
    if (player) {
      player.connected = false;
      return room;
    }
  }
  return null;
}

export function playerReconnected(playerId, newSocketId) {
  for (const room of rooms.values()) {
    const player = room.players.find(p => p.id === playerId);
    if (player) {
      player.id = newSocketId;
      player.connected = true;
      return room;
    }
  }
  return null;
}

export function deleteRoom(code) {
  rooms.delete(code);
}

export const SIGNAL_TIME_SEC = SIGNAL_TIME;
export const DISCUSS_TIME_SEC = DISCUSS_TIME;
export const GUESS_TIME_SEC = GUESS_TIME;
export const TOTAL_ROUNDS_COUNT = TOTAL_ROUNDS;
