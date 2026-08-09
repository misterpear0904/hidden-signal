// index.js — Express + Socket.io server for Hidden Signal

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import {
  createRoom,
  joinRoom,
  getRoom,
  getRoomByPlayerId,
  startGame,
  advanceToSignal,
  advanceToDiscuss,
  advanceToGuess,
  submitSignal,
  submitGuess,
  resolveRound,
  advanceRound,
  playerDisconnected,
  deleteRoom,
  SIGNAL_TIME_SEC,
  DISCUSS_TIME_SEC,
  GUESS_TIME_SEC,
} from './gameManager.js';

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
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

// Sanitize room data for broadcast (strip secrets by player)
function roomPublicState(room) {
  return {
    code: room.code,
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
  io.to(room.code).emit('room-state', roomPublicState(room));
}

function startSignalPhase(code) {
  const room = advanceToGuess(code);
  if (!room) return;
  broadcastRoomState(room);
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
  console.log(`[connect] ${socket.id}`);

  socket.on('create-room', ({ playerName }) => {
    if (!playerName?.trim()) return socket.emit('error', 'Name required');
    const room = createRoom(socket.id, playerName.trim().substring(0, 20));
    socket.join(room.code);
    socket.emit('room-joined', { roomCode: room.code, playerId: socket.id });
    broadcastRoomState(room);
  });

  socket.on('join-room', ({ roomCode, playerName }) => {
    if (!playerName?.trim() || !roomCode?.trim()) return socket.emit('error', 'Name and code required');
    const result = joinRoom(roomCode.toUpperCase(), socket.id, playerName.trim().substring(0, 20));
    if (result.error) return socket.emit('error', result.error);

    socket.join(roomCode.toUpperCase());
    socket.emit('room-joined', { roomCode: roomCode.toUpperCase(), playerId: socket.id });
    broadcastRoomState(result.room);
  });

  socket.on('start-game', ({ roomCode }) => {
    const room = getRoom(roomCode);
    if (!room) return socket.emit('error', 'Room not found');
    if (room.players[0].id !== socket.id) return socket.emit('error', 'Only the host can start');
    if (room.players.length < 4) return socket.emit('error', 'Need at least 4 players');

    const started = startGame(roomCode);
    if (!started) return socket.emit('error', 'Could not start game');

    broadcastRoomState(started);

    // Send each player their private role
    for (const player of started.players) {
      const playerSocket = io.sockets.sockets.get(player.id);
      if (playerSocket) sendPrivateRole(playerSocket, started);
    }

    startSignalPhase(roomCode);
  });

  socket.on('submit-signal', ({ roomCode, signal }) => {
    if (!signal?.trim()) return socket.emit('error', 'Signal cannot be empty');
    const room = submitSignal(roomCode, socket.id, signal);
    if (!room) return socket.emit('error', 'Cannot submit signal now');

    socket.emit('signal-accepted');
    broadcastRoomState(room);
    checkAllSubmitted(room, 'signal');
  });

  socket.on('submit-guess', ({ roomCode, guessData }) => {
    const room = submitGuess(roomCode, socket.id, guessData);
    if (!room) return socket.emit('error', 'Cannot submit guess now');

    socket.emit('guess-accepted');
    autoResolveRound(roomCode);
  });

  socket.on('next-round', ({ roomCode }) => {
    const room = getRoom(roomCode);
    if (!room) return;
    if (room.players[0].id !== socket.id) return; // Only host

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

  socket.on('play-again', ({ roomCode }) => {
    const room = getRoom(roomCode);
    if (!room) return;
    if (room.players[0].id !== socket.id) return;

    // Reset scores, go back to lobby
    for (const p of room.players) p.score = 0;
    room.phase = 'lobby';
    room.round = 0;
    room.roles = [];
    room.hiddenPairIds = [];
    room.secretCode = null;
    room.signals = [];
    room.guesses = [];
    clearRoomTimer(roomCode);
    broadcastRoomState(room);
  });

  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`);
    const room = playerDisconnected(socket.id);
    if (room) {
      broadcastRoomState(room);
      // Clean up empty rooms
      if (room.players.every(p => !p.connected)) {
        clearRoomTimer(room.code);
        deleteRoom(room.code);
        console.log(`[cleanup] Room ${room.code} deleted`);
      }
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`🎮 Hidden Signal server running on http://localhost:${PORT}`);
});
