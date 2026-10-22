// index.js — Express + Socket.io server for Hidden Signal

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { logger } from './logger.js';
import { PROTOCOL_VERSION } from './version.js';
// Task 1 — server-acknowledged actions: every game action carries a client
// requestId and answers its socket ack with { ok, error }. Duplicates replay
// their stored result; rejections/duplicates are logged (see actionAck.js).
import { beginAction } from './actionAck.js';

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
  leaveRoom,
  updateChromaOptions,
  updateTerritoryOptions,
  updateLiarOptions,
  updateMissileCommandOptions,
  buildMissileBuilding,
  upgradeMissileBuilding,
  sellMissileBuilding,
  cancelMissileSell,
  loadMissile,
  rebuildRubble,
  launchMissile,
  launchMissileType,
  setKeepFire,
  fireDesperation,
  claimSupplyShip,
  tickMissileRoom,
  setPlayerDifficulty,
  submitChromaGuess,
  resolveChromaRace,
  expireChromaRound,
  nextChromaRound,
  submitBlendClue,
  blendAllCluesIn,
  advanceToBlendVote,
  submitBlendVote,
  blendAllVotesIn,
  resolveBlendVotes,
  submitBlendGuess,
  expireBlendGuess,
  expireBlendWord,
  expireBlendVote,
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
  expireTerritoryTurn,
  autoResolveTerritoryTurn,
  TERRITORY_TURN_SEC,
  TERRITORY_TURN_SEC_VALUE,
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
  rejoinRoom,
  buildRevealPayload,
  REJOIN_GRACE_MS,
  deleteRoom,
  sweepInactiveRooms,
  freeExpiredGhostSeats,
  isHost,
  startEndVote,
  submitEndVote,
  cancelEndVote,
  forceAdvance,
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
// Fog redaction lives in the silo'd game module (not the wrapper layer).
import { filterMissileStateForPlayer, mcTickPayload, mcDynSnapshot, mcPendingDiffCount } from './missileCommand.js';

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
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    rooms: rooms.size,
    protocolVersion: PROTOCOL_VERSION,
    bootId: BOOT_ID,
    uptimeSec: Math.floor((Date.now() - BOOT_TIME_MS) / 1000),
  });
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
  // Bandwidth: compress room-state frames (3-16 KB of repetitive JSON).
  // Frames under this threshold (the slim mc-tick stream) skip compression
  // overhead entirely. socket.io defaults this OFF, we opt in because the
  // per-frame CPU cost is small and traffic reduction is 5-10x on big JSON.
  perMessageDeflate: { threshold: 2048 },
});

// Unique per process boot. Clients compare it on (re)connect: a changed
// bootId means the server restarted and all in-memory rooms are gone, so a
// stale room screen must never look healthy.
const BOOT_ID = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
const BOOT_TIME_MS = Date.now();

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

function armTerritoryTurnTimer(code) {
  const room = getRoom(code);
  if (!room || room.phase !== 'territory-turn' || room.territoryState?.extremeMode) return;
  const ms = Math.max(0, (room.timerEnd ?? Date.now() + TERRITORY_TURN_SEC * 1000) - Date.now());
  setRoomTimer(code, ms || TERRITORY_TURN_SEC * 1000, () => {
    clearRoomTimer(code);
    try {
      const r = expireTerritoryTurn(code);
      if (r) {
        broadcastRoomState(r);
        if (r.phase === 'territory-turn' && !r.territoryState?.extremeMode) {
          armTerritoryTurnTimer(code);
        }
      }
    } catch (e) {
      console.error('[timer] expireTerritoryTurn failed', e);
    }
  });
}

// Periodic sweep of abandoned rooms (every 10 min). Occupants of deleted
// rooms are told why (instead of staring at a frozen room), then logged.
setInterval(() => {
  try {
    const before = rooms.size;
    // Free expired ghost seats first and notify those clients so they get a
    // rejoin path instead of staring at a frozen match.
    const freed = freeExpiredGhostSeats(Date.now());
    for (const { code, removedIds } of freed) {
      for (const id of removedIds) {
        const sock = io.sockets.sockets.get(id);
        if (sock) {
          try { sock.leave(code); } catch {}
          sock.emit('kicked', { roomCode: code, reason: 'Your seat expired — rejoin to continue' });
        }
      }
    }
    const deleted = sweepInactiveRooms(Date.now());
    const after = rooms.size;
    for (const { code, occupants, reason } of deleted) {
      const detail = reason === 'idle-timeout'
        ? 'Room expired after 2h without any player action'
        : 'Room deleted after all players left';
      for (const p of occupants) {
        if (!p.connected) continue;
        const sock = io.sockets.sockets.get(p.id);
        if (sock) sock.emit('room-expired', { roomCode: code, reason: detail });
      }
      logger.info('room_sweep_deleted', { roomCode: code, reason, occupants: occupants.length });
    }
    if (before !== after) {
      logger.info('room_sweep_completed', { removed: before - after, remaining: after });
    }
  } catch (e) {
    logger.error('room_sweep_failed', { error: e?.message ?? e });
  }
}, 10 * 60 * 1000);

// ─── Stuck-phase watchdog ───────────────────────────────────────────────────
// Safety net: every timed phase arms exactly one roomTimers entry when it is
// entered. If a room sits past timerEnd with no timer armed (cleared timer,
// exception between resolve and arm, stalled loop), run that phase's normal
// timeout path. 5s grace + armed-timer check so we never race a live timer.
// Reveal/end/lobby phases are deliberately unhandled — no timeout applies.
setInterval(() => {
  try {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (!room.timerEnd || now < room.timerEnd + 5000) continue;
      // An armed timer that has clearly overrun (10s past deadline) is stuck
      // too — clear it and run the phase's normal timeout path.
      if (roomTimers.has(room.code) && now < room.timerEnd + 10000) continue;
      if (roomTimers.has(room.code)) clearRoomTimer(room.code);
      healStuckRoom(room.code, room.phase);
    }
  } catch (e) {
    console.error('[watchdog] failed', e);
  }
}, 5000);

