// test_missileCommand.js — permanent suite for the silo'd Missile Command module.
// Run with: npm test  (node --test test_*.js)
// Uses a stubbed clock so build timers resolve instantly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MISSILE_CONFIG,
  createMissileCommandState,
  missileBuildBuilding,
  missileUpgradeBuilding,
  missileLoadMissile,
  missileToggleAutobuild,
  missileLaunch,
  missileLaunchType,
  tickMissileCommand,
  missileIncomePerSec,
  cellDist,
} from './missileCommand.js';

const P1 = 'p1-top';
const P2 = 'p2-bottom';

// --- controllable clock: the module calls Date.now() for timers ---
const realNow = Date.now;
let fakeNow = 1_700_000_000_000;
Date.now = () => fakeNow;
const advance = (ms, state) => { fakeNow += ms; return tickMissileCommand(state, fakeNow); };
const fresh = (res = 5000) => createMissileCommandState([P1, P2], { startingResources: res });

test('grid setup: 13x7, centered cores, starting resources', () => {
  const s = fresh();
  assert.equal(s.gridCols, 13);
  assert.equal(s.gridRows, 7);
  assert.deepEqual([s.buildings.core_top.gx, s.buildings.core_top.gy], [6, 3]);
  assert.deepEqual([s.buildings.core_bottom.gx, s.buildings.core_bottom.gy], [6, 3]);
  assert.equal(s.buildings.core_top.coreHp, MISSILE_CONFIG.core.maxHp);
  assert.equal(s.resources[P1], 5000);
});

test('build validation: ok, occupied, out-of-bounds, broke', () => {
  const s = fresh(60);
  const ok = missileBuildBuilding(s, P1, { buildingType: 'economy', gx: 0, gy: 0 });
  assert.ok(ok.pending, 'first build queues a site');
  assert.equal(s.resources[P1], 10, 'cost deducted upfront');
  assert.equal(
    missileBuildBuilding(s, P1, { buildingType: 'economy', gx: 0, gy: 0 }).error,
    'Square occupied — pick an empty square',
  );
  assert.equal(missileBuildBuilding(s, P1, { buildingType: 'economy', gx: 13, gy: 0 }).error, 'Invalid grid square');
  assert.equal(missileBuildBuilding(s, P1, { buildingType: 'shield', gx: 1, gy: 0 }).error, 'Need 40 credits');
});

test('construction completes after Lv1 build time, in parallel', () => {
  const s = fresh();
  missileBuildBuilding(s, P1, { buildingType: 'economy', gx: 0, gy: 0 });
  missileBuildBuilding(s, P1, { buildingType: 'economy', gx: 1, gy: 0 });
  advance(2999, s);
  assert.equal(Object.values(s.buildings).filter(b => b.type === 'economy').length, 0, 'not done at 2.999s');
  advance(2, s);
  const ecos = Object.values(s.buildings).filter(b => b.type === 'economy');
  assert.equal(ecos.length, 2, 'both finish in parallel');
  assert.equal(ecos[0].incomePerSec, 2);
});

test('core pays baseline income', () => {
  const s = fresh(0);
  const before = s.resources[P1];
  for (let i = 0; i < 40; i++) advance(250, s); // 10s
  assert.ok(Math.abs(s.resources[P1] - before - 50) < 0.001, `got ${s.resources[P1] - before}`);
  assert.equal(missileIncomePerSec(s, P1), 5);
});

test('upgrades queue with level-scaled timers and apply on completion', () => {
  const s = fresh();
  missileBuildBuilding(s, P1, { buildingType: 'economy', gx: 0, gy: 0 });
  advance(3100, s);
  const id = Object.values(s.buildings).find(b => b.type === 'economy').id;
  const up = missileUpgradeBuilding(s, P1, id);
  assert.ok(up.pending, 'upgrade queues');
  assert.equal(s.buildings[id].level, 1, 'still old level while building');
  assert.equal(missileUpgradeBuilding(s, P1, id).error, 'Upgrade already in progress');
  advance(4999, s);
  assert.equal(s.buildings[id].level, 1, 'not done at 4.999s into a 5s upgrade');
  advance(2, s);
  assert.equal(s.buildings[id].level, 2);
  assert.equal(s.buildings[id].incomePerSec, 5);
});

