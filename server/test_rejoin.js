// test_rejoin.js — reconnect/rejoin coverage: backgrounding a phone must not
// kill the room or lock the player out with "You are not in this match".
// Run with: npm test  (node --test test_*.js)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rooms,
  createRoom,
  joinRoom,
  selectGame,
  startGame,
  playerDisconnected,
  rejoinRoom,
  sweepInactiveRooms,
  buildMissileBuilding,
  loadMissile,
  REJOIN_GRACE_MS,
} from './gameManager.js';

function twoPlayerLobby() {
  for (const code of [...rooms.keys()]) rooms.delete(code);
  const room = createRoom('sock-alpha', 'ALPHA');
  const joined = joinRoom(room.code, 'sock-bravo', 'BRAVO');
  assert.ok(!joined.error, joined.error);
  return room;
}

test('rejoin reclaims a disconnected lobby slot with the new socket id', () => {
  const room = twoPlayerLobby();
  playerDisconnected('sock-bravo');
  assert.equal(room.players.find(p => p.name === 'BRAVO').connected, false);
  const r = rejoinRoom(room.code, 'sock-bravo-2', 'BRAVO');
  assert.ok(!r.error, r.error);
  assert.equal(r.playerId, 'sock-bravo-2');
  assert.equal(room.players.length, 2, 'no duplicate slot');
  const p = room.players.find(p => p.name === 'BRAVO');
  assert.equal(p.id, 'sock-bravo-2');
  assert.equal(p.connected, true);
});

test('rejoin rejects unknown names and connected slots', () => {
  const room = twoPlayerLobby();
  playerDisconnected('sock-bravo');
  assert.ok(rejoinRoom(room.code, 'sock-x', 'NOBODY').error, 'unknown name rejected');
  assert.ok(rejoinRoom(room.code, 'sock-x', 'ALPHA').error, 'connected slot cannot be hijacked');
  assert.ok(rejoinRoom('ZZZZ', 'sock-x', 'BRAVO').error, 'missing room rejected');
});

test('abandoned rooms survive inside the grace window, sweep deletes after', () => {
  const room = twoPlayerLobby();
  const t0 = Date.now();
  playerDisconnected('sock-alpha');
  playerDisconnected('sock-bravo');
  assert.ok(room.deleteAt > t0, 'deletion scheduled');
  assert.equal(room.deleteAt, t0 + REJOIN_GRACE_MS, 'grace window honored');
  assert.ok(rooms.has(room.code), 'room kept immediately after drop');
  sweepInactiveRooms(t0 + REJOIN_GRACE_MS - 1000);
  assert.ok(rooms.has(room.code), 'room kept inside grace window');
  sweepInactiveRooms(t0 + REJOIN_GRACE_MS + 1000);
  assert.ok(!rooms.has(room.code), 'room swept after grace expires');
});

test('rejoin clears pending deletion', () => {
  const room = twoPlayerLobby();
  playerDisconnected('sock-alpha');
  playerDisconnected('sock-bravo');
  assert.ok(room.deleteAt, 'deletion scheduled');
  rejoinRoom(room.code, 'sock-alpha-2', 'ALPHA');
  assert.equal(room.deleteAt, undefined, 'grace cleared on rejoin');
  sweepInactiveRooms(Date.now() + REJOIN_GRACE_MS + 60000);
  assert.ok(rooms.has(room.code), 'room survives because someone came back');
});

test('missile mid-game rejoin remaps sides, resources, and buildings', () => {
  const room = twoPlayerLobby();
  selectGame(room.code, 'missile-command');
  const started = startGame(room.code);
  assert.ok(started, 'missile game starts');
  const mc = () => room.missileCommandState;
  assert.equal(mc().sides.bottom, 'sock-bravo');

  // BRAVO backgrounds the phone: socket drops, then comes back with new id.
  playerDisconnected('sock-bravo');
  const r = rejoinRoom(room.code, 'sock-bravo-2', 'BRAVO');
  assert.ok(!r.error, r.error);
  assert.equal(mc().sides.bottom, 'sock-bravo-2', 'side remapped');
  assert.ok('sock-bravo-2' in mc().resources, 'resource wallet remapped');
  assert.ok(!('sock-bravo' in mc().resources), 'old wallet gone');

  // The exact failure from the bug report: actions with the new id must work.
  const b = buildMissileBuilding(room.code, 'sock-bravo-2', { buildingType: 'economy', gx: 0, gy: 0 });
  assert.ok(!b.error, b.error ?? 'build works with new id (no "not in this match")');
  assert.ok(b.pending, 'construction site queued for remapped id');
  assert.equal(b.pending.ownerId, 'sock-bravo-2', 'site owned by remapped id');
});
