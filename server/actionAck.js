// actionAck.js — idempotency + acknowledgment plumbing for client→server
// game actions (Task 1: server-acknowledged actions everywhere).
//
// Contract: every game action event may carry a client-generated `requestId`
// (idempotency key) and a socket.io ack callback. Handlers call
//
//   const done = beginAction(socket, EVENT, data, ack);
//   if (!done) return;          // duplicate — already answered + logged
//   ...
//   return done(true);          // processed (broadcastRoomState already sent)
//   // or: return done(false, 'reason');
//
// On duplicate requestId (client retry after a lost ack), the stored result is
// replayed and the event is logged as a duplicate so retries can't double-apply.

import { logger } from './logger.js';

const IDEM_TTL_MS = 60_000;      // how long a processed result is remembered
const IDEM_MAX_ENTRIES = 500;    // hard cap per room (safety valve)

export function idemKey(event, requestId) {
  return `${event}|${requestId}`;
}

// Opportunistic prune: drop expired entries, enforce the size cap.
export function pruneIdempotencyLog(map, now = Date.now()) {
  for (const [key, entry] of map) {
    if (now - entry.at > IDEM_TTL_MS) map.delete(key);
  }
  while (map.size > IDEM_MAX_ENTRIES) {
    const first = map.keys().next().value;
    map.delete(first);
  }
}

/**
 * Begin processing an action. Returns a `done(ok, error?)` function that
 * stores the result in the room's idempotency log (if a requestId and room
 * are known) and answers the client's ack — or null when this exact action
 * was already processed, in which case the stored result was replayed and the
 * handler must NOT run.
 */
export function beginAction(socket, event, data = {}, ack = null, getRoom = null) {
  if (typeof ack !== 'function') ack = null;
  const requestId =
    typeof data?.requestId === 'string' && data.requestId.length > 0 && data.requestId.length <= 128
      ? data.requestId
      : null;
  const roomCode =
    typeof data?.roomCode === 'string' ? data.roomCode.trim().toUpperCase() : null;

  // Duplicate check: same sessionId/event/requestId already processed.
  if (requestId && roomCode && getRoom) {
    const room = getRoom(roomCode);
    const log = room?.idempotencyLog;
    if (log) {
      const key = idemKey(event, requestId);
      const prior = log.get(key);
      if (prior) {
        if (Date.now() - prior.at <= IDEM_TTL_MS) {
          logger.warn('action_duplicate', {
            event, roomCode, requestId, socketId: socket.id,
            priorOk: prior.ok, ageMs: Date.now() - prior.at,
          });
          ack?.(prior.ok ? { ok: true, duplicate: true } : { ok: false, error: prior.error, duplicate: true });
          return null;
        }
        log.delete(key);
      }
    }
  }

  const done = (ok, error = null) => {
    const result = ok ? { ok: true } : { ok: false, error: error ?? 'Action rejected' };
    if (requestId && roomCode && getRoom) {
      const room = getRoom(roomCode);
      if (room) {
        if (!room.idempotencyLog) room.idempotencyLog = new Map();
        room.idempotencyLog.set(idemKey(event, requestId), {
          at: Date.now(), ok: !!ok, error: result.error,
        });
        pruneIdempotencyLog(room.idempotencyLog);
      }
    }
    if (!ok) {
      // Observable in production: submissions the server refused to record.
      logger.warn('action_rejected', {
        event, roomCode, requestId, socketId: socket.id, error: result.error,
      });
    }
    ack?.(result);
    return result;
  };
  return done;
}