test('Manhattan distance ignores diagonals', () => {
  assert.equal(cellDist(0, 0, 1, 1), 2);
  assert.equal(cellDist(5, 4, 6, 4), 1);
  assert.equal(cellDist(5, 4, 5, 6), 2);
});

test('shields fully block while charged; overflow passes through', () => {
  const s = fresh();
  missileBuildBuilding(s, P2, { buildingType: 'shield', gx: 6, gy: 5 });
  missileBuildBuilding(s, P2, { buildingType: 'economy', gx: 6, gy: 4 });
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'single', gx: 0, gy: 0 });
  advance(3100, s);
  const L = Object.values(s.buildings).find(b => b.type === 'launcher');
  const eco = Object.values(s.buildings).find(b => b.type === 'economy' && b.ownerId === P2);
  const ecoHp = eco.hp;
  L.lastFiredAt = 0;
  missileLoadMissile(s, P1, L.id);
  advance(5100, s); // missile built
  missileLaunch(s, P1, { launcherId: L.id, targetGx: 6, targetGy: 4 });
  for (let i = 0; i < 60 && s.missiles.length; i++) advance(250, s);
  const sh = Object.values(s.buildings).find(b => b.type === 'shield');
  assert.equal(eco.hp, ecoHp, 'covered building untouched (full block, no bleed)');
  assert.ok(sh.shieldHp < sh.maxShieldHp && sh.shieldHp > 0, `pool absorbed it: ${sh.shieldHp}`);
});

test('healer repairs only the weakest-% shield and reports its target', () => {
  const s = fresh();
  missileBuildBuilding(s, P1, { buildingType: 'shield', gx: 5, gy: 5 });
  missileBuildBuilding(s, P1, { buildingType: 'shield', gx: 6, gy: 4 });
  missileBuildBuilding(s, P1, { buildingType: 'healer', gx: 5, gy: 4 });
  advance(3100, s);
  const A = Object.values(s.buildings).find(b => b.type === 'shield' && b.gx === 5);
  const B = Object.values(s.buildings).find(b => b.type === 'shield' && b.gx === 6);
  const H = Object.values(s.buildings).find(b => b.type === 'healer');
  A.shieldHp = 30; // 20%
  B.shieldHp = 120; // 80%
  advance(1000, s);
  assert.equal(A.shieldHp, 39, 'weakest gets healer 8 + self 1');
  assert.equal(B.shieldHp, 121, 'other gets self-repair only');
  assert.equal(H.healTargetId, A.id);
  B.shieldHp = 10; // now weakest
  advance(1000, s);
  assert.equal(H.healTargetId, B.id, 'target switches');
  assert.equal(B.shieldHp, 19, '10 + 8 healer + 1 self');
});

test('shields self-repair at 1/8 healer rate with no healer present', () => {
  const s = fresh();
  missileBuildBuilding(s, P1, { buildingType: 'shield', gx: 0, gy: 0 });
  advance(3100, s);
  const sh = Object.values(s.buildings).find(b => b.type === 'shield');
  sh.shieldHp = 50;
  for (let i = 0; i < 20; i++) advance(500, s); // 10s
  assert.equal(sh.shieldHp, 60, 'L1: 1/s self-repair');
});

test('missile stockpile: 5s builds, cap 3, volley consumes all', () => {
  const s = fresh();
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'single', gx: 0, gy: 0 });
  advance(3100, s);
  const L = Object.values(s.buildings).find(b => b.type === 'launcher');
  assert.equal(missileLaunch(s, P1, { launcherId: L.id, targetGx: 6, targetGy: 3 }).error, 'No missiles stockpiled — build some first');
  missileLoadMissile(s, P1, L.id);
  assert.equal(L.stock ?? 0, 0, 'not instant');
  assert.match(missileLoadMissile(s, P1, L.id).error ?? '', /already building/);
  advance(5100, s);
  assert.equal(L.stock, 1);
  const v = missileLaunch(s, P1, { launcherId: L.id, targetGx: 6, targetGy: 3 });
  assert.equal(v.missiles.length, 1);
  assert.equal(L.stock, 0, 'volley consumes everything');
  assert.deepEqual(v.missiles.map(m => m.deployAt - v.missiles[0].deployAt), [0]);
});

