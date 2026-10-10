// index.js — Express + Socket.io server for Hidden Signal

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { logger } from './logger.js';

// Helper: get room or emit room-expired and return null
function getRoomOrExpire(socket, roomCode) {
  const room = getRoom(roomCode);
  if (!room) {
    socket.emit('room-expired', { roomCode, reason: 'Room no longer exists (server restart or expired)' });
    return null;
  }
  return room;
}

import {
  createRoom,
  joinRoom,
  getRoom,
  startGame,
  selectGame,
  kickPlayer,
  updateChromaOptions,
  updateTerritoryOptions,
  updateLiarOptions,
  updateMissileCommandOptions,
  buildMissileBuilding,
  upgradeMissileBuilding,
  loadMissile,
  toggleAutobuild,
  launchMissile,
  launchMissileType,
  setKeepFire,
  tickMissileRoom,
  setPlayerDifficulty,
  submitChromaGuess,
  resolveChromaRace,
  nextChromaRound,
  submitBlendClue,
  blendAllCluesIn,
  advanceToBlendVote,
  submitBlendVote,
  blendAllVotesIn,
  resolveBlendVotes,
  submitBlendGuess,
  expireBlendGuess,
  nextBlendRound,
  submitLiarBid,
  resolveLiarCall,
  expireLiarBid,
  nextLiarRound,
  submitBluffAction,
  expireBluffBet,
  nextBluffRound,
  BLUFF_MAX_RAISES,
  submitTerritoryPick,
  placeTerritoryMine,
  nextTerritoryTurn,
  getTeamBonusCounts,
  getTeamRechargeIntervalMs,
  advanceToSignal,
  advanceToDiscuss,
  advanceToGuess,
  submitSignal,
  submitGuess,
  resolveRound,
  advanceRound,
  playerDisconnected,
  deleteRoom,
  sweepInactiveRooms,
  isHost,
  startEndVote,
  submitEndVote,
  cancelEndVote,
  resetToLobby,
  rooms,
  SIGNAL_TIME_SEC,
  DISCUSS_TIME_SEC,
  GUESS_TIME_SEC,
  CHROMA_RACE_MS_VALUE,
  BLEND_WORD_SEC_VALUE,
  BLEND_VOTE_SEC_VALUE,
  BLEND_GUESS_SEC_VALUE,
  LIAR_BID_SEC_VALUE,
  BLUFF_BET_SEC_VALUE,
} from './gameManager.js';

// CORS: production requires CLIENT_ORIGIN to be set to your frontend URL
// (e.g., https://hidden-signal-client.onrender.com).
// If not set in production, we allow all origins temporarily with a warning
// so the service can start even if env var is missing, but logs a clear warning.
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || (process.env.NODE_ENV === 'production' ? '*' : '*');
if (process.env.NODE_ENV === 'production' && !process.env.CLIENT_ORIGIN) {
  logger.warn('CLIENT_ORIGIN not set in production — allowing all origins temporarily. Set CLIENT_ORIGIN=https://hidden-signal-client.onrender.com in Render dashboard for security.');
}

logger.info('Server starting', { corsOrigin: CLIENT_ORIGIN, nodeEnv: process.env.NODE_ENV });

// Rate limiting configuration - much higher limit for initial connections
// Socket.io does ~10-20 requests during initial handshake + polling
const MAX_ROOMS = 500;
const MAX_EVENTS_PER_SECOND = 200;  // Much higher for socket.io handshake
const EVENT_WINDOW_MS = 1000;
const eventCounts = new Map();

function checkRateLimit(socketId) {
  const now = Date.now();
  const record = eventCounts.get(socketId);
  if (!record || now - record.windowStart > EVENT_WINDOW_MS) {
    eventCounts.set(socketId, { count: 1, windowStart: now });
    return true;
  }
  if (record.count >= MAX_EVENTS_PER_SECOND) {
    return false;
  }
  record.count++;
  return true;
}

// Periodic cleanup of rate limit records
setInterval(() => {
  const now = Date.now();
  for (const [socketId, record] of eventCounts) {
    if (now - record.windowStart > EVENT_WINDOW_MS * 2) {
      eventCounts.delete(socketId);
    }
  }
}, 60 * 1000);

// Health check endpoint for Render to keep service awake
// Render's free tier spins down after 15 min inactivity
// Ping this endpoint every 10 min via cron job (e.g., cron-job.org, uptimerobot)
const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

app.get('/health', (req, res) => {
  logger.health.check('ok', { rooms: rooms.size, timestamp: Date.now() });
  res.json({ status: 'ok', timestamp: Date.now(), rooms: rooms.size });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ['GET', 'POST'],
  },
  // Mobile-friendly: longer ping timeout to survive background tabs
  pingTimeout: 60000,    // 60s before considering client dead (default 5s)
  pingInterval: 25000,   // ping every 25s (default 25s)
  // Allow reconnection with longer delays for mobile network changes
  maxHttpBufferSize: 1e8,
});

const PORT = process.env.PORT || 3001;