function healStuckRoom(code, phase) {
  try {
    // Mirror each phase's normal timeout path (same functions the timers call).
    if (phase === 'signal') {
      logger.warn('watchdog_heal', { roomCode: code, phase });
      startDiscussPhase(code);
      return;
    }
    if (phase === 'discuss') {
      logger.warn('watchdog_heal', { roomCode: code, phase });
      clearRoomTimer(code);
      const r2 = advanceToGuess(code);
      if (!r2) return;
      broadcastRoomState(r2);
      setRoomTimer(code, GUESS_TIME_SEC * 1000, () => {
        clearRoomTimer(code);
        try {
          autoResolveRound(code);
        } catch (e) {
          console.error('[timer] autoResolveRound failed', e);
        }
      });
      return;
    }
    if (phase === 'guess') {
      logger.warn('watchdog_heal', { roomCode: code, phase });
      clearRoomTimer(code);
      autoResolveRound(code);
      return;
    }
    if (phase === 'reveal') {
      // Results watchdog: re-send the round-reveal payload + state so a client
      // that missed it (or reloaded into a frozen "Calculating results…"
      // screen) can recover instead of spinning forever.
      logger.warn('watchdog_heal', { roomCode: code, phase });
      const room = getRoom(code);
      if (!room) return;
      const payload = buildRevealPayload(room);
      if (payload) {
        for (const p of room.players) {
          const sock = io.sockets.sockets.get(p.id);
          if (sock) sock.emit('round-reveal', payload);
        }
      }
      broadcastRoomState(room);
      room.timerEnd = Date.now() + 30000;
      return;
    }
    if (phase === 'blend-word') {
      logger.warn('watchdog_heal', { roomCode: code, phase });
      const r1 = expireBlendWord(code);
      if (!r1) return;
      broadcastRoomState(r1);
      setRoomTimer(code, BLEND_VOTE_SEC_VALUE * 1000, () => {
        try {
          autoResolveBlendVotes(code);
        } catch (e) {
          console.error('[timer] autoResolveBlendVotes failed', e);
        }
      });
      return;
    }
    if (phase === 'blend-vote') {
      logger.warn('watchdog_heal', { roomCode: code, phase });
      autoResolveBlendVotes(code);
      return;
    }
    if (phase === 'blend-guess') {
      logger.warn('watchdog_heal', { roomCode: code, phase });
      const r = expireBlendGuess(code);
      if (r) broadcastRoomState(r);
      return;
    }
    if (phase === 'liar-bid') {
      logger.warn('watchdog_heal', { roomCode: code, phase });
      const r = expireLiarBid(code);
      if (r) broadcastRoomState(r);
      return;
    }
    if (phase === 'bluff-bet') {
      logger.warn('watchdog_heal', { roomCode: code, phase });
      const r = expireBluffBet(code);
      if (r) broadcastRoomState(r);
      return;
    }
    if (phase === 'territory-turn') {
      logger.warn('watchdog_heal', { roomCode: code, phase });
      const r = expireTerritoryTurn(code);
      if (r) {
        broadcastRoomState(r);
        if (r.phase === 'territory-turn' && !r.territoryState?.extremeMode) armTerritoryTurnTimer(code);
      }
      return;
    }
    if (phase === 'chroma-play') {
      logger.warn('watchdog_heal', { roomCode: code, phase });
      const room = getRoom(code);
      if (room?.chromaState?.raceEndAt) {
        const r = resolveChromaRace(code);
        if (r) broadcastRoomState(r);
      } else {
        const r = expireChromaRound(code);
        if (r) broadcastRoomState(r);
      }
      return;
    }
  } catch (e) {
    console.error('[watchdog] heal failed', { roomCode: code, phase, error: e?.message ?? e });
  }
}

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
    missileCommandOptions: room.missileCommandOptions || { startingResources: 200, fogOfWar: true, fogHistory: false, supplyShip: false, aiOpponent: false, aiDifficulty: 'hard', aiType: 'balanced' },
    missileCommandState: stripMidGameIncomeHistory(
      filterMissileStateForPlayer(room.missileCommandState, forPlayerId, Date.now()),
    ),
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
    hostId: room.hostId || null,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      // Host identity is derived from the single source of truth (room.hostId),
      // never from a stale per-player flag.
      isHost: room.hostId ? p.id === room.hostId : p.isHost,
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

// Income-rate history would leak the enemy economy mid-game; the fog filter
// already withholds it when fog is ON, but the fog-OFF path returns the raw
// state passthrough — strip it there too (the post-game view still gets it).
function stripMidGameIncomeHistory(mc) {
  if (!mc || mc.winnerId || mc.winReason || !mc.incomeHistory) return mc;
  return { ...mc, incomeHistory: undefined };
}

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
  // Everyone just received the full authoritative state — resync the slim
  // mc-tick diff cache so subsequent ticks only carry further changes.
  if (room.phase === 'missile-command-play' && room.missileCommandState) {
    room.mcDyn = mcDynSnapshot(room.missileCommandState);
    room.mcLastEconSig = null;
  }
}

// Emit one slim missile tick (missiles in flight + resources + dynamic
// building fields). ~0.3-2.5 KB instead of the 3-16 KB full room state.
function sendMcTick(room, now) {
  const st = room.missileCommandState;
  if (!st || room.phase !== 'missile-command-play') return;
  if (!room.mcDyn) room.mcDyn = mcDynSnapshot(st);
  const payload = mcTickPayload(st, now, room.mcDyn);
  for (const player of room.players) {
    io.sockets.sockets.get(player.id)?.emit('mc-tick', payload);
  }
}

