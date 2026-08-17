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
  ['#2e1065', '#4c1d95'], // Subtle Deep Purple
  ['#022c22', '#0f766e'], // Subtle Deep Teal
  ['#3f1d0b', '#92400e'], // Subtle Deep Warm Gold
  ['#3b0764', '#6b21a8'], // Subtle Deep Violet
  ['#0f172a', '#1e293b'], // Subtle Deep Slate
];

export function createRoom(hostId, hostName) {
  let code;
  do { code = generateRoomCode(); } while (rooms.has(code));

  const room = {
    code,
    selectedGameId: 'hidden-signal',
    chromaOptions: { difficulty: 'easy', playerDifficulties: {}, fairPoints: true, extremeMode: false },
    territoryOptions: { extremeMode: false },
    chromaState: null,
    territoryState: null,
    phase: 'lobby',          // lobby | role-reveal | signal | discuss | guess | reveal | end | chroma-play | chroma-reveal | territory-turn | territory-reveal
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

export function updateTerritoryOptions(code, options) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'lobby') return null;
  room.territoryOptions = { ...room.territoryOptions, ...options };
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

export function startGame(code) {
  const room = rooms.get(code);
  if (!room) return null;

  if (room.selectedGameId === 'chroma-shift') {
    if (room.players.length < 2) return null;
    room.round = 1;
    for (const p of room.players) p.score = 0;
    return startChromaRound(room);
  }

  if (room.selectedGameId === 'territory-push') {
    if (room.players.length < 2 || room.players.length % 2 !== 0) return null;
    room.round = 1;
    for (const p of room.players) p.score = 0;
    
    // Shuffle players randomly into two teams
    const shuffled = [...room.players.map(p => p.id)].sort(() => Math.random() - 0.5);
    const half = Math.floor(shuffled.length / 2);
    
    const isExtreme = room.territoryOptions?.extremeMode === true;
    const boardHeight = isExtreme ? 20 : 10;
    const initialFrontier = isExtreme ? 9 : 4; // 0..9 Red, 10..19 Blue in 20-row grid; 0..4 Red, 5..9 Blue in 10-row grid
    
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
      board: Array(10).fill(initialFrontier),
      extremeMode: isExtreme,
      boardHeight,
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

  if (room.players.length < 4) return null;
  room.round = 1;
  return startRound(room);
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
    const playerDiff = room.chromaOptions.playerDifficulties?.[playerId] || 'easy';
    if (room.chromaOptions.fairPoints) {
      if (playerDiff === 'medium') points = 2;
      else if (playerDiff === 'hard') points = 3;
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
    const elapsed = Math.max(0, now - playerEnergy.lastChargeMs);
    const earned = Math.floor(elapsed / 5000);
    const currentShots = Math.min(3, playerEnergy.shots + earned);
    const remainderMs = elapsed % 5000;

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

    // Apply push: Red pushes towards row 19 (+1), Blue pushes towards row 0 (-1)
    const oldFrontier = room.territoryState.board[colIndex];
    let newFrontier = oldFrontier;
    if (isRed) {
      newFrontier = Math.min(19, oldFrontier + 1);
    } else {
      newFrontier = Math.max(-1, oldFrontier - 1);
    }
    room.territoryState.board[colIndex] = newFrontier;

    const player = room.players.find(p => p.id === playerId);
    const shotEvent = {
      id: Math.random().toString(36).substring(2, 9),
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

    // Check victory condition (Red reaches row 19, Blue reaches row -1)
    const redWins = room.territoryState.board.some(f => f >= 19);
    const blueWins = room.territoryState.board.some(f => f <= -1);

    if (redWins || blueWins) {
      const winner = redWins ? 'red' : 'blue';
      room.territoryState.winnerTeam = winner;
      for (const p of room.players) {
        if (room.territoryState.teams[winner].includes(p.id)) p.score += 5;
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

  const playerMap = new Map(room.players.map(p => [p.id, p.name]));

  // Resolve column by column
  for (let c = 0; c < 10; c++) {
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
        const effectiveBlue = M + 2; // +2 defender bonus
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
        const effectiveRed = N + 2; // +2 defender bonus
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

  // Save to turn history
  if (!room.territoryState.turnHistory) {
    room.territoryState.turnHistory = [];
  }
  room.territoryState.turnHistory.push({
    turn: room.territoryState.turn,
    resolutions,
  });
  room.territoryState.lastResolutions = resolutions;

  // Check victory condition
  let redWins = board.some(f => f >= 9);
  let blueWins = board.some(f => f <= -1);

  if (redWins && !blueWins) {
    room.territoryState.winnerTeam = 'red';
    for (const p of room.players) {
      if (teams.red.includes(p.id)) p.score += 5;
    }
    room.phase = 'end';
  } else if (blueWins && !redWins) {
    room.territoryState.winnerTeam = 'blue';
    for (const p of room.players) {
      if (teams.blue.includes(p.id)) p.score += 5;
    }
    room.phase = 'end';
  } else if (redWins && blueWins) {
    const maxRedPen = Math.max(...board);
    const minBluePen = Math.min(...board);
    if (maxRedPen >= 9 && minBluePen <= -1) {
      room.territoryState.winnerTeam = 'red'; // tie break
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

  if (room.territoryState.winnerTeam) {
    room.phase = 'end';
    return room;
  }

  room.territoryState.submittedPicks = {};
  room.territoryState.turn += 1;
  room.phase = 'territory-turn';
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