// Timers per room: Map<roomCode, timeoutId>
const roomTimers = new Map();

function clearRoomTimer(code) {
  if (roomTimers.has(code)) {
    clearTimeout(roomTimers.get(code));
    roomTimers.delete(code);
  }
}

function setRoomTimer(code, ms, cb) {
  clearRoomTimer(code);
  const id = setTimeout(cb, ms);
  roomTimers.set(code, id);
}

// Periodic sweep of abandoned rooms (every 10 min)
setInterval(() => {
  try {
    const before = rooms.size;
    const beforeCodes = Array.from(rooms.keys());
    sweepInactiveRooms(Date.now());
    const after = rooms.size;
    if (before !== after) {
      const removedCodes = beforeCodes.filter(c => !rooms.has(c));
      logger.info('room_sweep_completed', { removed: before - after, remaining: after, removedCodes });
    }
  } catch (e) {
    logger.error('room_sweep_failed', { error: e?.message ?? e });
  }
}, 10 * 60 * 1000);

// Sanitize room data for broadcast (strip secrets by player)
function roomPublicState(room, forPlayerId = null) {
  let publicTerritoryState = null;
  if (room.territoryState) {
    const now = Date.now();
    let computedEnergy = undefined;
    if (room.territoryState.extremeMode && room.territoryState.energy) {
      const bonusCounts = getTeamBonusCounts(room.territoryState.board, room.territoryState.bonusSquares || []);
      computedEnergy = {};
      for (const [pid, en] of Object.entries(room.territoryState.energy)) {
        const isRed = room.territoryState.teams.red.includes(pid);
        const teamBonusCount = isRed ? bonusCounts.red : bonusCounts.blue;
        const chargeIntervalMs = getTeamRechargeIntervalMs(teamBonusCount);

        const elapsed = Math.max(0, now - en.lastChargeMs);
        const earned = Math.floor(elapsed / chargeIntervalMs);
        const shots = Math.min(3, en.shots + earned);
        const remainderMs = elapsed % chargeIntervalMs;
        computedEnergy[pid] = {
          shots,
          lastChargeMs: en.lastChargeMs,
          chargeIntervalMs,
          nextChargeTime: shots >= 3 ? null : (now + (chargeIntervalMs - remainderMs)),
        };
      }
    }

    // Filter mine visibility: during game, players only see their own team's mines (traps are secret!)
    let visibleMines = room.territoryState.mines || {};
    if (forPlayerId && room.phase !== 'end') {
      const isRed = room.territoryState.teams.red.includes(forPlayerId);
      const isBlue = room.territoryState.teams.blue.includes(forPlayerId);
      const myTeam = isRed ? 'red' : isBlue ? 'blue' : null;
      visibleMines = {};
      if (myTeam && room.territoryState.mines) {
        for (const [pid, mine] of Object.entries(room.territoryState.mines)) {
          if (mine.team === myTeam) {
            visibleMines[pid] = mine;
          }
        }
      }
    }

    if (!room.territoryState.extremeMode && room.phase === 'territory-turn') {
      const maskedPicks = {};
      for (const [pid, _col] of Object.entries(room.territoryState.submittedPicks)) {
        maskedPicks[pid] = true;
      }
      publicTerritoryState = {
        ...room.territoryState,
        mines: visibleMines,
        submittedPicks: maskedPicks,
      };
    } else {
      publicTerritoryState = {
        ...room.territoryState,
        mines: visibleMines,
        energy: computedEnergy || room.territoryState.energy,
      };
    }
  }

  // Blend In masking: chameleon identity + secret word stay hidden until reveal.
  // The chameleon only ever sees the category; innocents see the secret word.
  let publicBlendState = null;
  if (room.blendState) {
    const b = room.blendState;
    const isReveal = room.phase === 'blend-reveal' || room.phase === 'end';
    const amChameleon = forPlayerId ? b.chameleonId === forPlayerId : false;
    const votesPublic = room.phase === 'blend-guess' || isReveal;
    publicBlendState = {
      category: b.category,
      secretWord: isReveal || !amChameleon ? b.secretWord : null,
      amChameleon: forPlayerId ? amChameleon : false,
      chameleonId: isReveal ? b.chameleonId : null,
      chameleonName: null,
      clues: room.phase === 'blend-word'
        ? b.clues.map(c => ({ playerId: c.playerId }))
        : b.clues.map(c => ({ playerId: c.playerId, word: c.word })),
      clueCount: b.clues.length,
      votes: isReveal ? b.votes : [],
      voteCount: b.votes.length,
      accusedId: votesPublic ? b.accusedId : null,
      caught: votesPublic ? b.caught : null,
      chameleonGuess: isReveal ? b.chameleonGuess : null,
      stealSuccess: isReveal ? b.stealSuccess : null,
      points: isReveal ? { ...b.points } : {},
    };
    if (isReveal) {
      const chameleon = room.players.find(p => p.id === b.chameleonId);
      publicBlendState.chameleonName = chameleon ? chameleon.name : '???';
    }
  }

  // Liar's Dice masking: each duelist sees only their own dice until reveal.
  let publicLiarState = null;
  if (room.liarState) {
    const L = room.liarState;
    const liarReveal = room.phase === 'liar-reveal' || room.phase === 'end';
    const myDice = forPlayerId && L.dice[forPlayerId] ? [...L.dice[forPlayerId]] : [];
    const dice = {};
    if (liarReveal) {
      for (const [pid, hand] of Object.entries(L.dice)) dice[pid] = [...hand];
    } else if (forPlayerId) {
      dice[forPlayerId] = myDice;
    }
    publicLiarState = {
      dice,
      diceEach: L.diceEach,
      bids: L.bids.map(x => ({ ...x })),
      toActId: L.toActId,
      starterId: L.starterId,
      winnerId: liarReveal ? L.winnerId : null,
      winnerName: liarReveal ? L.winnerName : null,
      loserId: liarReveal ? L.loserId : null,
      reason: liarReveal ? L.reason : null,
      challengedBid: liarReveal ? L.challengedBid : null,
      actualCount: liarReveal ? L.actualCount : null,
      points: liarReveal ? { ...L.points } : {},
    };
  }

  // Bluff Card masking: each duelist sees only their own card until reveal.
  let publicBluffState = null;
  if (room.bluffState) {
    const B = room.bluffState;
    const bluffReveal = room.phase === 'bluff-reveal' || room.phase === 'end';
    const cards = {};
    if (bluffReveal) {
      for (const [pid, card] of Object.entries(B.cards)) cards[pid] = card;
    } else if (forPlayerId && B.cards[forPlayerId]) {
      cards[forPlayerId] = B.cards[forPlayerId];
    }
    publicBluffState = {
      cards,
      firstId: B.firstId,
      history: B.history.map(h => ({ ...h })),
      toActId: B.toActId,
      facingBet: (B.history[B.history.length - 1]?.action === 'bet' || B.history[B.history.length - 1]?.action === 'raise'),
      betCount: B.betCount || 0,
      maxRaises: BLUFF_MAX_RAISES,
      winnerId: bluffReveal ? B.winnerId : null,
      winnerName: bluffReveal ? B.winnerName : null,
      loserId: bluffReveal ? B.loserId : null,
      reason: bluffReveal ? B.reason : null,
      bluffWin: bluffReveal ? B.bluffWin : false,
      showdownCards: bluffReveal ? B.showdownCards : null,
      points: bluffReveal ? { ...B.points } : {},
    };
  }

  return {
    code: room.code,
    selectedGameId: room.selectedGameId || 'hidden-signal',
    chromaOptions: room.chromaOptions || { difficulty: 'easy', fairPoints: true, extremeMode: false },
    territoryOptions: room.territoryOptions || { extremeMode: false },
    liarOptions: room.liarOptions || { extremeMode: false },
    missileCommandOptions: room.missileCommandOptions || { startingResources: 200, economyTickMs: 500, maxLevel: 5 },
    missileCommandState: room.missileCommandState || null,
    chromaState: room.chromaState || null,
    territoryState: publicTerritoryState,
    blendState: publicBlendState,
    liarState: publicLiarState,
    bluffState: publicBluffState,
    endVote: room.endVote
      ? {
          initiatorId: room.endVote.initiatorId,
          initiatorName: room.endVote.initiatorName,
          yesIds: [...room.endVote.yesIds],
          startedAt: room.endVote.startedAt,
        }
      : null,
    phase: room.phase,
    round: room.round,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      isHost: p.isHost,
      connected: p.connected,
    })),
    signals: room.phase === 'discuss' || room.phase === 'guess' || room.phase === 'reveal' || room.phase === 'end'
      ? room.signals
      : room.signals.map(s => ({ playerId: s.playerId, submitted: true })), // hide text during signal phase
    guesses: room.phase === 'reveal' || room.phase === 'end' ? room.guesses : [],
    hiddenPairIds: room.phase === 'reveal' || room.phase === 'end' ? room.hiddenPairIds : [],
    secretCode: room.phase === 'reveal' || room.phase === 'end' ? room.secretCode : null,
    timerEnd: room.timerEnd,
    submittedSignalCount: room.signals.length,
    submittedGuessCount: room.guesses.length,
    totalPlayers: room.players.length,
  };
}