function startSignalPhase(code) {
  const room = advanceToSignal(code);
  if (!room) return;
  room.lastActivityMs = Date.now();
  broadcastRoomState(room);
  // Auto-advance signal -> discuss -> guess on timeout
  setRoomTimer(code, SIGNAL_TIME_SEC * 1000, () => {
    clearRoomTimer(code);
    try {
      const r1 = advanceToDiscuss(code);
      if (!r1) return;
      broadcastRoomState(r1);
      setRoomTimer(code, DISCUSS_TIME_SEC * 1000, () => {
        clearRoomTimer(code);
        try {
          const r2 = advanceToGuess(code);
          if (!r2) return;
          broadcastRoomState(r2);
          setRoomTimer(code, GUESS_TIME_SEC * 1000, () => {
            clearRoomTimer(code);
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
    clearRoomTimer(code);
    try {
      const r2 = advanceToGuess(code);
      if (!r2) return;
      broadcastRoomState(r2);
      setRoomTimer(code, GUESS_TIME_SEC * 1000, () => {
        clearRoomTimer(code);
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
  clearRoomTimer(code);
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
      const r1 = expireBlendWord(code);
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
      console.error('[timer] expireBlendWord failed', e);
    }
  });
}

function autoResolveBlendVotes(code) {
  clearRoomTimer(code);
  const room = expireBlendVote(code);
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
  if (typeof room.timerEnd !== 'number') room.timerEnd = Date.now() + LIAR_BID_SEC_VALUE * 1000;
  broadcastRoomState(room);
  // One server turn clock: arm from the room's own deadline instead of a
  // freshly recomputed constant, so the broadcast timerEnd and the armed
  // timer can never drift apart.
  const ms = Math.max(0, room.timerEnd - Date.now());
  setRoomTimer(code, ms, () => {
    clearRoomTimer(code);
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
  clearRoomTimer(code);
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
  // Arm a results watchdog so a missed reveal payload can be re-sent.
  room.timerEnd = Date.now() + 30000;
  broadcastRoomState(room);
}

// ─── Socket Events ──────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  logger.socket.connect(socket.id, { transport: socket.conn.transport.name });
  // Boot handshake: lets the client detect a server restart (new process =
  // new bootId = all in-memory rooms gone) instead of trusting stale state.
  socket.emit('server-hello', { bootId: BOOT_ID, now: Date.now() });

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
    const roomBefore = getRoom(code);
    const oldHostId = roomBefore?.hostId || null;
    const result = joinRoom(code, socket.id, playerName.trim().substring(0, 20));
    if (result.error) {
      logger.warn('join_room_failed', { code, error: result.error, roomsCount: rooms.size, existingRooms: Array.from(rooms.keys()) });
      return socket.emit('error', result.error);
    }

    const room = result.room;
    if (oldHostId && room.hostId && oldHostId !== room.hostId) {
      const newHost = room.players.find(p => p.id === room.hostId);
      io.to(room.code).emit('host-changed', { newHostId: room.hostId, newHostName: newHost?.name || 'a player' });
    }
    logger.room.join(code, socket.id, { playerName: playerName.trim().substring(0, 20) });
    socket.join(code);
    socket.emit('room-joined', { roomCode: code, playerId: socket.id });
    broadcastRoomState(room);
    sendPrivateRole(socket, room);
    const joinRevealPayload = buildRevealPayload(room);
    if (joinRevealPayload) socket.emit('round-reveal', joinRevealPayload);
  });

  socket.on('kick-player', (data = {}, ack = null) => {
    const done = beginAction(socket, 'kick-player', data, ack, getRoom);
    if (!done) return;
    const { roomCode, targetId } = data;
    if (!roomCode || !targetId) return done(false, 'Room and player required');
    const result = kickPlayer(roomCode, socket.id, targetId);
    if (result.error) {
      if (result.membershipLost) {
        if (result.room) broadcastRoomState(result.room);
        socket.emit('membership-lost', { roomCode, reason: result.error, rejoin: true });
      }
      return done(false, result.error);
    }
    const kickedSocket = io.sockets.sockets.get(targetId);
    if (kickedSocket) {
      kickedSocket.leave(roomCode);
      kickedSocket.emit('kicked', { roomCode });
    }
    broadcastRoomState(result.room);
    return done(true);
  });

  socket.on('leave-room', (data = {}, ack = null) => {
    const done = beginAction(socket, 'leave-room', data, ack, getRoom);
    if (!done) return;
    const { roomCode } = data || {};
    if (!roomCode) return done(false, 'Room required');
    const code = roomCode.trim().toUpperCase();
    const roomBefore = getRoom(code);
    const oldHostId = roomBefore?.hostId || null;
    const result = leaveRoom(code, socket.id);
    if (result.error) {
      if (result.membershipLost) {
        if (result.room) broadcastRoomState(result.room);
        socket.emit('membership-lost', { roomCode, reason: result.error, rejoin: true });
      }
      return done(false, result.error);
    }
    socket.leave(code);
    const room = result.room;
    if (room) {
      broadcastRoomState(room);
      // Host leave triggers clean migration notification (Task 2/8).
      if (oldHostId && room.hostId && oldHostId !== room.hostId) {
        const newHost = room.players.find(p => p.id === room.hostId);
        io.to(code).emit('host-changed', { newHostId: room.hostId, newHostName: newHost?.name || 'a player' });
      }
    }
    return done(true);
  });

  socket.on('select-game', (data = {}, ack = null) => {
    const done = beginAction(socket, 'select-game', data, ack, getRoom);
    if (!done) return;
    const { roomCode, gameId } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const room = getRoom(roomCode);
    if (!room || !isHost(room, socket.id)) return done(false, 'Only host can change game');
    const updated = selectGame(roomCode, gameId);
    if (updated) broadcastRoomState(updated);
    return done(true);
  });

  socket.on('update-chroma-options', (data = {}, ack = null) => {
    const done = beginAction(socket, 'update-chroma-options', data, ack, getRoom);
    if (!done) return;
    const { roomCode, options } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const room = getRoom(roomCode);
    if (!room || !isHost(room, socket.id)) return done(false, 'Only host can change options');
    const updated = updateChromaOptions(roomCode, options);
    if (updated) broadcastRoomState(updated);
    return done(true);
  });

  socket.on('update-territory-options', (data = {}, ack = null) => {
    const done = beginAction(socket, 'update-territory-options', data, ack, getRoom);
    if (!done) return;
    const { roomCode, options } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const room = getRoom(roomCode);
    if (!room || !isHost(room, socket.id)) return done(false, 'Only host can change options');
    const updated = updateTerritoryOptions(roomCode, options);
    if (updated) broadcastRoomState(updated);
    return done(true);
  });

  socket.on('update-liar-options', (data = {}, ack = null) => {
    const done = beginAction(socket, 'update-liar-options', data, ack, getRoom);
    if (!done) return;
    const { roomCode, options } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const room = getRoom(roomCode);
    if (!room || !isHost(room, socket.id)) return done(false, 'Only host can change options');
    const updated = updateLiarOptions(roomCode, options);
    if (updated) broadcastRoomState(updated);
    return done(true);
  });

  socket.on('update-missile-command-options', (data = {}, ack = null) => {
    const done = beginAction(socket, 'update-missile-command-options', data, ack, getRoom);
    if (!done) return;
    const { roomCode, options } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const room = getRoom(roomCode);
    if (!room || !isHost(room, socket.id)) return done(false, 'Only host can change options');
    const updated = updateMissileCommandOptions(roomCode, options);
    if (updated) broadcastRoomState(updated);
    return done(true);
  });

  socket.on('build-missile-building', (data = {}, ack = null) => {
    const done = beginAction(socket, 'build-missile-building', data, ack, getRoom);
    if (!done) return;
    const { roomCode, action } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const room = getRoomOrExpire(socket, roomCode);
    if (!room) return done(false, 'Room no longer exists');
    const result = buildMissileBuilding(roomCode, socket.id, action);
    if (!result) return done(false, 'Cannot build now');
    if (result.error) {
      if (result.membershipLost) {
        if (result.room) broadcastRoomState(result.room);
        socket.emit('membership-lost', { roomCode, reason: result.error, rejoin: true });
      }
      return done(false, result.error);
    }
    broadcastRoomState(result.room);
    return done(true);
  });

  socket.on('upgrade-missile-building', (data = {}, ack = null) => {
    const done = beginAction(socket, 'upgrade-missile-building', data, ack, getRoom);
    if (!done) return;
    const { roomCode, action } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const room = getRoomOrExpire(socket, roomCode);
    if (!room) return done(false, 'Room no longer exists');
    const buildingId = typeof action === 'string' ? action : action?.buildingId;
    const result = upgradeMissileBuilding(roomCode, socket.id, buildingId);
    if (!result) return done(false, 'Cannot upgrade now');
    if (result.error) {
      if (result.membershipLost) {
        if (result.room) broadcastRoomState(result.room);
        socket.emit('membership-lost', { roomCode, reason: result.error, rejoin: true });
      }
      return done(false, result.error);
    }
    broadcastRoomState(result.room);
    return done(true);
  });

  socket.on('sell-missile-building', (data = {}, ack = null) => {
    const done = beginAction(socket, 'sell-missile-building', data, ack, getRoom);
    if (!done) return;
    const { roomCode, buildingId } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const room = getRoomOrExpire(socket, roomCode);
    if (!room) return done(false, 'Room no longer exists');
    const id = typeof buildingId === 'string' ? buildingId : buildingId?.buildingId;
    const result = sellMissileBuilding(roomCode, socket.id, id);
    if (!result) return done(false, 'Cannot sell now');
    if (result.error) {
      if (result.membershipLost) {
        if (result.room) broadcastRoomState(result.room);
        socket.emit('membership-lost', { roomCode, reason: result.error, rejoin: true });
      }
      return done(false, result.error);
    }
    broadcastRoomState(result.room);
    return done(true);
  });

  socket.on('cancel-missile-sell', (data = {}, ack = null) => {
    const done = beginAction(socket, 'cancel-missile-sell', data, ack, getRoom);
    if (!done) return;
    const { roomCode, buildingId } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const room = getRoomOrExpire(socket, roomCode);
    if (!room) return done(false, 'Room no longer exists');
    const id = typeof buildingId === 'string' ? buildingId : buildingId?.buildingId;
    const result = cancelMissileSell(roomCode, socket.id, id);
    if (!result) return done(false, 'Cannot cancel sale now');
    if (result.error) {
      if (result.membershipLost) {
        if (result.room) broadcastRoomState(result.room);
        socket.emit('membership-lost', { roomCode, reason: result.error, rejoin: true });
      }
      return done(false, result.error);
    }
    broadcastRoomState(result.room);
    return done(true);
  });

  socket.on('rebuild-rubble', (data = {}, ack = null) => {
    const done = beginAction(socket, 'rebuild-rubble', data, ack, getRoom);
    if (!done) return;
    const { roomCode, rubbleId } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const room = getRoomOrExpire(socket, roomCode);
    if (!room) return done(false, 'Room no longer exists');
    const id = typeof rubbleId === 'string' ? rubbleId : rubbleId?.rubbleId;
    const result = rebuildRubble(roomCode, socket.id, id);
    if (!result) return done(false, 'Cannot rebuild now');
    if (result.error) {
      if (result.membershipLost) {
        if (result.room) broadcastRoomState(result.room);
        socket.emit('membership-lost', { roomCode, reason: result.error, rejoin: true });
      }
      return done(false, result.error);
    }
    broadcastRoomState(result.room);
    return done(true);
  });

  socket.on('launch-missile', (data = {}, ack = null) => {
    const done = beginAction(socket, 'launch-missile', data, ack, getRoom);
    if (!done) return;
    const { roomCode, action } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const room = getRoomOrExpire(socket, roomCode);
    if (!room) return done(false, 'Room no longer exists');
    const result = launchMissile(roomCode, socket.id, action);
    if (!result) return done(false, 'Cannot launch now');
    if (result.error) {
      if (result.membershipLost) {
        if (result.room) broadcastRoomState(result.room);
        socket.emit('membership-lost', { roomCode, reason: result.error, rejoin: true });
      }
      return done(false, result.error);
    }
    broadcastRoomState(result.room);
    return done(true);
  });

  socket.on('load-missile', (data = {}, ack = null) => {
    const done = beginAction(socket, 'load-missile', data, ack, getRoom);
    if (!done) return;
    const { roomCode, launcherId } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const room = getRoomOrExpire(socket, roomCode);
    if (!room) return done(false, 'Room no longer exists');
    const id = typeof launcherId === 'string' ? launcherId : launcherId?.launcherId;
    const result = loadMissile(roomCode, socket.id, id);
    if (!result) return done(false, 'Cannot load now');
    if (result.error) {
      if (result.membershipLost) {
        if (result.room) broadcastRoomState(result.room);
        socket.emit('membership-lost', { roomCode, reason: result.error, rejoin: true });
      }
      return done(false, result.error);
    }
    broadcastRoomState(result.room);
    return done(true);
  });

  socket.on('launch-missile-type', (data = {}, ack = null) => {
    const done = beginAction(socket, 'launch-missile-type', data, ack, getRoom);
    if (!done) return;
    const { roomCode, launcherType, targetGx, targetGy } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const room = getRoomOrExpire(socket, roomCode);
    if (!room) return done(false, 'Room no longer exists');
    const gx = typeof targetGx === 'number' ? targetGx : targetGx?.gx;
    const gy = typeof targetGy === 'number' ? targetGy : targetGy?.gy;
    const result = launchMissileType(roomCode, socket.id, launcherType, gx, gy);
    if (!result) return done(false, 'Cannot launch now');
    if (result.error) {
      if (result.membershipLost) {
        if (result.room) broadcastRoomState(result.room);
        socket.emit('membership-lost', { roomCode, reason: result.error, rejoin: true });
      }
      return done(false, result.error);
    }
    broadcastRoomState(result.room);
    return done(true);
  });

  socket.on('set-keep-fire', (data = {}, ack = null) => {
    const done = beginAction(socket, 'set-keep-fire', data, ack, getRoom);
    if (!done) return;
    const { roomCode, action } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const room = getRoomOrExpire(socket, roomCode);
    if (!room) return done(false, 'Room no longer exists');
    const result = setKeepFire(roomCode, socket.id, action);
    if (!result) return done(false, 'Cannot set keep-fire now');
    if (result.error) {
      if (result.membershipLost) {
        if (result.room) broadcastRoomState(result.room);
        socket.emit('membership-lost', { roomCode, reason: result.error, rejoin: true });
      }
      return done(false, result.error);
    }
    broadcastRoomState(result.room);
    return done(true);
  });

  socket.on('fire-desperation', (data = {}, ack = null) => {
    const done = beginAction(socket, 'fire-desperation', data, ack, getRoom);
    if (!done) return;
    const { roomCode, targetGx, targetGy } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const room = getRoomOrExpire(socket, roomCode);
    if (!room) return done(false, 'Room no longer exists');
    const gx = typeof targetGx === 'number' ? targetGx : targetGx?.gx;
    const gy = typeof targetGy === 'number' ? targetGy : targetGy?.gy;
    const result = fireDesperation(roomCode, socket.id, { targetGx: gx, targetGy: gy });
    if (!result) return done(false, 'Cannot fire now');
    if (result.error) {
      if (result.membershipLost) {
        if (result.room) broadcastRoomState(result.room);
        socket.emit('membership-lost', { roomCode, reason: result.error, rejoin: true });
      }
      return done(false, result.error);
    }
    broadcastRoomState(result.room);
    return done(true);
  });

  socket.on('claim-supply-ship', (data = {}, ack = null) => {
    const done = beginAction(socket, 'claim-supply-ship', data, ack, getRoom);
    if (!done) return;
    const { roomCode } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const room = getRoomOrExpire(socket, roomCode);
    if (!room) return done(false, 'Room no longer exists');
    const result = claimSupplyShip(roomCode, socket.id);
    if (!result) return done(false, 'Cannot claim now');
    if (result.error) {
      if (result.membershipLost) {
        if (result.room) broadcastRoomState(result.room);
        socket.emit('membership-lost', { roomCode, reason: result.error, rejoin: true });
      }
      return done(false, result.error);
    }
    broadcastRoomState(result.room);
    return done(true);
  });

  // Heartbeat: client pings to keep room alive and detect server restarts.
  // A flowing heartbeat proves someone is home, so it refreshes activity —
  // an attended room must never age out from under its players.
  socket.on('heartbeat', ({ roomCode, timestamp }) => {
    const room = getRoom(roomCode);
    if (!room) {
      socket.emit('room-expired', { roomCode, reason: 'Room no longer exists (server restart or expired)' });
      return;
    }
    room.lastActivityMs = Date.now();
    // Acknowledge heartbeat with server time
    socket.emit('heartbeat-ack', { serverTime: Date.now(), clientTimestamp: timestamp });
  });

  socket.on('set-player-difficulty', (data = {}, ack = null) => {
    const done = beginAction(socket, 'set-player-difficulty', data, ack, getRoom);
    if (!done) return;
    const { roomCode, difficulty } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const room = setPlayerDifficulty(roomCode, socket.id, difficulty);
    if (room) broadcastRoomState(room);
    return done(room ? true : false, room ? null : 'Cannot set difficulty now');
  });

  socket.on('start-game', (data = {}, ack = null) => {
    const done = beginAction(socket, 'start-game', data, ack, getRoom);
    if (!done) return;
    const { roomCode } = data;
    if (!checkRateLimit(socket.id)) {
      logger.health.rateLimit(socket.id);
      return done(false, 'Too many requests');
    }
    const room = getRoom(roomCode);
    if (!room) {
      socket.emit('room-expired', { roomCode, reason: 'Room no longer exists (server restart or expired)' });
      return done(false, 'Room not found');
    }
    if (!isHost(room, socket.id)) return done(false, 'Only the host can start');

    const gameId = room.selectedGameId || 'hidden-signal';
    logger.game.action(roomCode, gameId, 'start', socket.id, { playerCount: room.players.length });

    if (gameId === 'chroma-shift') {
      if (room.players.length < 2) return done(false, 'Need at least 2 players for Chroma Shift');
      clearRoomTimer(roomCode);
      const started = startGame(roomCode);
      if (!started) return done(false, 'Could not start Chroma Shift');
      broadcastRoomState(started);
      if (started?.chromaState?.shiftDurationSec) {
        setRoomTimer(roomCode, started.chromaState.shiftDurationSec * 1000, () => {
          try {
            const r = expireChromaRound(roomCode);
            if (r) broadcastRoomState(r);
          } catch (e) { console.error('[timer] expireChromaRound failed', e); }
        });
      }
      return done(true);
    }

    if (gameId === 'territory-push') {
      if (room.players.length < 2) return done(false, 'Need at least 2 players for Territory Push');
      if (room.players.length % 2 !== 0) return done(false, 'Territory Push requires an EVEN number of players');
      const started = startGame(roomCode);
      if (!started) return done(false, 'Could not start Territory Push');
      broadcastRoomState(started);
      if (!started?.territoryState?.extremeMode) {
        clearRoomTimer(roomCode);
        armTerritoryTurnTimer(roomCode);
      }
      return done(true);
    }

    if (gameId === 'blend-in') {
      if (room.players.length < 3) return done(false, 'Need at least 3 players for Blend In');
      clearRoomTimer(roomCode);
      const started = startGame(roomCode);
      if (!started) return done(false, 'Could not start Blend In');
      startBlendWordPhase(roomCode);
      return done(true);
    }

    if (gameId === 'liar-dice') {
      if (room.players.length < 2 || room.players.length > 12) return done(false, "Liar's Dice requires 2-12 players");
      clearRoomTimer(roomCode);
      const started = startGame(roomCode);
      if (!started) return done(false, "Could not start Liar's Dice");
      startLiarBidPhase(roomCode);
      return done(true);
    }

    if (gameId === 'bluff-card') {
      if (room.players.length !== 2) return done(false, 'Bluff Card is a 2-player duel');
      clearRoomTimer(roomCode);
      const started = startGame(roomCode);
      if (!started) return done(false, 'Could not start Bluff Card');
      startBluffBetPhase(roomCode);
      return done(true);
    }

    if (gameId === 'missile-command') {
      const aiEnabled = room.missileCommandOptions?.aiOpponent === true;
      if (aiEnabled) {
        if (room.players.length !== 1) return done(false, 'Missile Command vs AI needs exactly 1 player');
      } else {
        if (room.players.length !== 2) return done(false, 'Missile Command is a 1v1 duel (exactly 2 players)');
      }
      clearRoomTimer(roomCode);
      const started = startGame(roomCode);
      if (!started) return done(false, 'Could not start Missile Command');
      broadcastRoomState(started);
      return done(true);
    }

    if (room.players.length < 4) return done(false, 'Need at least 4 players for Hidden Signal');
    const started = startGame(roomCode);
    if (!started) return done(false, 'Could not start game');

    broadcastRoomState(started);

    for (const player of started.players) {
      const playerSocket = io.sockets.sockets.get(player.id);
      if (playerSocket) sendPrivateRole(playerSocket, started);
    }

    startSignalPhase(roomCode);
    return done(true);
  });

  socket.on('submit-chroma-guess', (data = {}, ack = null) => {
    const done = beginAction(socket, 'submit-chroma-guess', data, ack, getRoom);
    if (!done) return;
    const { roomCode, tileIndex } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const result = submitChromaGuess(roomCode, socket.id, tileIndex);
    // Rejected guesses (stale phase, out-of-range tile, expired race) used to
    // vanish silently while wrong guesses flashed instantly — say so instead.
    if (!result) return done(false, 'Tile not accepted — the round may have just ended');

    // Hard rejects carry a reason the client can toast verbatim.
    if (result.reason === 'too-late' || result.reason === 'not-your-round') {
      const msg = result.reason === 'too-late'
        ? 'Too late — the race ended'
        : 'Not your round';
      if (result.room) broadcastRoomState(result.room);
      return done(false, msg);
    }

    if (!result.correct && result.reason === 'wrong') {
      socket.emit('chroma-wrong-click');
    } else if (result.raceStarted) {
      // First finder: open 10s race, then reveal (round timeout no longer applies)
      clearRoomTimer(roomCode);
      setRoomTimer(roomCode, CHROMA_RACE_MS_VALUE, () => autoResolveChromaRace(roomCode));
    }
    if (result.room) broadcastRoomState(result.room);
    return done(true);
  });

  socket.on('next-chroma-round', (data = {}, ack = null) => {
    const done = beginAction(socket, 'next-chroma-round', data, ack, getRoom);
    if (!done) return;
    const { roomCode } = data;
    const room = getRoom(roomCode);
    if (!room || !isHost(room, socket.id)) return done(false, 'Only host can advance the round');
    clearRoomTimer(roomCode);
    const next = nextChromaRound(roomCode);
    if (next) {
      broadcastRoomState(next);
      if (next?.chromaState?.shiftDurationSec) {
        setRoomTimer(roomCode, next.chromaState.shiftDurationSec * 1000, () => {
          try {
            const r = expireChromaRound(roomCode);
            if (r) broadcastRoomState(r);
          } catch (e) { console.error('[timer] expireChromaRound failed', e); }
        });
      }
    }
    return done(true);
  });

  socket.on('submit-blend-clue', (data = {}, ack = null) => {
    const done = beginAction(socket, 'submit-blend-clue', data, ack, getRoom);
    if (!done) return;
    const { roomCode, word } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const room = submitBlendClue(roomCode, socket.id, word);
    if (!room) return done(false, 'Cannot submit clue now');
    if (blendAllCluesIn(room)) {
      clearRoomTimer(roomCode);
      try {
        const next = expireBlendWord(roomCode);
        if (next) {
          broadcastRoomState(next);
          setRoomTimer(roomCode, BLEND_VOTE_SEC_VALUE * 1000, () => autoResolveBlendVotes(roomCode));
        }
      } catch (e) {
        console.error('[submit-blend-clue] expireBlendWord failed', e);
      }
    } else {
      broadcastRoomState(room);
    }
    return done(true);
  });

  socket.on('submit-blend-vote', (data = {}, ack = null) => {
    const done = beginAction(socket, 'submit-blend-vote', data, ack, getRoom);
    if (!done) return;
    const { roomCode, targetId } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const room = submitBlendVote(roomCode, socket.id, targetId);
    if (!room) return done(false, 'Cannot submit vote now');
    if (blendAllVotesIn(room)) {
      clearRoomTimer(roomCode);
      try {
        autoResolveBlendVotes(roomCode);
      } catch (e) {
        console.error('[submit-blend-vote] autoResolveBlendVotes failed', e);
      }
    } else {
      broadcastRoomState(room);
    }
    return done(true);
  });

  socket.on('submit-blend-guess', (data = {}, ack = null) => {
    const done = beginAction(socket, 'submit-blend-guess', data, ack, getRoom);
    if (!done) return;
    const { roomCode, guess } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const room = submitBlendGuess(roomCode, socket.id, guess);
    if (!room) return done(false, 'Cannot submit guess now');
    clearRoomTimer(roomCode);
    broadcastRoomState(room);
    return done(true);
  });

  socket.on('next-blend-round', (data = {}, ack = null) => {
    const done = beginAction(socket, 'next-blend-round', data, ack, getRoom);
    if (!done) return;
    const { roomCode } = data;
    const room = getRoom(roomCode);
    if (!room || !isHost(room, socket.id)) return done(false, 'Only host can advance the round');
    clearRoomTimer(roomCode);
    const next = nextBlendRound(roomCode);
    if (!next) return done(false, 'Cannot advance the round now');
    if (next.phase === 'end') {
      broadcastRoomState(next);
      return done(true);
    }
    startBlendWordPhase(roomCode);
    return done(true);
  });

  socket.on('submit-liar-bid', (data = {}, ack = null) => {
    const done = beginAction(socket, 'submit-liar-bid', data, ack, getRoom);
    if (!done) return;
    const { roomCode, qty, face } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    // State real reason instead of a generic "wait your turn or raise" toast.
    const pre = getRoom(roomCode);
    if (!pre || pre.phase !== 'liar-bid' || !pre.liarState) {
      return done(false, pre?.phase === 'liar-reveal'
        ? 'Time is up — this round already resolved'
        : 'Cannot bid now — bidding is closed');
    }
    if (!pre.players.some(p => p.id === socket.id)) {
      return done(false, 'You are not in this room');
    }
    if (pre.liarState.toActId !== socket.id) {
      return done(false, 'Wait your turn to bid');
    }
    if (!Number.isInteger(qty) || !Number.isInteger(face) || face < 1 || face > 6) {
      return done(false, 'Invalid bid — face must be 1-6');
    }
    const totalDice = (pre.liarState.diceEach || 3) * pre.players.length;
    if (!Number.isInteger(qty) || qty < 1 || qty > totalDice) {
      return done(false, `Invalid bid — quantity must be 1-${totalDice}`);
    }
    const last = pre.liarState.bids[pre.liarState.bids.length - 1];
    if (last && !(qty > last.qty || (qty === last.qty && face > last.face))) {
      return done(false, 'Bid must raise quantity or face');
    }
    if (pre.timerEnd && Date.now() > pre.timerEnd) {
      return done(false, 'Time is up — your bid expired');
    }
    const room = submitLiarBid(roomCode, socket.id, qty, face);
    if (!room) return done(false, 'Bid not accepted — wait your turn or raise the bid');
    clearRoomTimer(roomCode);
    broadcastRoomState(room);
    const ms = Math.max(0, (room.timerEnd ?? Date.now() + LIAR_BID_SEC_VALUE * 1000) - Date.now());
    setRoomTimer(roomCode, ms, () => {
      clearRoomTimer(roomCode);
      try {
        const r = expireLiarBid(roomCode);
        if (r) broadcastRoomState(r);
      } catch (e) {
        console.error('[timer] expireLiarBid failed', e);
      }
    });
    return done(true);
  });

  socket.on('submit-liar-call', (data = {}, ack = null) => {
    const done = beginAction(socket, 'submit-liar-call', data, ack, getRoom);
    if (!done) return;
    const { roomCode, kind } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const room = resolveLiarCall(roomCode, socket.id, kind);
    if (!room) return done(false, 'Cannot call now');
    clearRoomTimer(roomCode);
    broadcastRoomState(room);
    return done(true);
  });

  socket.on('next-liar-round', (data = {}, ack = null) => {
    const done = beginAction(socket, 'next-liar-round', data, ack, getRoom);
    if (!done) return;
    const { roomCode } = data;
    const room = getRoom(roomCode);
    if (!room || !isHost(room, socket.id)) return done(false, 'Only host can advance the round');
    clearRoomTimer(roomCode);
    const next = nextLiarRound(roomCode);
    if (!next) return done(false, 'Cannot advance the round now');
    if (next.phase === 'end') {
      broadcastRoomState(next);
      return done(true);
    }
    startLiarBidPhase(roomCode);
    return done(true);
  });

  socket.on('submit-bluff-action', (data = {}, ack = null) => {
    const done = beginAction(socket, 'submit-bluff-action', data, ack, getRoom);
    if (!done) return;
    const { roomCode, action } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const room = submitBluffAction(roomCode, socket.id, action);
    if (!room) return done(false, 'Cannot act now');
    clearRoomTimer(roomCode);
    if (room.phase === 'bluff-reveal') {
      broadcastRoomState(room);
      return done(true);
    }
    broadcastRoomState(room);
    setRoomTimer(roomCode, BLUFF_BET_SEC_VALUE * 1000, () => {
      clearRoomTimer(roomCode);
      const r = expireBluffBet(roomCode);
      if (r) broadcastRoomState(r);
    });
    return done(true);
  });

  socket.on('next-bluff-round', (data = {}, ack = null) => {
    const done = beginAction(socket, 'next-bluff-round', data, ack, getRoom);
    if (!done) return;
    const { roomCode } = data;
    const room = getRoom(roomCode);
    if (!room || !isHost(room, socket.id)) return done(false, 'Only host can advance the round');
    clearRoomTimer(roomCode);
    const next = nextBluffRound(roomCode);
    if (!next) return done(false, 'Cannot advance the round now');
    if (next.phase === 'end') {
      broadcastRoomState(next);
      return done(true);
    }
    startBluffBetPhase(roomCode);
    return done(true);
  });

  socket.on('submit-territory-pick', (data = {}, ack = null) => {
    const done = beginAction(socket, 'submit-territory-pick', data, ack, getRoom);
    if (!done) return;
    const { roomCode, colIndex } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const result = submitTerritoryPick(roomCode, socket.id, colIndex);
    if (!result) return done(false, 'Cannot submit pick now');
    if (result.error) {
      if (result.membershipLost) {
        if (result.room) broadcastRoomState(result.room);
        socket.emit('membership-lost', { roomCode, reason: result.error, rejoin: true });
      }
      return done(false, result.error);
    }
    broadcastRoomState(result.room);
    if (!result.room?.territoryState?.extremeMode && result.resolved && result.room?.phase === 'territory-turn') {
      clearRoomTimer(roomCode);
      armTerritoryTurnTimer(roomCode);
    }
    return done(true);
  });

  socket.on('place-territory-mine', (data = {}, ack = null) => {
    const done = beginAction(socket, 'place-territory-mine', data, ack, getRoom);
    if (!done) return;
    const { roomCode, row, col } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const result = placeTerritoryMine(roomCode, socket.id, row, col);
    if (!result) return done(false, 'Cannot place mine now');
    if (result.error) {
      if (result.membershipLost) {
        if (result.room) broadcastRoomState(result.room);
        socket.emit('membership-lost', { roomCode, reason: result.error, rejoin: true });
      }
      return done(false, result.error);
    }
    broadcastRoomState(result.room);
    return done(true);
  });

  socket.on('next-territory-turn', (data = {}, ack = null) => {
    const done = beginAction(socket, 'next-territory-turn', data, ack, getRoom);
    if (!done) return;
    const { roomCode } = data;
    const room = getRoom(roomCode);
    if (!room || !isHost(room, socket.id)) return done(false, 'Only host can skip turn');
    const next = nextTerritoryTurn(roomCode);
    if (next) {
      broadcastRoomState(next);
      if (!next?.territoryState?.extremeMode && next?.phase === 'territory-turn') {
        clearRoomTimer(roomCode);
        armTerritoryTurnTimer(roomCode);
      }
      return done(true);
    }
    return done(false, 'Cannot skip turn now');
  });

  socket.on('submit-signal', (data = {}, ack = null) => {
    const done = beginAction(socket, 'submit-signal', data, ack, getRoom);
    if (!done) return;
    const { roomCode, signal } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    if (!signal?.trim()) return done(false, 'Signal cannot be empty');
    const room = submitSignal(roomCode, socket.id, signal);
    if (!room) return done(false, 'Cannot submit signal now');

    broadcastRoomState(room);
    checkAllSubmitted(room, 'signal');
    return done(true);
  });

  socket.on('submit-guess', (data = {}, ack = null) => {
    const done = beginAction(socket, 'submit-guess', data, ack, getRoom);
    if (!done) return;
    const { roomCode, guessData } = data;
    if (!checkRateLimit(socket.id)) return done(false, 'Too many requests');
    const room = submitGuess(roomCode, socket.id, guessData);
    if (!room) return done(false, 'Cannot submit guess now');

    broadcastRoomState(room);
    checkAllSubmitted(room, 'guess');
    return done(true);
  });

  socket.on('next-round', (data = {}, ack = null) => {
    const done = beginAction(socket, 'next-round', data, ack, getRoom);
    if (!done) return;
    const { roomCode } = data;
    const room = getRoom(roomCode);
    if (!room) return done(false, 'Room not found');
    if (!isHost(room, socket.id)) return done(false, 'Only host can advance the round'); // Only host

    clearRoomTimer(roomCode);
    const next = advanceRound(roomCode);
    if (!next) return done(false, 'Cannot advance the round now');

    if (next.phase === 'end') {
      broadcastRoomState(next);
      return done(true);
    }

    // Send each player their private role for the new round
    for (const player of next.players) {
      const playerSocket = io.sockets.sockets.get(player.id);
      if (playerSocket) sendPrivateRole(playerSocket, next);
    }

    // Single atomic broadcast into the new round (startSignalPhase broadcasts
    // the signal phase to everyone at once). Avoids an intermediate
    // role-reveal frame that could desync clients.
    startSignalPhase(roomCode);
    return done(true);
  });

  socket.on('request-end-vote', (data = {}, ack = null) => {
    const done = beginAction(socket, 'request-end-vote', data, ack, getRoom);
    if (!done) return;
    const { roomCode } = data;
    const result = startEndVote(roomCode, socket.id);
    if (result.error) {
      if (result.membershipLost) {
        if (result.room) broadcastRoomState(result.room);
        socket.emit('membership-lost', { roomCode, reason: result.error, rejoin: true });
      }
      return done(false, result.error);
    }
    if (result.passed) clearRoomTimer(roomCode);
    broadcastRoomState(result.room);
    return done(true);
  });

  socket.on('submit-end-vote', (data = {}, ack = null) => {
    const done = beginAction(socket, 'submit-end-vote', data, ack, getRoom);
    if (!done) return;
    const { roomCode, agree } = data;
    const result = submitEndVote(roomCode, socket.id, agree !== false);
    if (result.error) {
      if (result.membershipLost) {
        if (result.room) broadcastRoomState(result.room);
        socket.emit('membership-lost', { roomCode, reason: result.error, rejoin: true });
      }
      return done(false, result.error);
    }
    if (result.failed) {
      io.to(roomCode).emit('end-vote-failed', { declinedBy: result.declinedBy });
    }
    if (result.passed) clearRoomTimer(roomCode);
    broadcastRoomState(result.room);
    return done(true);
  });

  socket.on('cancel-end-vote', (data = {}, ack = null) => {
    const done = beginAction(socket, 'cancel-end-vote', data, ack, getRoom);
    if (!done) return;
    const { roomCode } = data;
    const room = cancelEndVote(roomCode, socket.id);
    if (room) broadcastRoomState(room);
    return done(true);
  });

  // Host-only force advance / end round. Aliased under several event names so
  // a stalled phase is recoverable regardless of which control triggered it.
  function handleForceAdvance(socket, evt, data, ack) {
    const done = beginAction(socket, evt, data, ack, getRoom);
    if (!done) return;
    const { roomCode } = data || {};
    const room = getRoom(roomCode);
    if (!room) return done(false, 'Room not found');
    if (!isHost(room, socket.id)) return done(false, 'Only host can force advance');
    clearRoomTimer(roomCode);
    const updated = forceAdvance(roomCode, socket.id);
    if (!updated) return done(false, 'Cannot advance now');
    broadcastRoomState(updated);
    return done(true);
  }
  for (const evt of ['force-advance', 'force-advance-round', 'forceAdvance', 'force-advance-phase', 'end-round', 'endRound', 'skip-phase', 'resolve-phase', 'force-round', 'end-current-round']) {
    socket.on(evt, (data = {}, ack = null) => handleForceAdvance(socket, evt, data, ack));
  }

  socket.on('play-again', (data = {}, ack = null) => {
    const done = beginAction(socket, 'play-again', data, ack, getRoom);
    if (!done) return;
    const { roomCode } = data;
    const room = getRoom(roomCode);
    if (!room) return done(false, 'Room not found');
    if (!isHost(room, socket.id)) return done(false, 'Only host can return everyone to the lobby');

    // Reset scores, go back to lobby (clear all game modes)
    resetToLobby(room);
    clearRoomTimer(roomCode);
    broadcastRoomState(room);
    return done(true);
  });

  socket.on('disconnect', (reason) => {
    logger.socket.disconnect(socket.id, reason);
    // Capture host authority before migration so we can notify clients if it
    // moves. Single source of truth: room.hostId.
    let oldHostId = null;
    for (const r of rooms.values()) {
      if (r.players.find(p => p.id === socket.id)) { oldHostId = r.hostId; break; }
    }
    const room = playerDisconnected(socket.id);
    if (room) {
      const migrated = !!oldHostId && oldHostId === socket.id && room.hostId && room.hostId !== socket.id;
      if (migrated) {
        const newHost = room.players.find(p => p.id === room.hostId);
        io.to(room.code).emit('host-changed', { newHostId: room.hostId, newHostName: newHost?.name || 'a player' });
        logger.info('host_migrated', { roomCode: room.code, from: socket.id, to: room.hostId });
      }
      broadcastRoomState(room);
      // Don't delete immediately: a backgrounded phone drops its socket for
      // seconds at a time. playerDisconnected scheduled deletion after
      // REJOIN_GRACE_MS; the periodic sweep enforces it.
      if (room.players.every(p => !p.connected)) {
        clearRoomTimer(room.code);
        logger.info('room_abandoned_grace', { roomCode: room.code, deleteAt: room.deleteAt });
      }
    }
  });

  // Reclaim a disconnected slot after a reconnect (socket ids change, so the
  // fresh socket must be mapped back onto the existing player).
  socket.on('rejoin-room', ({ roomCode, playerName } = {}) => {
    if (!checkRateLimit(socket.id)) return socket.emit('error', 'Too many requests');
    if (!playerName?.trim() || !roomCode?.trim()) return socket.emit('error', 'Name and code required');
    const code = roomCode.trim().toUpperCase();
    const roomBefore = getRoom(code);
    const oldHostId = roomBefore?.hostId || null;
    const result = rejoinRoom(code, socket.id, playerName.trim().substring(0, 20));
    if (result.error) {
      if (result.error === 'Room not found') {
        socket.emit('room-expired', { roomCode: code, reason: 'Room no longer exists (server restart or expired)' });
      }
      return socket.emit('error', result.error);
    }
    const room = result.room;
    if (oldHostId && room.hostId && oldHostId !== room.hostId) {
      const newHost = room.players.find(p => p.id === room.hostId);
      io.to(room.code).emit('host-changed', { newHostId: room.hostId, newHostName: newHost?.name || 'a player' });
    }
    logger.room.join(code, socket.id, { playerName: playerName.trim().substring(0, 20), rejoined: true });
    socket.join(code);
    socket.emit('room-joined', { roomCode: code, playerId: socket.id });
    broadcastRoomState(room);
    // Re-sync private per-player data that isn't part of the public state:
    // role assignment and the round-reveal payload. Without these a restored
    // tab can hang on "Calculating results…" or render a frozen game.
    sendPrivateRole(socket, room);
    const revealPayload = buildRevealPayload(room);
    if (revealPayload) socket.emit('round-reveal', revealPayload);
  });

  // Fresh state pull (used after reconnects and visibility returns).
  socket.on('room-state-request', ({ roomCode } = {}) => {
    if (!checkRateLimit(socket.id)) return;
    if (!roomCode) return;
    const room = getRoom(roomCode.trim().toUpperCase());
    if (!room) {
      socket.emit('room-expired', { roomCode, reason: 'Room no longer exists (server restart or expired)' });
      return;
    }
    // Full state to the requester — broadcast to ALL so everyone's view and
    // the slim mc-tick diff cache resync to the same point in time.
    broadcastRoomState(room);
    // Re-send private per-player data to the requester so a restored tab
    // doesn't lose its role or hang on the results screen.
    sendPrivateRole(socket, room);
    const reqRevealPayload = buildRevealPayload(room);
    if (reqRevealPayload) socket.emit('round-reveal', reqRevealPayload);
  });
});

// ─── Missile Command real-time tick (silo'd) ────────────────────────────
// Advances economy, healers, missiles and core regen for active games.
// Server-side simulation stays ~150ms (6.7Hz) — physics/AI cadence is
// independent of wire cadence. On the wire:
//   • events (launch, impact, build, upgrade, sell, fog, AI structural
//     changes) → full authoritative room-state (the client can always trust
//     it; diff caches resync),
//   • missiles in flight, no events → slim `mc-tick` at ~250ms (4Hz; clients
//     extrapolate between snapshots so fast missiles still glide),
//   • otherwise a ~1Hz economy heartbeat that sends a slim mc-tick ONLY when
//     the rounded economy actually changed (see bandwidth plan opts 3/4).
setInterval(() => {
  try {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.phase !== 'missile-command-play' || !room.missileCommandState) continue;
      if (room.missileCommandState.winnerId) continue;
      // Per-room isolation: one malformed room's tick must not stall every
      // OTHER room's broadcast (the old loop-wide catch skipped the rest of
      // the rooms for that tick — and every tick after it).
      try {
        const res = tickMissileRoom(room, now);
        if (!res) continue;
        const st = room.missileCommandState;
        const inFlight = (st.missiles?.length ?? 0) > 0;
        if (res.events.length > 0) {
          room.missileLastBroadcastMs = now;
          room.missileLastTickSentMs = now;
          broadcastRoomState(res.room);
        } else if (inFlight) {
          if (now - (room.missileLastTickSentMs ?? 0) >= 250) {
            room.missileLastTickSentMs = now;
            sendMcTick(room, now);
          }
        } else if (now - (room.missileLastBroadcastMs ?? 0) >= 1000) {
          // Economy heartbeat: skip when nothing visibly changed — floored
          // resources identical AND no pending building-dynamic diffs AND
          // ship presence unchanged.
          const pidA = st.sides?.top; const pidB = st.sides?.bottom;
          const sig = `${Math.floor(st.resources[pidA] ?? 0)},${Math.floor(st.resources[pidB] ?? 0)},${mcPendingDiffCount(st, room.mcDyn ?? (room.mcDyn = mcDynSnapshot(st)))},${st.supplyShip ? 1 : 0}`;
          if (sig !== (room.mcLastEconSig ?? '')) {
            room.mcLastEconSig = sig;
            room.missileLastBroadcastMs = now;
            sendMcTick(room, now);
          }
        }
      } catch (roomErr) {
        console.error('[missile-tick] room failed', room.code, roomErr);
      }
    }
  } catch (e) {
    console.error('[missile-tick] failed', e);
  }
}, 150);

// Crash evidence: an uncaught exception today kills the process (wiping all
// in-memory rooms) with nothing in the logs. Record it, then exit so the
// host restarts clean — clients detect the new bootId and say so plainly.
process.on('uncaughtException', (err) => {
  logger.error('fatal_uncaught_exception', { error: err?.message ?? String(err), stack: err?.stack });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error('fatal_unhandled_rejection', { error: err.message, stack: err.stack });
  process.exit(1);
});

httpServer.listen(PORT, () => {
  logger.info('Server started', { port: PORT, rooms: rooms.size, bootId: BOOT_ID });
  console.log(`🎮 Hidden Signal server running on port ${PORT}`);
});