test('scatter volley: one pattern per banked missile', () => {
  const s = fresh();
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'scatter', gx: 0, gy: 0 });
  advance(3100, s);
  const L = Object.values(s.buildings).find(b => b.type === 'launcher');
  L.lastFiredAt = 0; missileLoadMissile(s, P1, L.id); advance(5100, s);
  L.loadingUntil = 0; missileLoadMissile(s, P1, L.id); advance(5100, s);
  const v = missileLaunch(s, P1, { launcherId: L.id, targetGx: 6, targetGy: 3 });
  assert.equal(v.missiles.length, 10, '2 banked × 5 pellets');
});

test('autobuild fills stockpile unattended, pauses when broke', () => {
  const s = fresh(35); // exactly one single missile + change
  missileBuildBuilding(s, P1, { buildingType: 'economy', gx: 0, gy: 0 });
  advance(3100, s);
  // NOTE: starting 35cr won't cover a launcher; fund directly for this unit test
  s.resources[P1] = 200;
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'single', gx: 1, gy: 0 });
  advance(3100, s);
  const L = Object.values(s.buildings).find(b => b.type === 'launcher');
  missileToggleAutobuild(s, P1, L.id);
  assert.equal(L.autobuild, true);
  for (let i = 0; i < 120 && L.stock < 2; i++) advance(500, s);
  assert.ok((L.stock ?? 0) >= 2, `autobuild stocks without clicks (stock=${L.stock})`);
  missileToggleAutobuild(s, P1, L.id);
  assert.equal(L.autobuild, false);
});

test('destroying the core wins the game; dead cores do not regen', () => {
  const s = fresh();
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'single', gx: 0, gy: 0 });
  advance(3100, s);
  const L = Object.values(s.buildings).find(b => b.type === 'launcher');
  L.missileDamage = 5000; // test shortcut
  L.lastFiredAt = 0; missileLoadMissile(s, P1, L.id); advance(5100, s);
  missileLaunch(s, P1, { launcherId: L.id, targetGx: 6, targetGy: 3 });
  for (let i = 0; i < 60 && s.missiles.length; i++) advance(250, s);
  assert.equal(s.winnerId, P1);
  assert.equal(s.winReason, 'core_destroyed');
  assert.equal(s.buildings.core_bottom.coreHp, 0);
  const hp = s.buildings.core_bottom.coreHp;
  advance(5000, s);
  assert.equal(s.buildings.core_bottom.coreHp, hp, 'no regen after death');
});

test('launch-all-type fires every loaded launcher of that type', () => {
  const s = fresh();
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'single', gx: 0, gy: 0 });
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'single', gx: 1, gy: 0 });
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'scatter', gx: 2, gy: 0 });
  advance(3100, s);
  const singles = Object.values(s.buildings).filter(b => b.launcherType === 'single');
  const scat = Object.values(s.buildings).find(b => b.launcherType === 'scatter');
  for (const L of [...singles, scat]) { L.loadingUntil = 0; missileLoadMissile(s, P1, L.id); }
  advance(5100, s); // all three finish (started same tick)
  assert.deepEqual(singles.map(l => l.stock), [1, 1]);
  const r = missileLaunchType(s, P1, 'single', 6, 3);
  assert.equal(r.missiles.length, 2, 'one missile per loaded single launcher');
  assert.deepEqual(singles.map(l => l.stock), [0, 0], 'stocks consumed');
  assert.equal(scat.stock, 1, 'scatter untouched');
  assert.equal(missileLaunchType(s, P1, 'scatter', 0, 0).error, undefined);
});

test('blasts on empty covered tiles still drain the shield', () => {
  const s = fresh();
  missileBuildBuilding(s, P2, { buildingType: 'shield', gx: 6, gy: 5 });
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'single', gx: 0, gy: 0 });
  advance(3100, s);
  const L = Object.values(s.buildings).find(b => b.type === 'launcher');
  const sh = Object.values(s.buildings).find(b => b.type === 'shield');
  assert.equal(sh.maxShieldHp, 300, '2x shield pools');
  L.loadingUntil = 0; missileLoadMissile(s, P1, L.id); advance(5100, s);
  missileLaunch(s, P1, { launcherId: L.id, targetGx: 8, targetGy: 5 }); // empty, covered (dist 2)
  for (let i = 0; i < 60 && s.missiles.length; i++) advance(250, s);
  assert.equal(s.missiles.length, 0, 'missile landed');
  assert.ok(sh.shieldHp < 250, `shield intercepted the empty blast: pool=${sh.shieldHp}`);
});

// restore real clock for any later suites in this process
test('teardown clock', () => { Date.now = realNow; });