// Send a player their private role data
function sendPrivateRole(socket, room) {
  const roleData = room.roles.find(r => r.playerId === socket.id);
  if (roleData) {
    socket.emit('your-role', roleData);
  }
}

function broadcastRoomState(room) {
  for (const player of room.players) {
    const playerSocket = io.sockets.sockets.get(player.id);
    if (playerSocket) {
      playerSocket.emit('room-state', roomPublicState(room, player.id));
    }
  }
}

function startSignalPhase(code) {
  const room = advanceToSignal(code);
  if (!room) return;
  room.lastActivityMs = Date.now();
  broadcastRoomState(room);
  // Auto-advance signal -> discuss -> guess on timeout
  setRoomTimer(code, SIGNAL_TIME_SEC * 1000, () => {
    try {
      const r1 = advanceToDiscuss(code);
      if (!r1) return;
      broadcastRoomState(r1);
      setRoomTimer(code, DISCUSS_TIME_SEC * 1000, () => {
        try {
          const r2 = advanceToGuess(code);
          if (!r2) return;
          broadcastRoomState(r2);
          setRoomTimer(code, GUESS_TIME_SEC * 1000, () => {
            try {
              autoResolveRound(code);
            } catch (e) {
              console.error('[timer] autoResolveRound failed', e);
            }
          });
        } catch (e) {
          console.error('[timer] advanceToGuess failed', e);
        }
      });
    } catch (e) {
      console.error('[timer] advanceToDiscuss failed', e);
    }
  });
}

