// test_action_ack.js — Task 1: server-acknowledged actions everywhere.
// Coverage: beginAction stores { ok, error } per (event, requestId), replays
// duplicates without re-running the handler, expires entries, and prunes the
// per-room log. Run with: npm test  (node --test test_*.js)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beginAction, idemKey, pruneIdempotencyLog } from './actionAck.js';
import { rooms, createRoom, joinRoom } from './gameManager.js';

function fakeSocket(id) {
  return { id };
}

function freshRoom() {
  for (const code of [...rooms.keys()]) rooms.delete(code);
  const room = createRoom('sock-alpha', 'ALPHA');
  joinRoom(room.code, 'sock-bravo', 'BRAVO');
  return room;
}

function harness(room, socket) {
  return (event, data, handlers = {}) => {
    let ackResult = null;
    const done = beginAction(
      socket,
      event,
      data,
      (result) => { ackResult = result; },
      (code) => rooms.get(code),
    );
    if (!done) return { duplicate: true, ack: ackResult };
    // Simulate a handler: record side effects, then report.
    handlers.onRun?.();
    if (handlers.reject) return void done(false, handlers.reject);
    return void done(true);
  };
}

test('successful action acks ok and is recorded in the room log', () => {
  const room = freshRoom();
  const socket = fakeSocket('sock-alpha');
  let ran = 0;
  const run = harness(room, socket);
  run('submit-signal', { roomCode: room.code, requestId: 'r1' }, { onRun: () => ran++ });
  assert.equal(ran, 1, 'handler ran exactly once');
  const entry = room.idempotencyLog.get(idemKey('submit-signal', 'r1'));
  assert.ok(entry, 'result stored');
  assert.equal(entry.ok, true);
});

test('duplicate requestId replays stored result instead of re-running the handler', () => {
  const room = freshRoom();
  const socket = fakeSocket('sock-alpha');
  let ran = 0;
  const run = harness(room, socket);
  const first = run('submit-territory-pick', { roomCode: room.code, requestId: 'r2' }, { onRun: () => ran++ });
  const second = run('submit-territory-pick', { roomCode: room.code, requestId: 'r2' });
  assert.equal(ran, 1, 'handler must NOT run twice for the same requestId');
  assert.equal(first, undefined, 'first call had no stored answer at call time');
  assert.ok(second.duplicate, 'second call flagged duplicate');
  assert.equal(second.ack.ok, true, 'stored ok result replayed');
});

test('duplicate of a rejected action replays the stored error', () => {
  const room = freshRoom();
  const socket = fakeSocket('sock-alpha');
  const run = harness(room, socket);
  run('submit-guess', { roomCode: room.code, requestId: 'r3' }, { reject: 'Cannot submit guess now' });
  const again = run('submit-guess', { roomCode: room.code, requestId: 'r3' });
  assert.ok(again.duplicate);
  assert.equal(again.ack.ok, false);
  assert.equal(again.ack.error, 'Cannot submit guess now');
});

test('a different requestId is never treated as a duplicate', () => {
  const room = freshRoom();
  const socket = fakeSocket('sock-alpha');
  let ran = 0;
  const run = harness(room, socket);
  run('submit-liar-bid', { roomCode: room.code, requestId: 'r4' }, { onRun: () => ran++ });
  run('submit-liar-bid', { roomCode: room.code, requestId: 'r5' }, { onRun: () => ran++ });
  assert.equal(ran, 2, 'distinct requestIds each run');
});

test('the same requestId on a different event is not a duplicate', () => {
  const room = freshRoom();
  const socket = fakeSocket('sock-alpha');
  let ran = 0;
  const run = harness(room, socket);
  run('submit-signal', { roomCode: room.code, requestId: 'r6' }, { onRun: () => ran++ });
  run('submit-guess', { roomCode: room.code, requestId: 'r6' }, { onRun: () => ran++ });
  assert.equal(ran, 2);
});

test('expired idempotency entries are re-runnable and pruned', () => {
  const room = freshRoom();
  const socket = fakeSocket('sock-alpha');
  let ran = 0;
  const run = harness(room, socket);
  run('submit-signal', { roomCode: room.code, requestId: 'r7' }, { onRun: () => ran++ });
  pruneIdempotencyLog(room.idempotencyLog, Date.now() + 61_000);
  assert.equal(room.idempotencyLog.size, 0, 'expired entry pruned');
  run('submit-signal', { roomCode: room.code, requestId: 'r7' }, { onRun: () => ran++ });
  assert.equal(ran, 2, 'expired key allowed a fresh run (client only retries within the TTL window)');
});

test('actions without requestId or roomCode still ack but are not cached', () => {
  const room = freshRoom();
  const socket = fakeSocket('sock-alpha');
  const run = harness(room, socket);
  run('cancel-end-vote', { roomCode: room.code }, { reject: 'Cannot cancel now' });
  run('cancel-end-vote', { roomCode: room.code }, { reject: 'Cannot cancel now' });
  // No idempotency log entry without a requestId — that's expected: fire and
  // forget calls must still ack, they just can't be deduped.
  assert.ok(![...room.idempotencyLog?.keys() ?? []].some(k => k.includes('cancel-end-vote')));
});

test('rejections are acked with ok:false and the server reason', () => {
  const room = freshRoom();
  const socket = fakeSocket('sock-alpha');
  let ack = null;
  const done = beginAction(
    socket,
    'submit-territory-pick',
    { roomCode: room.code, requestId: 'r8' },
    (r) => { ack = r; },
    (code) => rooms.get(code),
  );
  done(false, 'Cannot submit pick now');
  assert.equal(ack.ok, false);
  assert.equal(ack.error, 'Cannot submit pick now');
});
