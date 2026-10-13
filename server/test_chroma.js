// test_chroma.js — Chroma Shift tile-range + guess validation coverage.
// The client renders 5x5 (25) standard and 10x10 (100) extreme grids; the
// server must pick targets and accept clicks across the SAME ranges.
// Run with: npm test  (node --test test_*.js)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rooms,
  createRoom,
  joinRoom,
  selectGame,
  updateChromaOptions,
  startGame,
  submitChromaGuess,
  resolveChromaRace,
  nextChromaRound,
  playerDisconnected,
} from './gameManager.js';

function chromaRoom(extreme = false) {
  for (const code of [...rooms.keys()]) rooms.delete(code);
  const room = createRoom('sock-host', 'HOST');
  joinRoom(room.code, 'sock-p2', 'P2');
  selectGame(room.code, 'chroma-shift');
  if (extreme) {
    const updated = updateChromaOptions(room.code, { extremeMode: true });
    assert.ok(updated, 'extreme mode accepted');
  }
  const started = startGame(room.code);
  assert.ok(started, 'chroma game starts');
  assert.equal(room.phase, 'chroma-play');
  return room;
}

test('standard grid: target in 0..24, edge tiles accepted, 25 rejected', () => {
  const room = chromaRoom(false);
  for (let r = 0; r < 30; r++) {
    startGame(room.code);
    const t = room.chromaState.targetTileIndex;
    assert.ok(Number.isInteger(t) && t >= 0 && t < 25, `target ${t} in range`);
  }
  const target = room.chromaState.targetTileIndex;
  const res = submitChromaGuess(room.code, 'sock-host', target);
  assert.ok(res && res.correct, 'correct guess accepted');
  assert.ok(res.raceStarted, 'first finder opens the 10s race');
  assert.equal(room.phase, 'chroma-play', 'phase stays in play during the race');
  assert.ok(room.chromaState.raceEndAt, 'race deadline set');
  assert.equal(room.chromaState.solvers.length, 1, 'first solver recorded');
  // Second solver finds it during the race for half points.
  const half = submitChromaGuess(room.code, 'sock-p2', target);
  assert.ok(half && half.correct && half.raceSolved, 'second solver gets half points');
  const revealed = resolveChromaRace(room.code);
  assert.ok(revealed, 'race resolves');
  assert.equal(room.phase, 'chroma-reveal', 'race timeout moves to reveal');
  const nx = nextChromaRound(room.code);
  assert.equal(nx.round, 2, 'round advances');
  assert.ok(submitChromaGuess(room.code, 'sock-host', 24) !== null, 'tile 24 clickable');
  assert.equal(submitChromaGuess(room.code, 'sock-host', 25), null, 'tile 25 rejected');
  assert.equal(submitChromaGuess(room.code, 'sock-host', -1), null, 'negative rejected');
});

test('extreme grid: target in 0..99, all 100 tiles clickable', () => {
  const room = chromaRoom(true);
  for (let r = 0; r < 30; r++) {
    startGame(room.code);
    const t = room.chromaState.targetTileIndex;
    assert.ok(Number.isInteger(t) && t >= 0 && t < 100, `target ${t} in 0..99`);
  }
  const target = room.chromaState.targetTileIndex;
  const res = submitChromaGuess(room.code, 'sock-host', target);
  assert.ok(res && res.correct, 'correct guess accepted');
  assert.ok(res.raceStarted, 'first finder opens the 10s race');
  assert.equal(room.phase, 'chroma-play', 'phase stays in play during the race');
  const revealed = resolveChromaRace(room.code);
  assert.ok(revealed, 'race resolves');
  assert.equal(room.phase, 'chroma-reveal', 'race timeout moves to reveal');
  const nx = nextChromaRound(room.code);
  assert.equal(nx.round, 2, 'round advances');
  const res99 = submitChromaGuess(room.code, 'sock-host', 99);
  assert.ok(res99 !== null, 'tile 99 clickable (was silently dropped when server used 64)');
  assert.equal(submitChromaGuess(room.code, 'sock-host', 100), null, 'tile 100 rejected');
});

test('joinRoom reclaims a disconnected same-name slot instead of duplicating', () => {
  for (const code of [...rooms.keys()]) rooms.delete(code);
  const room = createRoom('sock-host', 'HOST');
  joinRoom(room.code, 'sock-p2', 'P2');
  assert.equal(room.players.length, 2);
  // P2 backgrounds the phone: socket drops.
  playerDisconnected('sock-p2');
  assert.equal(room.players.find(p => p.name === 'P2').connected, false);
  // P2 refreshes and hits Join (not rejoin): slot reclaimed, no duplicate.
  const res = joinRoom(room.code, 'sock-p2-new', 'P2');
  assert.ok(!res.error, res.error);
  assert.ok(res.reclaimed, 'reclaim flagged');
  assert.equal(room.players.length, 2, 'no duplicate entry');
  const p = room.players.find(p => p.name === 'P2');
  assert.equal(p.id, 'sock-p2-new', 'id remapped');
  assert.equal(p.connected, true);
});

test('joinRoom reclaim preserves score and remaps game-state ids', () => {
  for (const code of [...rooms.keys()]) rooms.delete(code);
  const room = createRoom('sock-host', 'HOST');
  joinRoom(room.code, 'sock-p2', 'P2');
  room.players.find(p => p.id === 'sock-p2').score = 7;
  room.chromaOptions.playerDifficulties = { 'sock-p2': 'hard' };
  playerDisconnected('sock-p2');
  joinRoom(room.code, 'sock-p2-new', 'P2');
  const p = room.players.find(p => p.name === 'P2');
  assert.equal(p.score, 7, 'score kept on reclaimed slot');
  assert.equal(room.chromaOptions.playerDifficulties['sock-p2-new'], 'hard', 'difficulty remapped');
  assert.ok(!('sock-p2' in room.chromaOptions.playerDifficulties), 'old id gone');
});

test('joinRoom still rejects full/in-progress/missing rooms and fresh names push', () => {
  for (const code of [...rooms.keys()]) rooms.delete(code);
  const room = createRoom('sock-host', 'HOST');
  assert.ok(joinRoom('ZZZZ', 'sock-x', 'X').error, 'missing room rejected');
  const ok = joinRoom(room.code, 'sock-new', 'NEWBIE');
  assert.ok(!ok.error && !ok.reclaimed, 'fresh name pushes normally');
  assert.equal(room.players.length, 2);
  // Claim the slot while connected must NOT steal it.
  const steal = joinRoom(room.code, 'sock-impostor', 'NEWBIE');
  assert.ok(!steal.error, 'connected duplicate name still joins (distinct player)');
  assert.equal(room.players.length, 3);
});
