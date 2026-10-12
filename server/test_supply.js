// test_supply.js — neutral supply freighter: net-worth scaling, payouts,
// spawn schedule, claim validation, lobby plumbing.
// Run with: npm test  (node --test test_*.js)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MISSILE_CONFIG,
  createMissileCommandState,
  missileBuildBuilding,
  missileClaimShip,
  netWorthFor,
  supplyScaleFor,
  tickMissileCommand,
} from './missileCommand.js';
import {
  rooms,
  createRoom,
  joinRoom,
  selectGame,
  startGame,
  updateMissileCommandOptions,
  claimSupplyShip,
} from './gameManager.js';

const P1 = 'p1-top';
const P2 = 'p2-bottom';

// --- controllable clock: the module calls Date.now() for timers ---
const realNow = Date.now;
let fakeNow = 1_700_000_100_000;
Date.now = () => fakeNow;
const advance = (ms, state) => { fakeNow += ms; return tickMissileCommand(state, fakeNow); };
const freshShip = (extra = {}) =>
  createMissileCommandState([P1, P2], { startingResources: 5000, supplyShip: true, ...extra });

function materialize(s, playerId, type, gx, gy, launcherType) {
  const r = missileBuildBuilding(s, playerId, { buildingType: type, launcherType, gx, gy });
  assert.ok(!r.error, r.error);
  advance(3100, s);
  return Object.values(s.buildings).find(b => b.ownerId === playerId && b.type === type && b.gx === gx && b.gy === gy);
}

// Deterministic Math.random from a fixed sequence (cycles when exhausted).
const realRandom = Math.random;
function stubRandom(values) {
  let i = 0;
  Math.random = () => values[i++ % values.length];
}
function varied(n) {
  const out = [];
  let s = 0.37;
  for (let k = 0; k < n; k++) { s = (s * 7919 + 0.13) % 1; out.push(s); }
  return out;
}

test('net worth sums invested value, cores excluded', () => {
  const s = freshShip();
  assert.equal(netWorthFor(s, P1), 0, 'cores cost nothing');
  materialize(s, P1, 'economy', 0, 0);
  materialize(s, P2, 'economy', 1, 0);
  materialize(s, P2, 'economy', 2, 0);
  assert.equal(netWorthFor(s, P1), 50);
  assert.equal(netWorthFor(s, P2), 100);
});

test('payout scale clamps 0.5x–2x on the disparity ratio', () => {
  assert.equal(supplyScaleFor(100, 100), 1, 'even game, even payouts');
  assert.equal(supplyScaleFor(50, 100), 2, '2:1 behind → max boost');
  assert.equal(supplyScaleFor(100, 50), 0.5, '2:1 ahead → floor');
  assert.equal(supplyScaleFor(0, 100), 2, 'broke player gets max, no div-by-zero');
  assert.equal(supplyScaleFor(100, 0), 0.5, 'rich vs broke floors');
  assert.equal(supplyScaleFor(10, 100), 2, '10:1 clamps at 2x');
});

test('ships sail on schedule and sail away unclaimed', () => {
  const s = freshShip();
  assert.equal(s.supplyShip, null, 'no ship at game start');
  advance(MISSILE_CONFIG.supplyShip.firstShipMs, s);
  assert.ok(s.supplyShip, 'first sailing on schedule');
  assert.ok([-1, 1].includes(s.supplyShip.dir), 'valid direction');
  assert.ok(s.supplyShip.endAt > fakeNow, 'claim window open');
  const id = s.supplyShip.id;
  assert.equal(id, s.supplyShip.id);
  advance(MISSILE_CONFIG.supplyShip.crossMs + 500, s);
  assert.equal(s.supplyShip, null, 'unclaimed ship sails away');
  assert.ok(s.nextShipAt > fakeNow, 'next sailing scheduled');
});

function forceShip(s) {
  s.supplyShip = {
    id: 'sh-test', dir: 1, fromX: -0.12, toX: 1.12, y: 0.5,
    startAt: fakeNow - 1000, endAt: fakeNow + 17000,
  };
}

test('credits payout scales with disparity, capped at 1000', () => {
  const s = freshShip();
  materialize(s, P1, 'economy', 0, 0); // NW 50
  materialize(s, P2, 'economy', 1, 0);
  materialize(s, P2, 'economy', 2, 0); // NW 100 → scale 2
  forceShip(s);
  stubRandom([0.1]); // credits
  try {
    const before = s.resources[P1];
    const r = missileClaimShip(s, P1);
    assert.ok(!r.error, r.error);
    assert.equal(r.supply.kind, 'credits');
    assert.equal(r.supply.detail.amount, 1000, 'min(1000, 500*2)');
    assert.equal(s.resources[P1] - before, 1000, 'paid exactly, no income noise (no tick ran)');
    assert.equal(s.supplyShip, null, 'ship consumed');
    assert.ok(s.nextShipAt > fakeNow, 'next sailing scheduled');
    assert.equal(s.lastSupply.ownerId, P1);
  } finally {
    Math.random = realRandom;
  }
});

