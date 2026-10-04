// logger.js — Structured logging for Hidden Signal server

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const CURRENT_LEVEL = process.env.LOG_LEVEL 
  ? LOG_LEVELS[process.env.LOG_LEVEL.toLowerCase()] ?? 1 
  : (process.env.NODE_ENV === 'production' ? 1 : 0);

function formatMessage(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const base = { timestamp, level, message, ...meta };
  return JSON.stringify(base);
}

function shouldLog(level) {
  return LOG_LEVELS[level] >= CURRENT_LEVEL;
}

export const logger = {
  debug(message, meta) {
    if (shouldLog('debug')) console.log(formatMessage('debug', message, meta));
  },
  
  info(message, meta) {
    if (shouldLog('info')) console.log(formatMessage('info', message, meta));
  },
  
  warn(message, meta) {
    if (shouldLog('warn')) console.warn(formatMessage('warn', message, meta));
  },
  
  error(message, meta) {
    if (shouldLog('error')) console.error(formatMessage('error', message, meta));
  },

  // Socket.io specific loggers
  socket: {
    connect(socketId, meta) {
      logger.info('socket_connect', { socketId, ...meta });
    },
    disconnect(socketId, reason, meta) {
      logger.info('socket_disconnect', { socketId, reason, ...meta });
    },
    error(socketId, error, meta) {
      logger.error('socket_error', { socketId, error: error?.message ?? error, ...meta });
    },
    event(socketId, eventName, data, meta) {
      logger.debug('socket_event', { socketId, event: eventName, data, ...meta });
    },
  },

  // Room lifecycle
  room: {
    create(roomCode, hostId, meta) {
      logger.info('room_create', { roomCode, hostId, ...meta });
    },
    join(roomCode, playerId, meta) {
      logger.info('room_join', { roomCode, playerId, ...meta });
    },
    leave(roomCode, playerId, meta) {
      logger.info('room_leave', { roomCode, playerId, ...meta });
    },
    delete(roomCode, meta) {
      logger.info('room_delete', { roomCode, ...meta });
    },
    stateChange(roomCode, oldPhase, newPhase, meta) {
      logger.info('room_phase_change', { roomCode, oldPhase, newPhase, ...meta });
    },
  },

  // Game events
  game: {
    action(roomCode, gameId, action, playerId, data, meta) {
      logger.info('game_action', { roomCode, gameId, action, playerId, data, ...meta });
    },
    score(roomCode, playerId, points, reason, meta) {
      logger.info('game_score', { roomCode, playerId, points, reason, ...meta });
    },
    phaseChange(roomCode, oldPhase, newPhase, meta) {
      logger.info('game_phase_change', { roomCode, oldPhase, newPhase, ...meta });
    },
  },

  // Connection health
  health: {
    check(status, meta) {
      logger.info('health_check', { status, ...meta });
    },
    rateLimit(socketId, meta) {
      logger.warn('rate_limit_exceeded', { socketId, ...meta });
    },
    cors(origin, allowed, meta) {
      logger.warn('cors_blocked', { origin, allowed, ...meta });
    },
  },

  // Performance
  perf: {
    timer(label, durationMs, meta) {
      logger.debug('perf_timer', { label, durationMs, ...meta });
    },
    memory(meta) {
      const mem = process.memoryUsage();
      logger.debug('perf_memory', { 
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + 'MB',
        rss: Math.round(mem.rss / 1024 / 1024) + 'MB',
        ...meta 
      });
    },
  },
};

// Periodic memory logging (every 5 min)
if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    logger.perf.memory({ interval: '5min' });
  }, 5 * 60 * 1000);
}

export default logger;