function startDiscussPhase(code) {
  const room = advanceToDiscuss(code);
  if (!room) return;
  broadcastRoomState(room);
  setRoomTimer(code, DISCUSS_TIME_SEC * 1000, () => {
    try {
      const r2 = advanceToGuess(code);
      if (!r2) return;
      broadcastRoomState(r2);
      setRoomTimer(code, GUESS_TIME_SEC * 1000, () => {
        try {
          autoResolveRound(code);
        } catch (e) {
          console.error('[timer] autoResolveRound failed', e);
        }
      });
    } catch (e) {
      console.error('[timer] advanceToGuess failed', e);
    }
  });
}

function checkAllSubmitted(room, type) {
  if (!room) return;
  if (type === 'signal') {
    const connected = room.players.filter(p => p.connected);
    if (room.signals.length >= connected.length && connected.length > 0) {
      clearRoomTimer(room.code);
      startDiscussPhase(room.code);
    }
  } else if (type === 'guess') {
    const connected = room.players.filter(p => p.connected);
    if (room.guesses.length >= connected.length && connected.length > 0) {
      clearRoomTimer(room.code);
      autoResolveRound(room.code);
    }
  }
}

function autoResolveChromaRace(code) {
  const room = resolveChromaRace(code);
  if (!room) return;
  broadcastRoomState(room);
}

function startBlendWordPhase(code) {
  const room = getRoom(code);
  if (!room || room.phase !== 'blend-word') return;
  broadcastRoomState(room);
  setRoomTimer(code, BLEND_WORD_SEC_VALUE * 1000, () => {
    try {
      const r1 = advanceToBlendVote(code);
      if (!r1) return;
      broadcastRoomState(r1);
      setRoomTimer(code, BLEND_VOTE_SEC_VALUE * 1000, () => {
        try {
          autoResolveBlendVotes(code);
        } catch (e) {
          console.error('[timer] autoResolveBlendVotes failed', e);
        }
      });
    } catch (e) {
      console.error('[timer] advanceToBlendVote failed', e);
    }
  });
}

function autoResolveBlendVotes(code) {
  const room = resolveBlendVotes(code);
  if (!room) return;
  broadcastRoomState(room);
  if (room.phase === 'blend-guess') {
    setRoomTimer(code, BLEND_GUESS_SEC_VALUE * 1000, () => {
      try {
        const r = expireBlendGuess(code);
        if (r) broadcastRoomState(r);
      } catch (e) {
        console.error('[timer] expireBlendGuess failed', e);
      }
    });
  }
}

function startLiarBidPhase(code) {
  const room = getRoom(code);
  if (!room || room.phase !== 'liar-bid') return;
  broadcastRoomState(room);
  setRoomTimer(code, LIAR_BID_SEC_VALUE * 1000, () => {
    try {
      const r = expireLiarBid(code);
      if (r) broadcastRoomState(r);
    } catch (e) {
      console.error('[timer] expireLiarBid failed', e);
    }
  });
}

function startBluffBetPhase(code) {
  const room = getRoom(code);
  if (!room || room.phase !== 'bluff-bet') return;
  broadcastRoomState(room);
  setRoomTimer(code, BLUFF_BET_SEC_VALUE * 1000, () => {
    try {
      const r = expireBluffBet(code);
      if (r) broadcastRoomState(r);
    } catch (e) {
      console.error('[timer] expireBluffBet failed', e);
    }
  });
}

function autoResolveRound(code) {
  const result = resolveRound(code);
  if (!result) return;
  const { room, scoreDeltas } = result;

  const deltas = {};
  for (const [pid, pts] of scoreDeltas) {
    deltas[pid] = pts;
  }

  io.to(code).emit('round-reveal', {
    hiddenPairIds: room.hiddenPairIds,
    secretCode: room.secretCode,
    roles: room.roles,
    signals: room.signals,
    guesses: room.guesses,
    scoreDeltas: deltas,
    players: room.players,
  });
  broadcastRoomState(room);
}