test('barrage rains distinct random tiles with staggered launches', () => {
  const s = freshShip();
  materialize(s, P1, 'economy', 0, 0); // NW 50
  materialize(s, P2, 'economy', 1, 0); // NW 50 → scale 1
  forceShip(s);
  stubRandom([0.5, ...varied(300)]); // barrage, then varied tiles
  try {
    const r = missileClaimShip(s, P1);
    assert.ok(!r.error, r.error);
    assert.equal(r.supply.kind, 'barrage');
    const expect = Math.round(91 * 0.25); // scale 1 → 25% of 91 tiles
    assert.equal(r.supply.detail.tiles, expect);
    assert.equal(s.missiles.length, expect);
    const keys = s.missiles.map(m => `${m.targetGx},${m.targetGy}`);
    assert.equal(new Set(keys).size, expect, 'all distinct tiles');
    for (const m of s.missiles) {
      assert.ok(m.targetGx >= 0 && m.targetGx < 13 && m.targetGy >= 0 && m.targetGy < 7, 'on-island');
      assert.equal(m.damage, MISSILE_CONFIG.supplyShip.barrageDamage);
      assert.equal(m.ownerId, P1);
    }
    const deploys = s.missiles.map(m => m.deployAt);
    assert.ok(deploys.every((d, i) => i === 0 || d > deploys[i - 1]), 'ripple stagger');
  } finally {
    Math.random = realRandom;
  }
});

test('surge halves in-flight work and speeds new work for a scaled window', () => {
  const s = freshShip();
  materialize(s, P1, 'economy', 0, 0); // NW 50
  materialize(s, P2, 'economy', 1, 0);
  materialize(s, P2, 'economy', 2, 0); // NW 100 → scale 2 → 60s window
  const r1 = missileBuildBuilding(s, P1, { buildingType: 'shield', gx: 5, gy: 5 });
  const siteBefore = r1.pending.completeAt - fakeNow;
  forceShip(s);
  stubRandom([0.9]); // surge
  try {
    const r = missileClaimShip(s, P1);
    assert.ok(!r.error, r.error);
    assert.equal(r.supply.kind, 'surge');
    assert.equal(r.supply.detail.seconds, 60, '30000ms * 2x scale');
    assert.equal(s.buildSurge[P1], fakeNow + 60000);
    assert.equal(r1.pending.completeAt - fakeNow, siteBefore / 2, 'in-flight work jumps halfway');
    const r2 = missileBuildBuilding(s, P1, { buildingType: 'healer', gx: 6, gy: 6 });
    assert.equal(r2.pending.completeAt - fakeNow, 3000 / 2, 'new work inside window is 2x');
  } finally {
    Math.random = realRandom;
  }
});

test('claim validation: off, no ship, expired, over, stranger', () => {
  const off = freshShip({ supplyShip: false });
  assert.equal(missileClaimShip(off, P1).error, 'Supply ships are off');
  const s = freshShip();
  assert.equal(missileClaimShip(s, P1).error, 'No supply ship right now');
  forceShip(s);
  s.supplyShip.endAt = fakeNow - 1;
  assert.equal(missileClaimShip(s, P1).error, 'No supply ship right now');
  assert.equal(missileClaimShip(s, 'nobody').error, 'You are not in this match');
  s.winnerId = P2;
  forceShip(s);
  assert.equal(missileClaimShip(s, P1).error, 'Game is over');
});

test('lobby: supply ship defaults off, persists, reaches game state', () => {
  for (const code of [...rooms.keys()]) rooms.delete(code);
  const room = createRoom('host-1', 'HOST');
  joinRoom(room.code, 'guest-1', 'GUEST');
  selectGame(room.code, 'missile-command');
  assert.equal(room.missileCommandOptions.supplyShip, false, 'off by default');
  const on = updateMissileCommandOptions(room.code, { supplyShip: true });
  assert.equal(on.missileCommandOptions.supplyShip, true, 'toggle stored');
  const bad = updateMissileCommandOptions(room.code, { supplyShip: 'yes' });
  assert.equal(bad.missileCommandOptions.supplyShip, true, 'garbage ignored');
  const started = startGame(room.code);
  assert.equal(started.missileCommandState.supplyShipEnabled, true, 'reaches game state');
  // End-to-end through the manager wrapper.
  started.missileCommandState.supplyShip = {
    id: 'sh-e2e', dir: -1, fromX: 1.12, toX: -0.12, y: 0.5,
    startAt: fakeNow - 1000, endAt: fakeNow + 17000,
  };
  stubRandom([0.1]);
  try {
    const r = claimSupplyShip(room.code, started.missileCommandState.sides.top);
    assert.ok(!r.error, r.error);
    assert.equal(r.supply.kind, 'credits');
  } finally {
    Math.random = realRandom;
    rooms.delete(room.code);
  }
});

// restore real clock and RNG for any later suites in this process
test('teardown clock', () => { Date.now = realNow; });
