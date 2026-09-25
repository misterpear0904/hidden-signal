// gameManager.js — In-memory game state management

import { assignRoles, calculateScores, generateRoomCode } from './gameLogic.js';

// rooms: Map<roomCode, RoomState>
const rooms = new Map();

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
  const allowed = ['hidden-signal', 'chroma-shift', 'territory-push'];
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
  const cols = shuffleInPlace([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
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
    for (const p of room.players) p.score = 0;
    return startChromaRound(room);
  }

  if (room.selectedGameId === 'territory-push') {
    if (room.players.length < 2 || room.players.length % 2 !== 0) return null;
    room.round = 1;
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

  if (room.players.length < 4) return null;
  room.round = 1;
  return startRound(room);
}

const CHROMA_RACE_MS = 10 * 1000;

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
    const blueDepth = 0 - minBluePen - 1;
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

export function playerDisconnected(playerId) {
  for (const room of rooms.values()) {
    const player = room.players.find(p => p.id === playerId);
    if (player) {
      player.connected = false;
      room.lastActivityMs = Date.now();
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
export const CHROMA_RACE_MS_VALUE = CHROMA_RACE_MS;
export const TOTAL_ROUNDS_COUNT = TOTAL_ROUNDS;
export const ROOM_TTL_MS_VALUE = ROOM_TTL_MS;