// ─── Socket Events ──────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  logger.socket.connect(socket.id, { transport: socket.conn.transport.name });

  socket.on('create-room', ({ playerName } = {}) => {
    if (!checkRateLimit(socket.id)) {
      logger.health.rateLimit(socket.id);
      return socket.emit('error', 'Too many requests');
    }
    if (rooms.size >= MAX_ROOMS) return socket.emit('error', 'Server at capacity, try again later');
    if (!playerName?.trim()) return socket.emit('error', 'Name required');
    const room = createRoom(socket.id, playerName.trim().substring(0, 20));
    logger.info('room_created', { roomCode: room.code, hostId: socket.id, playerName: playerName.trim().substring(0, 20), roomsCount: rooms.size });
    logger.room.create(room.code, socket.id, { playerName: playerName.trim().substring(0, 20) });
    socket.join(room.code);
    socket.emit('room-joined', { roomCode: room.code, playerId: socket.id });
    broadcastRoomState(room);
  });

  socket.on('join-room', ({ roomCode, playerName } = {}) => {
    if (!checkRateLimit(socket.id)) {
      logger.health.rateLimit(socket.id);
      return socket.emit('error', 'Too many requests');
    }
    if (!playerName?.trim() || !roomCode?.trim()) return socket.emit('error', 'Name and code required');
    const code = roomCode.trim().toUpperCase();
    logger.info('join_room_attempt', { code, playerName: playerName.trim().substring(0, 20), socketId: socket.id, roomsCount: rooms.size });
    const result = joinRoom(code, socket.id, playerName.trim().substring(0, 20));
    if (result.error) {
      logger.warn('join_room_failed', { code, error: result.error, roomsCount: rooms.size, existingRooms: Array.from(rooms.keys()) });
      return socket.emit('error', result.error);
    }

    logger.room.join(code, socket.id, { playerName: playerName.trim().substring(0, 20) });
    socket.join(code);
    socket.emit('room-joined', { roomCode: code, playerId: socket.id });
    broadcastRoomState(result.room);
  });

  socket.on('kick-player', ({ roomCode, targetId } = {}) => {
    if (!roomCode || !targetId) return socket.emit('error', 'Room and player required');
    const result = kickPlayer(roomCode, socket.id, targetId);
    if (result.error) return socket.emit('error', result.error);
    const kickedSocket = io.sockets.sockets.get(targetId);
    if (kickedSocket) {
      kickedSocket.leave(roomCode);
      kickedSocket.emit('kicked', { roomCode });
    }
    broadcastRoomState(result.room);
  });

  socket.on('select-game', ({ roomCode, gameId } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    const room = getRoom(roomCode);
    if (!room || !isHost(room, socket.id)) return socket.emit('error', 'Only host can change game');
    const updated = selectGame(roomCode, gameId);
    if (updated) broadcastRoomState(updated);
  });

  socket.on('update-chroma-options', ({ roomCode, options } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    const room = getRoom(roomCode);
    if (!room || !isHost(room, socket.id)) return socket.emit('error', 'Only host can change options');
    const updated = updateChromaOptions(roomCode, options);
    if (updated) broadcastRoomState(updated);
  });

  socket.on('update-territory-options', ({ roomCode, options } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    const room = getRoom(roomCode);
    if (!room || !isHost(room, socket.id)) return socket.emit('error', 'Only host can change options');
    const updated = updateTerritoryOptions(roomCode, options);
    if (updated) broadcastRoomState(updated);
  });

  socket.on('update-liar-options', ({ roomCode, options } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    const room = getRoom(roomCode);
    if (!room || !isHost(room, socket.id)) return socket.emit('error', 'Only host can change options');
    const updated = updateLiarOptions(roomCode, options);
    if (updated) broadcastRoomState(updated);
  });

  socket.on('update-missile-command-options', ({ roomCode, options } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    const room = getRoom(roomCode);
    if (!room || !isHost(room, socket.id)) return socket.emit('error', 'Only host can change options');
    const updated = updateMissileCommandOptions(roomCode, options);
    if (updated) broadcastRoomState(updated);
  });

  socket.on('build-missile-building', ({ roomCode, action } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    const room = getRoomOrExpire(socket, roomCode);
    if (!room) return;
    const result = buildMissileBuilding(roomCode, socket.id, action);
    if (!result) return socket.emit('error', 'Cannot build now');
    if (result.error) return socket.emit('error', result.error);
    broadcastRoomState(result.room);
  });

  socket.on('upgrade-missile-building', ({ roomCode, action } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    const room = getRoomOrExpire(socket, roomCode);
    if (!room) return;
    const buildingId = typeof action === 'string' ? action : action?.buildingId;
    const result = upgradeMissileBuilding(roomCode, socket.id, buildingId);
    if (!result) return socket.emit('error', 'Cannot upgrade now');
    if (result.error) return socket.emit('error', result.error);
    broadcastRoomState(result.room);
  });

  socket.on('launch-missile', ({ roomCode, action } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    const room = getRoomOrExpire(socket, roomCode);
    if (!room) return;
    const result = launchMissile(roomCode, socket.id, action);
    if (!result) return socket.emit('error', 'Cannot launch now');
    if (result.error) return socket.emit('error', result.error);
    broadcastRoomState(result.room);
  });

  socket.on('load-missile', ({ roomCode, launcherId } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    const room = getRoomOrExpire(socket, roomCode);
    if (!room) return;
    const id = typeof launcherId === 'string' ? launcherId : launcherId?.launcherId;
    const result = loadMissile(roomCode, socket.id, id);
    if (!result) return socket.emit('error', 'Cannot load now');
    if (result.error) return socket.emit('error', result.error);
    broadcastRoomState(result.room);
  });

  socket.on('toggle-autobuild', ({ roomCode, launcherId } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    const room = getRoomOrExpire(socket, roomCode);
    if (!room) return;
    const id = typeof launcherId === 'string' ? launcherId : launcherId?.launcherId;
    const result = toggleAutobuild(roomCode, socket.id, id);
    if (!result) return socket.emit('error', 'Cannot toggle now');
    if (result.error) return socket.emit('error', result.error);
    broadcastRoomState(result.room);
  });

  socket.on('launch-missile-type', ({ roomCode, launcherType, targetGx, targetGy } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    const room = getRoomOrExpire(socket, roomCode);
    if (!room) return;
    const gx = typeof targetGx === 'number' ? targetGx : targetGx?.gx;
    const gy = typeof targetGy === 'number' ? targetGy : targetGy?.gy;
    const result = launchMissileType(roomCode, socket.id, launcherType, gx, gy);
    if (!result) return socket.emit('error', 'Cannot launch now');
    if (result.error) return socket.emit('error', result.error);
    broadcastRoomState(result.room);
  });

  socket.on('set-keep-fire', ({ roomCode, action } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    const room = getRoomOrExpire(socket, roomCode);
    if (!room) return;
    const result = setKeepFire(roomCode, socket.id, action);
    if (!result) return socket.emit('error', 'Cannot set keep-fire now');
    if (result.error) return socket.emit('error', result.error);
    broadcastRoomState(result.room);
  });

  // Heartbeat: client pings to keep room alive and detect server restarts
  socket.on('heartbeat', ({ roomCode, timestamp }) => {
    const room = getRoom(roomCode);
    if (!room) {
      socket.emit('room-expired', { roomCode, reason: 'Room no longer exists (server restart or expired)' });
      return;
    }
    // Acknowledge heartbeat with server time
    socket.emit('heartbeat-ack', { serverTime: Date.now(), clientTimestamp: timestamp });
  });

  socket.on('set-player-difficulty', ({ roomCode, difficulty } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    const room = setPlayerDifficulty(roomCode, socket.id, difficulty);
    if (room) broadcastRoomState(room);
  });

  socket.on('start-game', ({ roomCode } = {}) => {
    if (!checkRateLimit(socket.id)) {
      logger.health.rateLimit(socket.id);
      return socket.emit('error', 'Too many requests');
    }
    const room = getRoom(roomCode);
    if (!room) {
      socket.emit('room-expired', { roomCode, reason: 'Room no longer exists (server restart or expired)' });
      return socket.emit('error', 'Room not found');
    }
    if (!isHost(room, socket.id)) return socket.emit('error', 'Only the host can start');

    const gameId = room.selectedGameId || 'hidden-signal';
    logger.game.action(roomCode, gameId, 'start', socket.id, { playerCount: room.players.length });

    if (gameId === 'chroma-shift') {
      if (room.players.length < 2) return socket.emit('error', 'Need at least 2 players for Chroma Shift');
      clearRoomTimer(roomCode);
      const started = startGame(roomCode);
      if (!started) return socket.emit('error', 'Could not start Chroma Shift');
      broadcastRoomState(started);
      return;
    }

    if (gameId === 'territory-push') {
      if (room.players.length < 2) return socket.emit('error', 'Need at least 2 players for Territory Push');
      if (room.players.length % 2 !== 0) return socket.emit('error', 'Territory Push requires an EVEN number of players');
      const started = startGame(roomCode);
      if (!started) return socket.emit('error', 'Could not start Territory Push');
      broadcastRoomState(started);
      return;
    }

    if (gameId === 'blend-in') {
      if (room.players.length < 3) return socket.emit('error', 'Need at least 3 players for Blend In');
      clearRoomTimer(roomCode);
      const started = startGame(roomCode);
      if (!started) return socket.emit('error', 'Could not start Blend In');
      startBlendWordPhase(roomCode);
      return;
    }

    if (gameId === 'liar-dice') {
      if (room.players.length < 2 || room.players.length > 12) return socket.emit('error', "Liar's Dice requires 2-12 players");
      clearRoomTimer(roomCode);
      const started = startGame(roomCode);
      if (!started) return socket.emit('error', "Could not start Liar's Dice");
      startLiarBidPhase(roomCode);
      return;
    }

    if (gameId === 'bluff-card') {
      if (room.players.length !== 2) return socket.emit('error', 'Bluff Card is a 2-player duel');
      clearRoomTimer(roomCode);
      const started = startGame(roomCode);
      if (!started) return socket.emit('error', 'Could not start Bluff Card');
      startBluffBetPhase(roomCode);
      return;
    }

    if (gameId === 'missile-command') {
      if (room.players.length !== 2) return socket.emit('error', 'Missile Command is a 1v1 duel (exactly 2 players)');
      clearRoomTimer(roomCode);
      const started = startGame(roomCode);
      if (!started) return socket.emit('error', 'Could not start Missile Command');
      broadcastRoomState(started);
      return;
    }

    if (room.players.length < 4) return socket.emit('error', 'Need at least 4 players for Hidden Signal');
    const started = startGame(roomCode);
    if (!started) return socket.emit('error', 'Could not start game');

    broadcastRoomState(started);

    for (const player of started.players) {
      const playerSocket = io.sockets.sockets.get(player.id);
      if (playerSocket) sendPrivateRole(playerSocket, started);
    }

    startSignalPhase(roomCode);
  });

  socket.on('submit-chroma-guess', ({ roomCode, tileIndex } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    const result = submitChromaGuess(roomCode, socket.id, tileIndex);
    if (!result) return;

    if (!result.correct) {
      socket.emit('chroma-wrong-click');
    } else if (result.raceStarted) {
      // First finder: open 10s race, then reveal
      setRoomTimer(roomCode, CHROMA_RACE_MS_VALUE, () => autoResolveChromaRace(roomCode));
    }
    broadcastRoomState(result.room);
  });

  socket.on('next-chroma-round', ({ roomCode } = {}) => {
    const room = getRoom(roomCode);
    if (!room || !isHost(room, socket.id)) return;
    clearRoomTimer(roomCode);
    const next = nextChromaRound(roomCode);
    if (next) broadcastRoomState(next);
  });

  socket.on('submit-blend-clue', ({ roomCode, word } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    const room = submitBlendClue(roomCode, socket.id, word);
    if (!room) return socket.emit('error', 'Cannot submit clue now');
    socket.emit('blend-clue-accepted');
    if (blendAllCluesIn(room)) {
      clearRoomTimer(roomCode);
      const next = advanceToBlendVote(roomCode);
      if (next) {
        broadcastRoomState(next);
        setRoomTimer(roomCode, BLEND_VOTE_SEC_VALUE * 1000, () => autoResolveBlendVotes(roomCode));
      }
    } else {
      broadcastRoomState(room);
    }
  });

  socket.on('submit-blend-vote', ({ roomCode, targetId } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    const room = submitBlendVote(roomCode, socket.id, targetId);
    if (!room) return socket.emit('error', 'Cannot submit vote now');
    socket.emit('blend-vote-accepted');
    if (blendAllVotesIn(room)) {
      clearRoomTimer(roomCode);
      autoResolveBlendVotes(roomCode);
    } else {
      broadcastRoomState(room);
    }
  });

  socket.on('submit-blend-guess', ({ roomCode, guess } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    const room = submitBlendGuess(roomCode, socket.id, guess);
    if (!room) return socket.emit('error', 'Cannot submit guess now');
    clearRoomTimer(roomCode);
    broadcastRoomState(room);
  });

  socket.on('next-blend-round', ({ roomCode } = {}) => {
    const room = getRoom(roomCode);
    if (!room || !isHost(room, socket.id)) return;
    clearRoomTimer(roomCode);
    const next = nextBlendRound(roomCode);
    if (!next) return;
    if (next.phase === 'end') {
      broadcastRoomState(next);
      return;
    }
    startBlendWordPhase(roomCode);
  });

  socket.on('submit-liar-bid', ({ roomCode, qty, face } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    const room = submitLiarBid(roomCode, socket.id, qty, face);
    if (!room) return socket.emit('error', 'Cannot bid now — wait your turn or raise the bid');
    clearRoomTimer(roomCode);
    broadcastRoomState(room);
    setRoomTimer(roomCode, LIAR_BID_SEC_VALUE * 1000, () => {
      const r = expireLiarBid(roomCode);
      if (r) broadcastRoomState(r);
    });
  });

  socket.on('submit-liar-call', ({ roomCode, kind } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    const room = resolveLiarCall(roomCode, socket.id, kind);
    if (!room) return socket.emit('error', 'Cannot call now');
    clearRoomTimer(roomCode);
    broadcastRoomState(room);
  });

  socket.on('next-liar-round', ({ roomCode } = {}) => {
    const room = getRoom(roomCode);
    if (!room || !isHost(room, socket.id)) return;
    clearRoomTimer(roomCode);
    const next = nextLiarRound(roomCode);
    if (!next) return;
    if (next.phase === 'end') {
      broadcastRoomState(next);
      return;
    }
    startLiarBidPhase(roomCode);
  });

  socket.on('submit-bluff-action', ({ roomCode, action } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    const room = submitBluffAction(roomCode, socket.id, action);
    if (!room) return socket.emit('error', 'Cannot act now');
    clearRoomTimer(roomCode);
    if (room.phase === 'bluff-reveal') {
      broadcastRoomState(room);
      return;
    }
    broadcastRoomState(room);
    setRoomTimer(roomCode, BLUFF_BET_SEC_VALUE * 1000, () => {
      const r = expireBluffBet(roomCode);
      if (r) broadcastRoomState(r);
    });
  });

  socket.on('next-bluff-round', ({ roomCode } = {}) => {
    const room = getRoom(roomCode);
    if (!room || !isHost(room, socket.id)) return;
    clearRoomTimer(roomCode);
    const next = nextBluffRound(roomCode);
    if (!next) return;
    if (next.phase === 'end') {
      broadcastRoomState(next);
      return;
    }
    startBluffBetPhase(roomCode);
  });

  socket.on('submit-territory-pick', ({ roomCode, colIndex } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    const result = submitTerritoryPick(roomCode, socket.id, colIndex);
    if (!result) return socket.emit('error', 'Cannot submit pick now');
    if (result.error) return socket.emit('error', result.error);
    broadcastRoomState(result.room);
  });

  socket.on('place-territory-mine', ({ roomCode, row, col } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    const result = placeTerritoryMine(roomCode, socket.id, row, col);
    if (!result) return socket.emit('error', 'Cannot place mine now');
    if (result.error) return socket.emit('error', result.error);
    broadcastRoomState(result.room);
  });

  socket.on('next-territory-turn', ({ roomCode } = {}) => {
    const room = getRoom(roomCode);
    if (!room || !isHost(room, socket.id)) return socket.emit('error', 'Only host can skip turn');
    const next = nextTerritoryTurn(roomCode);
    if (next) {
      broadcastRoomState(next);
    }
  });

  socket.on('submit-signal', ({ roomCode, signal } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    if (!signal?.trim()) return socket.emit('error', 'Signal cannot be empty');
    const room = submitSignal(roomCode, socket.id, signal);
    if (!room) return socket.emit('error', 'Cannot submit signal now');

    socket.emit('signal-accepted');
    broadcastRoomState(room);
    checkAllSubmitted(room, 'signal');
  });

  socket.on('submit-guess', ({ roomCode, guessData } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    const room = submitGuess(roomCode, socket.id, guessData);
    if (!room) return socket.emit('error', 'Cannot submit guess now');

    socket.emit('guess-accepted');
    broadcastRoomState(room);
    checkAllSubmitted(room, 'guess');
  });

  socket.on('next-round', ({ roomCode } = {}) => {
    const room = getRoom(roomCode);
    if (!room) return;
    if (!isHost(room, socket.id)) return; // Only host

    const next = advanceRound(roomCode);
    if (!next) return;

    if (next.phase === 'end') {
      broadcastRoomState(next);
      return;
    }

    broadcastRoomState(next);

    // Send each player their private role for the new round
    for (const player of next.players) {
      const playerSocket = io.sockets.sockets.get(player.id);
      if (playerSocket) sendPrivateRole(playerSocket, next);
    }

    startSignalPhase(roomCode);
  });

  socket.on('request-end-vote', ({ roomCode } = {}) => {
    const result = startEndVote(roomCode, socket.id);
    if (result.error) return socket.emit('error', result.error);
    if (result.passed) clearRoomTimer(roomCode);
    broadcastRoomState(result.room);
  });

  socket.on('submit-end-vote', ({ roomCode, agree } = {}) => {
    const result = submitEndVote(roomCode, socket.id, agree !== false);
    if (result.error) return socket.emit('error', result.error);
    if (result.failed) {
      io.to(roomCode).emit('end-vote-failed', { declinedBy: result.declinedBy });
    }
    if (result.passed) clearRoomTimer(roomCode);
    broadcastRoomState(result.room);
  });

  socket.on('cancel-end-vote', ({ roomCode } = {}) => {
    const room = cancelEndVote(roomCode, socket.id);
    if (room) broadcastRoomState(room);
  });

  socket.on('play-again', ({ roomCode } = {}) => {
    const room = getRoom(roomCode);
    if (!room) return;
    if (!isHost(room, socket.id)) return;

    // Reset scores, go back to lobby (clear all game modes)
    resetToLobby(room);
    clearRoomTimer(roomCode);
    broadcastRoomState(room);
  });

  socket.on('disconnect', (reason) => {
    logger.socket.disconnect(socket.id, reason);
    const room = playerDisconnected(socket.id);
    if (room) {
      broadcastRoomState(room);
      // Clean up empty rooms
      if (room.players.every(p => !p.connected)) {
        clearRoomTimer(room.code);
        deleteRoom(room.code);
        logger.info('room_deleted', { roomCode: room.code, reason: 'all_players_disconnected' });
      }
    }
  });
});

// ─── Missile Command real-time tick (silo'd) ────────────────────────────
// Advances economy, healers, missiles and core regen ~4x/sec for active games.
setInterval(() => {
  try {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.phase !== 'missile-command-play' || !room.missileCommandState) continue;
      if (room.missileCommandState.winnerId) continue;
      const res = tickMissileRoom(room, now);
      if (res) broadcastRoomState(res.room);
    }
  } catch (e) {
    console.error('[missile-tick] failed', e);
  }
}, 250);

httpServer.listen(PORT, () => {
  logger.info('Server started', { port: PORT, rooms: rooms.size });
  console.log(`🎮 Hidden Signal server running on port ${PORT}`);
});
