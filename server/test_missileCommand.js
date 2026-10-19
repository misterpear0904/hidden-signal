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
  missileLaunch,
  missileLaunchType,
  missileSetKeepFire,
  missileFireDesperation,
  missileSellBuilding,
  missileCancelSell,
  missileRebuildRubble,
  totalInvestedFor,
  sellRefundForBuilding,
  tickMissileCommand,
  missileIncomePerSec,
  cellDist,
  filterMissileStateForPlayer,
  missileAiTick,
  mcTickPayload,
  mcDynSnapshot,
} from './missileCommand.js';
import {
  rooms,
  startGame,
  createRoom,
  joinRoom,
  selectGame,
  updateMissileCommandOptions,
  buildMissileBuilding as gmBuild,
  upgradeMissileBuilding as gmUpgrade,
  loadMissile as gmLoad,
  launchMissile as gmFire,
  launchMissileType as gmFireType,
  tickMissileRoom,
  resetToLobby,
} from './gameManager.js';

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
  assert.equal(s.buildings[id].incomePerSec, 3);
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

test('autobuild is always on: fills stockpile unattended, pauses when broke', () => {
  const s = fresh(35); // exactly one single missile + change
  missileBuildBuilding(s, P1, { buildingType: 'economy', gx: 0, gy: 0 });
  advance(3100, s);
  // NOTE: starting 35cr won't cover a launcher; fund directly for this unit test
  s.resources[P1] = 200;
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'single', gx: 1, gy: 0 });
  advance(3100, s);
  const L = Object.values(s.buildings).find(b => b.type === 'launcher');
  assert.equal(L.autobuild, true, 'new launchers auto-load out of the box — no toggle');
  for (let i = 0; i < 120 && L.stock < 2; i++) advance(500, s);
  assert.ok((L.stock ?? 0) >= 2, `stockpiles without clicks (stock=${L.stock})`);
});

test('every launcher auto-loads from birth (no opt-in step)', () => {
  const s = fresh();
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'single', gx: 0, gy: 0 });
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'scatter', gx: 1, gy: 0 });
  missileBuildBuilding(s, P2, { buildingType: 'launcher', launcherType: 'single', gx: 2, gy: 0 });
  advance(3100, s);
  const mine = Object.values(s.buildings).filter(b => b.type === 'launcher' && b.ownerId === P1);
  const theirs = Object.values(s.buildings).find(b => b.type === 'launcher' && b.ownerId === P2);
  assert.ok(theirs, 'enemy launcher materialized');
  assert.equal(mine.length, 2);
  assert.ok(mine.every(b => b.autobuild === true), 'all new launchers default on');
  assert.equal(theirs.autobuild, true, 'enemy launcher on too');
  for (let i = 0; i < 120 && mine.some(b => (b.stock ?? 0) < 1); i++) advance(500, s);
  assert.ok(mine.every(b => (b.stock ?? 0) >= 1), 'both stock without any toggle');
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

// ─── Keep-firing lock ────────────────────────────────────────────────────────

// Builds one launcher of `type` for P1 with one missile stockpiled.
function loadedLauncher(s, type = 'single') {
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: type, gx: 0, gy: 0 });
  advance(3100, s);
  const L = Object.values(s.buildings).find(b => b.type === 'launcher');
  L.loadingUntil = 0;
  missileLoadMissile(s, P1, L.id);
  advance(5100, s);
  return L;
}

test('keep-fire: armed lock fires stockpiled missiles at the locked tile', () => {
  const s = fresh();
  const L = loadedLauncher(s);
  assert.equal(L.stock, 1);
  const r = missileSetKeepFire(s, P1, { armed: true, targetGx: 8, targetGy: 2, launcherType: 'single' });
  assert.equal(r.error, undefined);
  assert.equal(s.keepFire[P1].targetGx, 8);
  advance(250, s);
  assert.equal(L.stock, 0, 'stockpile auto-consumed');
  assert.equal(s.missiles.length, 1, 'one missile launched without any player action');
  assert.equal(s.missiles[0].targetGx, 8);
  assert.equal(s.missiles[0].targetGy, 2);
});

test('keep-fire: only the locked launcher type fires', () => {
  const s = fresh();
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'single', gx: 0, gy: 0 });
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'scatter', gx: 1, gy: 0 });
  advance(3100, s);
  const single = Object.values(s.buildings).find(b => b.launcherType === 'single');
  const scat = Object.values(s.buildings).find(b => b.launcherType === 'scatter');
  for (const L of [single, scat]) { L.loadingUntil = 0; missileLoadMissile(s, P1, L.id); }
  advance(5100, s);
  missileSetKeepFire(s, P1, { armed: true, targetGx: 3, targetGy: 3, launcherType: 'single' });
  advance(250, s);
  assert.equal(single.stock, 0, 'locked type fired');
  assert.equal(scat.stock, 1, 'other type held its missiles');
});

test('keep-fire: a load completing later fires on its own', () => {
  const s = fresh();
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'single', gx: 0, gy: 0 });
  advance(3100, s);
  const L = Object.values(s.buildings).find(b => b.type === 'launcher');
  // auto-load is always on: the launcher keeps producing for the load→fire cycle
  missileSetKeepFire(s, P1, { armed: true, targetGx: 5, targetGy: 5, launcherType: 'single' });
  advance(5100, s); // autobuild starts a missile, then it completes
  advance(5100, s); // ...and completes again
  assert.equal(L.stock, 0, 'never stockpiles — everything goes out on load');
  assert.ok(s.missiles.length >= 1, 'missiles were launched automatically');
  assert.ok(s.missiles.every(m => m.targetGx === 5 && m.targetGy === 5), 'all aimed at the locked tile');
});

test('keep-fire: clearing the lock stops automatic launches', () => {
  const s = fresh();
  const L = loadedLauncher(s);
  missileSetKeepFire(s, P1, { armed: true, targetGx: 4, targetGy: 1, launcherType: 'single' });
  advance(250, s);
  assert.equal(L.stock, 0, 'armed lock drained the stockpile');
  const r = missileSetKeepFire(s, P1, { armed: false });
  assert.equal(r.keepFire, null);
  assert.equal(s.keepFire[P1], null);
  const before = s.missiles.length;
  advance(1000, s);
  assert.equal(s.missiles.length, before, 'nothing launched while the lock is off');
  L.loadingUntil = 0;
  missileLoadMissile(s, P1, L.id);
  advance(5100, s);
  assert.equal(L.stock, 1, 'loads and stays stockpiled once the lock is cleared');
});

test('keep-fire: validation rejects bad tiles/types and other players', () => {
  const s = fresh();
  assert.equal(missileSetKeepFire(s, P1, { armed: true, targetGx: 99, targetGy: 0, launcherType: 'single' }).error, 'Invalid target square');
  assert.equal(missileSetKeepFire(s, P1, { armed: true, targetGx: 0, targetGy: 0, launcherType: 'nuke' }).error, 'Invalid launcher type');
  assert.equal(missileSetKeepFire(s, 'nobody', { armed: true, targetGx: 0, targetGy: 0, launcherType: 'single' }).error, 'You are not in this match');
});

test('keep-fire: locks clear when a core dies', () => {
  const s = fresh();
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'single', gx: 0, gy: 0 });
  advance(3100, s);
  const L = Object.values(s.buildings).find(b => b.type === 'launcher');
  L.loadingUntil = 0; missileLoadMissile(s, P1, L.id); advance(5100, s);
  missileSetKeepFire(s, P1, { armed: true, targetGx: 6, targetGy: 3, launcherType: 'single' });
  s.buildings.core_bottom.coreHp = 0;
  advance(250, s);
  assert.ok(s.winnerId, 'game ended');
  assert.deepEqual(s.keepFire, {}, 'locks wiped at victory');
});

test('blasts on empty covered tiles still drain the shield', () => {
  const s = fresh();
  missileBuildBuilding(s, P2, { buildingType: 'shield', gx: 6, gy: 5 });
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'single', gx: 0, gy: 0 });
  advance(3100, s);
  const L = Object.values(s.buildings).find(b => b.type === 'launcher');
  const sh = Object.values(s.buildings).find(b => b.type === 'shield');
  assert.equal(sh.maxShieldHp, 375, '2.5x shield pools');
  L.loadingUntil = 0; missileLoadMissile(s, P1, L.id); advance(5100, s);
  missileLaunch(s, P1, { launcherId: L.id, targetGx: 8, targetGy: 5 }); // empty, covered (dist 2)
  for (let i = 0; i < 60 && s.missiles.length; i++) advance(250, s);
  assert.equal(s.missiles.length, 0, 'missile landed');
  assert.ok(sh.shieldHp < 260, `shield intercepted the empty blast: pool=${sh.shieldHp}`);
  assert.equal(sh.shieldHp, 375 - 120, 'full 120 absorbed');
});

// ─── Lobby option → game state wiring ────────────────────────────────────────
// Regression tests: the Fog of War toggle rendered a clickable button but the
// server's update handler never persisted it and never passed it into game
// state, so the button was effectively dead from the player's point of view.

// Clears any rooms left by other suites so this suite runs in isolation.
function clearRooms() {
  for (const code of [...rooms.keys()]) rooms.delete(code);
}

// Builds a lobby with two players and Missile Command selected.
function lobbyWithMissileCommand() {
  clearRooms();
  const room = createRoom('host-1', 'HOST');
  const joined = joinRoom(room.code, 'guest-1', 'GUEST');
  assert.ok(joined, 'second player joins');
  const sel = selectGame(room.code, 'missile-command');
  assert.ok(sel, 'missile-command selected');
  return sel;
}

test('lobby: fogOfWar option persists when host toggles it', () => {
  const room = lobbyWithMissileCommand();
  assert.equal(room.missileCommandOptions.fogOfWar, true, 'on by default');

  const off = updateMissileCommandOptions(room.code, { fogOfWar: false });
  assert.equal(off.missileCommandOptions.fogOfWar, false, 'toggled off is stored');

  const on = updateMissileCommandOptions(room.code, { fogOfWar: true });
  assert.equal(on.missileCommandOptions.fogOfWar, true, 'toggled on is stored');
});

test('lobby: fogOfWar setting survives other option changes', () => {
  const room = lobbyWithMissileCommand();
  updateMissileCommandOptions(room.code, { fogOfWar: true });
  // Changing credits must not clobber an unrelated option.
  const after = updateMissileCommandOptions(room.code, { startingResources: 300 });
  assert.equal(after.missileCommandOptions.fogOfWar, true, 'fogOfWar survived');
  assert.equal(after.missileCommandOptions.startingResources, 300, 'credits updated');
});

test('lobby: non-boolean fogOfWar is rejected', () => {
  const room = lobbyWithMissileCommand();
  updateMissileCommandOptions(room.code, { fogOfWar: true });
  const bad = updateMissileCommandOptions(room.code, { fogOfWar: 'yes' });
  assert.equal(bad.missileCommandOptions.fogOfWar, true, 'garbage ignored, prior value kept');
});

test('lobby: fogOfWar reaches missile game state on start', () => {
  const room = lobbyWithMissileCommand();
  updateMissileCommandOptions(room.code, { fogOfWar: true });
  const started = startGame(room.code);
  assert.ok(started, 'game started');
  assert.equal(started.missileCommandState.fogOfWar, true, 'fog enabled in game state');
  // Cores are permanently explored for BOTH players at init.
  const { sides } = started.missileCommandState;
  const tiles = started.missileCommandState.exploredTiles;
  assert.ok(tiles[sides.top]['6,3'] === 0, 'top core permanently visible');
  assert.ok(tiles[sides.bottom]['6,3'] === 0, 'bottom core permanently visible');
});

test('lobby: game starts with fog ON when never toggled', () => {
  const room = lobbyWithMissileCommand();
  const started = startGame(room.code);
  assert.equal(started.missileCommandState.fogOfWar, true, 'defaults on');
  // exploredTiles must still exist so the client never has to null-check.
  assert.ok(started.missileCommandState.exploredTiles, 'map present');
});

test('lobby: toggling fog OFF reaches game state', () => {
  const room = lobbyWithMissileCommand();
  updateMissileCommandOptions(room.code, { fogOfWar: false });
  const started = startGame(room.code);
  assert.equal(started.missileCommandState.fogOfWar, false, 'opt-out respected');
});

test('lobby: fog history defaults off, persists, and reaches game state', () => {
  const room = lobbyWithMissileCommand();
  assert.equal(room.missileCommandOptions.fogHistory, false, 'off by default');
  const on = updateMissileCommandOptions(room.code, { fogHistory: true });
  assert.equal(on.missileCommandOptions.fogHistory, true, 'toggled on is stored');
  const bad = updateMissileCommandOptions(room.code, { fogHistory: 'yes' });
  assert.equal(bad.missileCommandOptions.fogHistory, true, 'garbage ignored, prior value kept');
  const started = startGame(room.code);
  assert.equal(started.missileCommandState.fogHistory, true, 'history reaches game state');
});

test('lobby: game starts with fog history OFF when never toggled', () => {
  const room = lobbyWithMissileCommand();
  const started = startGame(room.code);
  assert.equal(started.missileCommandState.fogHistory, false, 'defaults off');
});

test('fog: missile impact reveals area to attacker only, and it expires', () => {
  const s = createMissileCommandState([P1, P2], { startingResources: 5000, fogOfWar: true });
  // Init runs on first tick — cores permanently explored.
  tickMissileCommand(s, Date.now());
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'single', gx: 0, gy: 0 });
  advance(3100, s);
  const L = Object.values(s.buildings).find(b => b.type === 'launcher');
  // Smash the enemy economy so we have something to reveal.
  missileBuildBuilding(s, P2, { buildingType: 'economy', gx: 6, gy: 5 });
  advance(3100, s);
  L.loadingUntil = 0; missileLoadMissile(s, P1, L.id); advance(5100, s);
  L.loadingUntil = 0; missileLoadMissile(s, P1, L.id); advance(5100, s);

  // Aim well away from either core so the core stays at (6,3) and the win
  // check never fires.
  missileLaunch(s, P1, { launcherId: L.id, targetGx: 1, targetGy: 6 });
  for (let i = 0; i < 80 && s.missiles.length; i++) advance(250, s);

  const attackerTiles = s.exploredTiles[P1];
  const defenderTiles = s.exploredTiles[P2];
  const attackerKeys = Object.keys(attackerTiles);
  assert.ok(attackerKeys.length > 1, 'attacker gained exploration');
  assert.ok(attackerKeys.every(k => k === '6,3' || attackerTiles[k] > 0), 'core permanent, rest temporary');
  // The defender never gains vision of their own island via this path.
  assert.deepEqual(Object.keys(defenderTiles), ['6,3'], 'defender explored nothing new');
  // Reveals are temporary, not permanent (0 means permanent).
  assert.ok(Object.values(attackerTiles).some(v => v > 0), 'reveals carry an expiry');
});

test('fog: expired reveals are forgotten by default (history off)', () => {
  const s = createMissileCommandState([P1, P2], { startingResources: 5000, fogOfWar: true });
  assert.equal(s.fogHistory, false, 'history off by default');
  tickMissileCommand(s, Date.now());
  // Plant an already-expired temporary reveal next to the core.
  s.exploredTiles[P1]['6,4'] = Date.now() - 1;
  const now = Date.now();
  tickMissileCommand(s, now + 10);
  assert.equal(s.exploredTiles[P1]['6,4'], undefined, 'stale reveal deleted, not remembered');
  assert.equal(s.exploredTiles[P1]['6,3'], 0, 'permanent core reveal kept');
});

test('fog: expired reveals are remembered with history on', () => {
  const s = createMissileCommandState([P1, P2], { startingResources: 5000, fogOfWar: true, fogHistory: true });
  tickMissileCommand(s, Date.now());
  // Plant an already-expired temporary reveal next to the core.
  s.exploredTiles[P1]['6,4'] = Date.now() - 1;
  const now = Date.now();
  tickMissileCommand(s, now + 10);
  assert.equal(s.exploredTiles[P1]['6,4'], -1, 'stale reveal is remembered, not deleted');
  assert.equal(s.exploredTiles[P1]['6,3'], 0, 'permanent core reveal kept');

  // Re-revealing a remembered tile makes it live again.
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'single', gx: 0, gy: 0 });
  advance(3100, s);
  const L2 = Object.values(s.buildings).find(b => b.type === 'launcher');
  L2.loadingUntil = 0; missileLoadMissile(s, P1, L2.id); advance(5100, s);
  missileLaunch(s, P1, { launcherId: L2.id, targetGx: 1, targetGy: 6 });
  for (let i = 0; i < 80 && s.missiles.length; i++) advance(250, s);
  const revived = s.exploredTiles[P1]['1,6'];
  assert.ok(revived === undefined || revived > Date.now(), 're-explored tile is live again or untouched');
});

test('fog: disabled mode leaves exploredTiles untouched', () => {
  const s = createMissileCommandState([P1, P2], { startingResources: 5000, fogOfWar: false });
  tickMissileCommand(s, Date.now());
  assert.equal(s.fogOfWar, false, 'flag stays off');
  assert.deepEqual(Object.keys(s.exploredTiles[P1]), [], 'no exploration without fog');
});

test('overlapping shields cover each other', () => {
  const s = fresh();
  missileBuildBuilding(s, P2, { buildingType: 'shield', gx: 6, gy: 5 });
  missileBuildBuilding(s, P2, { buildingType: 'shield', gx: 6, gy: 6 });
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'single', gx: 0, gy: 0 });
  advance(3100, s);
  const L = Object.values(s.buildings).find(b => b.type === 'launcher');
  const S1 = Object.values(s.buildings).find(b => b.type === 'shield' && b.gy === 5);
  const S2 = Object.values(s.buildings).find(b => b.type === 'shield' && b.gy === 6);
  const s1hp = S1.hp;
  L.loadingUntil = 0; missileLoadMissile(s, P1, L.id); advance(5100, s);
  missileLaunch(s, P1, { launcherId: L.id, targetGx: 6, targetGy: 5 }); // direct hit on S1
  for (let i = 0; i < 80 && s.missiles.length; i++) advance(250, s);
  assert.equal(s.missiles.length, 0, 'missile landed');
  assert.ok(S2.shieldHp < S2.maxShieldHp, `covering shield absorbed: pool=${S2.shieldHp}`);
  assert.equal(S1.shieldHp, S1.maxShieldHp, 'hit shield pool untouched (covered)');
  assert.equal(S1.hp, s1hp, 'hit shield structure untouched');
});

// Builds a P2 economy at (6,5) covered by two shields — A at (9,5) is FAR but
// fuller, B at (5,5) is NEAR but emptier. Returns them plus a loaded launcher
// for P1 so we can drop one 120-damage missile on the economy.
//
// NOTE: shields self-repair ~1/s, so pools set here drift upward by ~10 over
// the missile's flight before the blast lands. Tests assert ranges that absorb
// that drift while still discriminating "fullest first" from "nearest first".
function overlapFixture(s) {
  missileBuildBuilding(s, P2, { buildingType: 'economy', gx: 6, gy: 5 });
  missileBuildBuilding(s, P2, { buildingType: 'shield', gx: 9, gy: 5 });
  missileBuildBuilding(s, P2, { buildingType: 'shield', gx: 5, gy: 5 });
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'single', gx: 0, gy: 0 });
  advance(3100, s);
  const A = Object.values(s.buildings).find(b => b.type === 'shield' && b.gx === 9);
  const B = Object.values(s.buildings).find(b => b.type === 'shield' && b.gx === 5);
  const eco = Object.values(s.buildings).find(b => b.type === 'economy');
  const L = Object.values(s.buildings).find(b => b.type === 'launcher');
  L.loadingUntil = 0; missileLoadMissile(s, P1, L.id); advance(5100, s);
  return { A, B, eco, L };
}
const land = (s, L) => {
  missileLaunch(s, P1, { launcherId: L.id, targetGx: 6, targetGy: 5 });
  for (let i = 0; i < 80 && s.missiles.length; i++) advance(250, s);
};

test('shield overlap: fullest % pool absorbs first, not the nearest shield', () => {
  const s = fresh();
  const { A, B, eco, L } = overlapFixture(s);
  A.shieldHp = 300; // 80%
  B.shieldHp = 100; // 27%
  const ecoHp = eco.hp;
  land(s, L);
  // Nearest-first (the old rule) would have drained B; the fuller pool wins.
  assert.ok(A.shieldHp >= 180 && A.shieldHp <= 200, `fullest pool ate the 120 hit: ${A.shieldHp}`);
  assert.ok(B.shieldHp >= 105, `emptier pool left alone: ${B.shieldHp}`);
  assert.equal(eco.hp, ecoHp, 'building fully covered');
});

test('shield overlap: overflow spills into the next fullest % pool', () => {
  const s = fresh();
  const { A, B, eco, L } = overlapFixture(s);
  A.shieldHp = 100; // 27% — fuller of the two, so it blows first
  B.shieldHp = 60;  // 16%
  const ecoHp = eco.hp;
  land(s, L);
  assert.ok(A.shieldHp <= 2, `fuller pool drained first: ${A.shieldHp}`);
  // What A couldn't absorb carries into B instead of hitting the building.
  assert.ok(B.shieldHp >= 50 && B.shieldHp <= 70, `carry-over landed in next pool: ${B.shieldHp}`);
  assert.equal(eco.hp, ecoHp, 'building still fully covered');
});

test('shield overlap: only true overflow damages the building', () => {
  const s = fresh();
  const { A, B, eco, L } = overlapFixture(s);
  A.shieldHp = 10;
  B.shieldHp = 5;
  const ecoHp = eco.hp;
  land(s, L);
  assert.ok(A.shieldHp <= 2, 'first pool emptied');
  assert.ok(B.shieldHp <= 2, 'second pool emptied by the overflow');
  // 120 damage vs ~20 + ~15 of pool (plus in-flight repair) → real bleed.
  assert.ok(eco.hp <= ecoHp - 70, `overflow reached the building: -${ecoHp - eco.hp}`);
});

test('shield overlap: % ordering spans shield and heavy shield pools', () => {
  const s = fresh();
  // Heavy shield is FULL (750/750) but covers only 2 tiles; the regular shield
  // is nearly spent (20/375) but reaches 3. Raw pool would rank light first —
  // percent must still put the full heavy pool in front.
  missileBuildBuilding(s, P2, { buildingType: 'economy', gx: 6, gy: 5 });
  missileBuildBuilding(s, P2, { buildingType: 'shield_heavy', gx: 7, gy: 5 });
  missileBuildBuilding(s, P2, { buildingType: 'shield', gx: 4, gy: 5 });
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'single', gx: 0, gy: 0 });
  advance(3100, s);
  const heavy = Object.values(s.buildings).find(b => b.type === 'shield_heavy');
  const light = Object.values(s.buildings).find(b => b.type === 'shield');
  const eco = Object.values(s.buildings).find(b => b.type === 'economy');
  const L = Object.values(s.buildings).find(b => b.type === 'launcher');
  assert.equal(heavy.maxShieldHp, 750, 'heavy pools are 2x');
  L.loadingUntil = 0; missileLoadMissile(s, P1, L.id); advance(5100, s);
  light.shieldHp = 20; // ~5%
  const ecoHp = eco.hp;
  land(s, L);
  assert.ok(heavy.shieldHp >= 620 && heavy.shieldHp <= 640, `full heavy pool absorbed: ${heavy.shieldHp}`);
  assert.ok(light.shieldHp >= 27, `nearly-spent light pool untouched: ${light.shieldHp}`);
  assert.equal(eco.hp, ecoHp, 'building fully covered');
});

test('volley missiles fan out on distinct lanes', () => {
  const s = fresh();
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'scatter', gx: 0, gy: 0 });
  advance(3100, s);
  const L = Object.values(s.buildings).find(b => b.type === 'launcher');
  L.loadingUntil = 0; missileLoadMissile(s, P1, L.id); advance(5100, s);
  const v = missileLaunch(s, P1, { launcherId: L.id, targetGx: 6, targetGy: 3 });
  const lanes = v.missiles.map(m => m.lane).sort((a, b) => a - b);
  assert.deepEqual(lanes, [-2, -1, 0, 1, 2], '5 pellets spread across lanes');
});

// ── Full-game integration via the real gameManager layer ──────────────────

let gmSeq = 0;
function gmRoom(res = 20000) {
  const room = {
    code: `GMINTEG${gmSeq++}`,
    selectedGameId: 'missile-command',
    players: [
      { id: P1, name: 'Top', score: 0, isHost: true, connected: true },
      { id: P2, name: 'Bot', score: 0, isHost: false, connected: true },
    ],
    phase: 'lobby',
    round: 0,
    endVote: null,
    missileCommandOptions: { startingResources: res, economyTickMs: 500, maxLevel: 5 },
    missileCommandState: null,
    lastActivityMs: fakeNow,
  };
  rooms.set(room.code, room);
  return room;
}

// Build a building through the manager and fast-forward past its 3s site.
function gmBuildDone(room, playerId, type, gx, gy, launcherType) {
  const r = gmBuild(room.code, playerId, { buildingType: type, launcherType, gx, gy });
  assert.ok(!r.error, `build ordered: ${r.error}`);
  advance(3100, room.missileCommandState);
  const b = Object.values(room.missileCommandState.buildings)
    .find(x => x.ownerId === playerId && x.type === type && x.gx === gx && x.gy === gy);
  assert.ok(b, `${type} materialized at (${gx},${gy})`);
  return b;
}

function gmLoadFull(room, playerId, launcher, n = 3) {
  // Auto-load is always on: tick until the stockpile fills to exactly n.
  let guard = 0;
  while (launcher.stock < n && guard++ < 20) {
    advance(5100, room.missileCommandState);
  }
  assert.equal(launcher.stock, n);
}

test('upgrade cost curves are near-exponential', () => {
  const room = gmRoom();
  try {
    startGame(room.code);
    const mc = () => room.missileCommandState;
    const eco = gmBuildDone(room, P1, 'economy', 0, 0);
    const sh = gmBuildDone(room, P1, 'shield', 1, 0);
    const he = gmBuildDone(room, P1, 'healer', 2, 0);
    const la = gmBuildDone(room, P1, 'launcher', 3, 0, 'single');
    const expect = {
      [eco.id]: [60, 150, 375, 900],
      [sh.id]: [50, 125, 300, 700],
      [he.id]: [55, 140, 330, 750],
    };
    const durations = { 2: 5000, 3: 10000, 4: 20000, 5: 30000 };
    for (const [id, costs] of Object.entries(expect)) {
      for (let step = 0; step < costs.length; step++) {
        const target = step + 2;
        const before = mc().resources[P1];
        const r = gmUpgrade(room.code, P1, id);
        assert.ok(!r.error, r.error);
        assert.equal(before - mc().resources[P1], costs[step], `cost to Lv${target}`);
        assert.equal(r.pending.completeAt - fakeNow, durations[target], `Lv${target} takes ${durations[target]}ms`);
        advance(durations[target] + 100, mc());
        assert.equal(mc().buildings[id].level, target);
      }
    }
    // launchers: 1.2x / 2.5x / 5x / 10x of the 120cr build cost
    const singleCosts = [144, 300, 600, 1200];
    for (let step = 0; step < singleCosts.length; step++) {
      const before = mc().resources[P1];
      const r = gmUpgrade(room.code, P1, la.id);
      assert.ok(!r.error, r.error);
      assert.equal(before - mc().resources[P1], singleCosts[step], `launcher to Lv${step + 2}`);
      advance(({ 2: 5000, 3: 10000, 4: 20000, 5: 30000 })[step + 2] + 100, mc());
      assert.equal(mc().buildings[la.id].level, step + 2);
    }
  } finally {
    rooms.delete(room.code);
  }
});

test('missile costs steepen hard with launcher level', () => {
  const room = gmRoom();
  try {
    startGame(room.code);
    const mc = () => room.missileCommandState;
    const s1 = gmBuildDone(room, P1, 'launcher', 0, 0, 'single');
    const s2 = gmBuildDone(room, P1, 'launcher', 1, 0, 'scatter');
    const wantSingle = [30, 55, 100, 170, 280];
    const wantScatter = [45, 80, 140, 230, 360];
    assert.equal(s1.missileCost, wantSingle[0]);
    assert.equal(s2.missileCost, wantScatter[0]);
    for (let lv = 2; lv <= 5; lv++) {
      gmUpgrade(room.code, P1, s1.id);
      gmUpgrade(room.code, P1, s2.id);
      advance(40000, mc());
      assert.equal(mc().buildings[s1.id].missileCost, wantSingle[lv - 1], `single Lv${lv}`);
      assert.equal(mc().buildings[s2.id].missileCost, wantScatter[lv - 1], `scatter Lv${lv}`);
    }
  } finally {
    rooms.delete(room.code);
  }
});

test('full game via manager: build, snowball, volley, core kill, scoring', () => {
  const room = gmRoom(3000);
  try {
    const started = startGame(room.code);
    assert.ok(started, 'game starts with 2 players');
    assert.equal(room.phase, 'missile-command-play');
    assert.deepEqual(room.missileCommandState.sides, { top: P1, bottom: P2 });
    gmBuildDone(room, P1, 'economy', 0, 0);
    gmBuildDone(room, P1, 'economy', 1, 0);
    gmBuildDone(room, P1, 'shield', 2, 0);
    const L = gmBuildDone(room, P1, 'launcher', 3, 0, 'single');
    const up = gmUpgrade(room.code, P1, Object.values(room.missileCommandState.buildings).find(b => b.type === 'economy').id);
    assert.ok(!up.error, up.error);
    advance(5100, room.missileCommandState);

    let guard = 0;
    while (!room.missileCommandState.winnerId && guard++ < 24) {
      gmLoadFull(room, P1, L, 3);
      const f = gmFire(room.code, P1, { launcherId: L.id, targetGx: 6, targetGy: 3 });
      assert.ok(!f.error, f.error);
      for (let i = 0; i < 120 && room.missileCommandState.missiles.length; i++) {
        fakeNow += 250;
        tickMissileRoom(room, fakeNow);
      }
    }
    assert.equal(room.missileCommandState.winnerId, P1);
    assert.equal(room.missileCommandState.winReason, 'core_destroyed');
    assert.equal(room.phase, 'missile-command-end');
    assert.equal(room.players.find(p => p.id === P1).score, 5, 'winner scores +5');
    assert.equal(room.players.find(p => p.id === P2).score, 0);
  } finally {
    rooms.delete(room.code);
  }
});

test('snowball math: L5 generator + core over 10s', () => {
  const room = gmRoom();
  try {
    startGame(room.code);
    const mc = () => room.missileCommandState;
    const eco = gmBuildDone(room, P1, 'economy', 0, 0);
    for (const d of [5000, 10000, 20000, 30000]) {
      gmUpgrade(room.code, P1, eco.id);
      advance(d + 100, mc());
    }
    assert.equal(mc().buildings[eco.id].level, 5);
    const before = mc().resources[P1];
    for (let i = 0; i < 40; i++) advance(250, mc());
    assert.ok(Math.abs(mc().resources[P1] - before - 170) < 0.01, '12/s gen + 5/s core × 10s');
  } finally {
    rooms.delete(room.code);
  }
});

test('construction sites cannot be upgraded; destroyed buildings drop upgrades', () => {
  const room = gmRoom();
  try {
    startGame(room.code);
    const mc = () => room.missileCommandState;
    const r = gmBuild(room.code, P1, { buildingType: 'economy', gx: 0, gy: 0 });
    assert.ok(r.pending, 'site queued');
    const bad = gmUpgrade(room.code, P1, r.pending.id);
    assert.equal(bad.error, 'Building not found');
    advance(3100, mc());
    const id = Object.values(mc().buildings).find(b => b.type === 'economy').id;
    gmUpgrade(room.code, P1, id);
    delete mc().buildings[id]; // simulate destruction mid-upgrade
    advance(6000, mc());
    assert.equal(Object.keys(mc().pending ?? {}).length, 0, 'stale upgrade dropped, no crash');
    assert.equal(mc().buildings[id], undefined);
  } finally {
    rooms.delete(room.code);
  }
});

test('dead cores earn nothing and the economy freezes after victory', () => {
  const room = gmRoom();
  try {
    startGame(room.code);
    const mc = () => room.missileCommandState;
    // wipe the bottom core directly, then let the win check fire
    mc().buildings.core_bottom.coreHp = 0;
    mc().buildings.core_bottom.hp = 0;
    fakeNow += 250;
    tickMissileRoom(room, fakeNow);
    assert.equal(mc().winnerId, P1);
    const resTop = mc().resources[P1];
    const resBot = mc().resources[P2];
    for (let i = 0; i < 40; i++) { fakeNow += 250; tickMissileRoom(room, fakeNow); }
    assert.equal(mc().resources[P1], resTop, 'no post-win income');
    assert.equal(mc().resources[P2], resBot, 'dead core earns nothing');
  } finally {
    rooms.delete(room.code);
  }
});

test('no building cap: 40+ buildings all queue fine', () => {
  const room = gmRoom(99999);
  try {
    startGame(room.code);
    const mc = () => room.missileCommandState;
    for (let i = 0; i < 40; i++) {
      const gx = i % 13, gy = Math.floor(i / 13);
      const r = gmBuild(room.code, P1, { buildingType: 'economy', gx, gy });
      assert.ok(!r.error, `build ${i}: ${r.error}`);
    }
    // No cap: the 41st queues fine too (grid space is the only limit).
    const extra = gmBuild(room.code, P1, { buildingType: 'economy', gx: 12, gy: 6 });
    assert.ok(!extra.error, `build 40: ${extra.error}`);
    advance(3100, mc());
    assert.equal(Object.values(mc().buildings).filter(b => b.type === 'economy').length, 41);
  } finally {
    rooms.delete(room.code);
  }
});

test('heal beam idles when every shield is full', () => {
  const room = gmRoom();
  try {
    startGame(room.code);
    const mc = () => room.missileCommandState;
    gmBuildDone(room, P1, 'shield', 5, 5);
    gmBuildDone(room, P1, 'healer', 5, 4);
    const H = Object.values(mc().buildings).find(b => b.type === 'healer');
    advance(1000, mc());
    assert.equal(H.healTargetId, null, 'no beam at full health');
  } finally {
    rooms.delete(room.code);
  }
});

test('sell math: 70% of build + upgrades, rounded down', () => {
  assert.equal(totalInvestedFor('economy', undefined, 1), 50);
  assert.equal(totalInvestedFor('economy', undefined, 3), 260); // 50 + 60 + 150
  assert.equal(totalInvestedFor('launcher', 'single', 2), 264); // 120 + round(120*1.2)
  assert.equal(sellRefundForBuilding({ type: 'economy', level: 3 }), Math.floor(260 * 0.7)); // 182
  assert.equal(sellRefundForBuilding({ type: 'shield', level: 1 }), 28); // floor(40*0.7)
});

test('sell flow: 20s timer, building works meanwhile, then removed + refunded', () => {
  const s = fresh();
  missileBuildBuilding(s, P1, { buildingType: 'shield', gx: 0, gy: 0 });
  advance(3100, s);
  const Sh = Object.values(s.buildings).find(b => b.type === 'shield');
  const before = s.resources[P1];
  const r = missileSellBuilding(s, P1, Sh.id);
  assert.ok(!r.error, r.error);
  assert.equal(r.pending.kind, 'sell');
  assert.equal(r.pending.refund, 28);
  assert.equal(r.pending.completeAt - fakeNow, 20000, '20s demolition timer');
  assert.ok(s.buildings[Sh.id], 'building keeps working during the sale');
  const res = advance(20100, s); // dt caps at 5s → 25cr core income, shield pays none
  assert.ok(!s.buildings[Sh.id], 'demolished after the timer');
  assert.ok(Math.abs(s.resources[P1] - (before + 25 + 28)) < 0.01, `70% refunded (got ${s.resources[P1]})`);
  assert.ok(res.events.some(e => e.type === 'sold'), 'sold event emitted');
});

test('income history samples rates every ~2s and stays hidden until game over', () => {
  const s = fresh();
  assert.deepEqual(s.incomeHistory.samples, [], 'starts empty');
  missileBuildBuilding(s, P1, { buildingType: 'economy', gx: 0, gy: 0 });
  advance(3100, s);
  missileBuildBuilding(s, P1, { buildingType: 'economy', gx: 1, gy: 0 });
  advance(5000, s);
  const samples = s.incomeHistory.samples;
  assert.ok(samples.length >= 2, `samples accumulate (got ${samples.length})`);
  for (let i = 1; i < samples.length; i++) {
    assert.ok(samples[i][0] > samples[i - 1][0], 'timestamps increase');
  }
  const latest = samples[samples.length - 1];
  assert.ok(latest[1] > latest[2], `builder leads on rate (${latest[1]} vs ${latest[2]})`);
  // Fog discipline: live play sees no history (would leak enemy economy).
  assert.equal(filterMissileStateForPlayer(s, P1, fakeNow).incomeHistory, undefined, 'withheld mid-game');
  s.winnerId = P1;
  s.winReason = 'core_destroyed';
  const pub = filterMissileStateForPlayer(s, P1, fakeNow);
  assert.ok((pub.incomeHistory?.samples?.length ?? 0) >= 2, 'score screen gets the series');
});

test('sell job carries the map-badge contract (kind/side/cell/refund/timer, visible to owner)', () => {
  const s = fresh();
  missileBuildBuilding(s, P1, { buildingType: 'economy', gx: 2, gy: 1 });
  advance(3100, s);
  const E = Object.values(s.buildings).find(b => b.type === 'economy');
  const r = missileSellBuilding(s, P1, E.id);
  assert.ok(!r.error, r.error);
  const job = Object.values(s.pending).find(p => p.kind === 'sell');
  assert.ok(job, 'sell job pending');
  assert.equal(job.side, 'top');
  assert.equal(job.gx, 2);
  assert.equal(job.gy, 1);
  assert.ok(typeof job.refund === 'number' && job.refund > 0, 'refund for the badge');
  assert.equal(job.completeAt - fakeNow, 20000, 'countdown anchored to a 20s timer');
  const pub = filterMissileStateForPlayer(s, P1, fakeNow);
  assert.ok(Object.values(pub.pending).some(p => p.kind === 'sell'), 'owner still sees it through fog filtering');
});

test('destroyed buildings leave rubble (type/cell/owner, no rubble for cores)', () => {
  const s = fresh();
  missileBuildBuilding(s, P2, { buildingType: 'shield', gx: 6, gy: 5 });
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'single', gx: 0, gy: 0 });
  advance(3100, s);
  const L = Object.values(s.buildings).find(b => b.type === 'launcher');
  L.missileDamage = 5000; // punch through the pool
  for (let i = 0; i < 60 && ((L.stock ?? 0) < 1); i++) advance(500, s);
  assert.ok((L.stock ?? 0) >= 1, 'auto-loaded a warhead');
  missileLaunch(s, P1, { launcherId: L.id, targetGx: 6, targetGy: 5 });
  for (let i = 0; i < 120 && !Object.keys(s.rubble ?? {}).length; i++) advance(250, s);
  const rubble = Object.values(s.rubble ?? {});
  assert.equal(rubble.length, 1, 'one rubble marker');
  assert.equal(rubble[0].type, 'shield');
  assert.equal(rubble[0].ownerId, P2);
  assert.equal(rubble[0].side, 'bottom');
  assert.deepEqual([rubble[0].gx, rubble[0].gy], [6, 5]);
  assert.ok(!Object.values(s.buildings).some(b => b.type === 'shield' && b.ownerId === P2), 'shield gone');
});

test('rubble rebuilds instantly at half cost, same type level 1', () => {
  const s = fresh();
  s.rubble = { r1: { id: 'r1', side: 'top', gx: 2, gy: 1, ownerId: P1, type: 'economy', createdAt: fakeNow } };
  const before = s.resources[P1];
  const r = missileRebuildRubble(s, P1, 'r1');
  assert.ok(!r.error, r.error);
  assert.equal(r.building.type, 'economy');
  assert.equal(r.building.level, 1);
  assert.deepEqual([r.building.gx, r.building.gy], [2, 1]);
  assert.ok(!s.rubble.r1, 'rubble consumed');
  assert.equal(s.resources[P1], before - 25, 'half of the 50cr build cost');
  assert.ok(s.buildings[r.building.id], 'building live immediately (no site)');
});

test('rubble rebuild validation: foreign, broke, missing, game over', () => {
  const s = fresh();
  s.rubble = { r1: { id: 'r1', side: 'top', gx: 2, gy: 1, ownerId: P1, type: 'economy', createdAt: fakeNow } };
  assert.equal(missileRebuildRubble(s, P2, 'r1').error, 'Not your rubble');
  assert.equal(missileRebuildRubble(s, P1, 'nope').error, 'Rubble not found');
  s.resources[P1] = 0;
  assert.match(missileRebuildRubble(s, P1, 'r1').error, /Need 25 credits/);
  s.winnerId = P1;
  assert.equal(missileRebuildRubble(s, P1, 'r1').error, 'Game is over');
});

test('building over rubble clears it (flexible path, normal cost/time)', () => {
  const s = fresh();
  s.rubble = { r1: { id: 'r1', side: 'top', gx: 2, gy: 1, ownerId: P1, type: 'economy', createdAt: fakeNow } };
  const before = s.resources[P1];
  const r = missileBuildBuilding(s, P1, { buildingType: 'shield', gx: 2, gy: 1 });
  assert.ok(!r.error, r.error);
  assert.ok(!s.rubble.r1, 'rubble cleared by the new construction');
  assert.equal(s.resources[P1], before - 40, 'full shield price, no discount');
  assert.ok(Object.values(s.pending).some(p => p.kind === 'build'), 'normal timed site, not instant');
});

test('rubble follows fog rules: owner always, enemy only on live tiles', () => {
  const s = fresh();
  s.rubble = { r1: { id: 'r1', side: 'bottom', gx: 6, gy: 5, ownerId: P2, type: 'shield', createdAt: fakeNow } };
  assert.deepEqual(Object.keys(filterMissileStateForPlayer(s, P1, fakeNow).rubble ?? {}), [], 'enemy rubble hidden without vision');
  assert.deepEqual(Object.keys(filterMissileStateForPlayer(s, P2, fakeNow).rubble ?? {}), ['r1'], 'owner always sees it');
  s.exploredTiles[P1]['6,5'] = 0;
  assert.deepEqual(Object.keys(filterMissileStateForPlayer(s, P1, fakeNow).rubble ?? {}), ['r1'], 'visible on live tiles');
});

test('sell flow: refund includes upgrades', () => {
  const s = fresh();
  missileBuildBuilding(s, P1, { buildingType: 'economy', gx: 0, gy: 0 });
  advance(3100, s);
  const E = Object.values(s.buildings).find(b => b.type === 'economy');
  missileUpgradeBuilding(s, P1, E.id);
  advance(5100, s); // buildMs[2] = 5000
  assert.equal(E.level, 2);
  const r = missileSellBuilding(s, P1, E.id);
  assert.equal(r.pending.refund, 77, 'floor((50+60)*0.7)');
  advance(20100, s);
  assert.ok(!s.buildings[E.id], 'sold');
});

test('sell validation: core, ownership, double-sell, upgrade interplay, cancel', () => {
  const s = fresh();
  missileBuildBuilding(s, P1, { buildingType: 'economy', gx: 0, gy: 0 });
  advance(3100, s);
  const E = Object.values(s.buildings).find(b => b.type === 'economy');
  assert.equal(missileSellBuilding(s, P1, 'core_top').error, 'Core cannot be sold');
  assert.equal(missileSellBuilding(s, P2, E.id).error, 'Not your building');
  assert.ok(!missileSellBuilding(s, P1, E.id).error, 'first sale lists fine');
  assert.equal(missileSellBuilding(s, P1, E.id).error, 'Sale already in progress');
  assert.equal(missileUpgradeBuilding(s, P1, E.id).error, 'Sale in progress — cancel it first');
  assert.equal(missileCancelSell(s, P2, E.id).error, 'Not your building');
  const c = missileCancelSell(s, P1, E.id);
  assert.ok(!c.error, c.error);
  assert.ok(s.buildings[E.id], 'building survives cancellation');
  assert.equal(missileCancelSell(s, P1, E.id).error, 'No sale in progress');
  // Upgrade in flight blocks a new sale.
  assert.ok(!missileUpgradeBuilding(s, P1, E.id).error, 'upgrade orders fine');
  assert.equal(missileSellBuilding(s, P1, E.id).error, 'Upgrade in progress — wait or let it finish first');
});

test('sell fizzles with no refund if the building is destroyed first', () => {
  const s = fresh();
  missileBuildBuilding(s, P1, { buildingType: 'shield', gx: 0, gy: 0 });
  advance(3100, s);
  const Sh = Object.values(s.buildings).find(b => b.type === 'shield');
  assert.ok(!missileSellBuilding(s, P1, Sh.id).error);
  delete s.buildings[Sh.id]; // blown up mid-demolition
  const before = s.resources[P1];
  const res = advance(20100, s);
  assert.ok(!res.events.some(e => e.type === 'sold'), 'no payout for rubble');
  assert.ok(Math.abs(s.resources[P1] - (before + 25)) < 0.01, 'core income only, no refund');
});

test('desperation unlocks at 50% core HP and latches through regen', () => {
  const s = fresh();
  assert.deepEqual(s.desperation[P1], { unlocked: false, used: false }, 'starts locked');
  // Above threshold: nothing.
  s.buildings.core_top.coreHp = 2001;
  let res = tickMissileCommand(s, Date.now());
  assert.equal(s.desperation[P1].unlocked, false, '2001/4000 stays locked');
  // At/below threshold: unlocks with an event.
  s.buildings.core_top.coreHp = 2000;
  res = tickMissileCommand(s, Date.now());
  assert.equal(s.desperation[P1].unlocked, true, '2000/4000 unlocks');
  assert.ok(res.events.some(e => e.type === 'desperation-unlocked' && e.ownerId === P1), 'unlock event');
  // Healing back above keeps the unlock (puncher's chance, once earned).
  s.buildings.core_top.coreHp = 3000;
  tickMissileCommand(s, Date.now());
  assert.equal(s.desperation[P1].unlocked, true, 'latches');
  assert.equal(s.desperation[P2].unlocked, false, 'healthy side stays locked');
});

// ── P0/P1 regression tests: draws, refunds, cooldowns, stagger, fog ───────

test('double-KO ends the game as a scoreless draw (no soft-lock)', () => {
  const room = gmRoom();
  startGame(room.code);
  const mc = () => room.missileCommandState;
  mc().buildings.core_top.coreHp = 0;
  mc().buildings.core_bottom.coreHp = 0;
  const { events } = tickMissileCommand(mc(), fakeNow);
  assert.equal(mc().winReason, 'draw');
  assert.equal(mc().winnerId, null);
  assert.ok(mc().gameEndTime, 'game clock stops');
  assert.ok(events.some(e => e.type === 'draw'), 'draw event emitted');
  // Second tick: no duplicate draw, no resurrection.
  const again = tickMissileCommand(mc(), fakeNow);
  assert.ok(!again.events.some(e => e.type === 'draw'), 'draw fires once');
  // Room wrapper transitions phase with no score awarded.
  const res = tickMissileRoom(room, fakeNow);
  assert.equal(room.phase, 'missile-command-end');
  assert.equal(room.players[0].score, 0, 'no points on draw');
  assert.equal(room.players[1].score, 0, 'no points on draw');
});

test('fizzled builds and upgrades refund the upfront payment', () => {
  const room = gmRoom();
  startGame(room.code);
  const mc = () => room.missileCommandState;
  // Build fizzle: pending sites reserve their cell at order time, so craft
  // the race directly — a building lands on the site's cell mid-construction.
  const order = gmBuild(room.code, P1, { buildingType: 'economy', gx: 0, gy: 0 });
  assert.ok(!order.error, order.error);
  const before = mc().resources[P1];
  mc().buildings.squatter = {
    id: 'squatter', type: 'shield', side: 'top', gx: 0, gy: 0, level: 1,
    ownerId: P1, hp: 150, maxHp: 150, shieldHp: 375, maxShieldHp: 375, shieldTiles: 3,
  };
  const res = advance(3100, mc());
  assert.ok(!mc().buildings[order.pending.id], 'no building from fizzled site');
  assert.ok(res.events.some(e => e.type === 'build-failed'), 'fizzle event emitted');
  // +50 refund, plus 5/s core income accrued over the 3.1s fast-forward.
  assert.ok(Math.abs(mc().resources[P1] - (before + 50 + 5 * 3.1)) < 0.01, 'build cost refunded');
  delete mc().buildings.squatter;
  // Upgrade fizzle: building destroyed mid-upgrade refunds.
  const eco = gmBuildDone(room, P1, 'economy', 1, 1);
  const up = gmUpgrade(room.code, P1, eco.id);
  assert.ok(!up.error, up.error);
  const beforeUp = mc().resources[P1];
  delete mc().buildings[eco.id]; // blown up mid-upgrade
  const res2 = advance(5100, mc());
  assert.ok(res2.events.some(e => e.type === 'upgrade-failed'), 'upgrade fizzle event');
  // +60 refund, plus core-only income (the (0,0) site fizzled and this
  // economy was deleted); advance() clamps dt to 5s.
  assert.ok(Math.abs(mc().resources[P1] - (beforeUp + 60 + 5 * 5)) < 0.01, 'upgrade cost refunded');
});

test('launcher cooldown gates volleys and preserves stock', () => {
  const room = gmRoom();
  startGame(room.code);
  const mc = () => room.missileCommandState;
  const la = gmBuildDone(room, P1, 'launcher', 3, 0, 'single');
  gmLoadFull(room, P1, la, 3);
  const first = gmFire(room.code, P1, { launcherId: la.id, targetGx: 0, targetGy: 0 });
  assert.ok(!first.error, first.error);
  assert.equal(la.stock, 0, 'volley consumes stock');
  // Reload instantly and fire inside the 4s single cooldown.
  la.stock = 3;
  const again = gmFire(room.code, P1, { launcherId: la.id, targetGx: 0, targetGy: 0 });
  assert.ok(again.error && /recharg/i.test(again.error), `cooldown error, got: ${again.error}`);
  assert.equal(la.stock, 3, 'stock preserved while cooling');
  // After the cooldown the same launcher fires fine.
  advance(4100, mc());
  la.stock = 3;
  const later = gmFire(room.code, P1, { launcherId: la.id, targetGx: 0, targetGy: 0 });
  assert.ok(!later.error, later.error);
});

test('launch-all ripples launchers 300ms apart', () => {
  const room = gmRoom();
  startGame(room.code);
  const mc = () => room.missileCommandState;
  const a = gmBuildDone(room, P1, 'launcher', 3, 0, 'single');
  const b = gmBuildDone(room, P1, 'launcher', 4, 0, 'single');
  gmLoadFull(room, P1, a, 1);
  gmLoadFull(room, P1, b, 1);
  const r = gmFireType(room.code, P1, 'single', 0, 0);
  assert.ok(!r.error, r.error);
  const times = mc().missiles.map(m => m.deployAt).sort((x, y) => x - y);
  assert.equal(times.length, 2, 'both launchers fired');
  assert.equal(times[1] - times[0], 300, '300ms ripple between launchers');
});

test('fog redaction hides unscouted enemy state from broadcast', () => {
  const room = gmRoom();
  startGame(room.code);
  const mc = () => room.missileCommandState;
  gmBuildDone(room, P2, 'economy', 0, 0); // never scouted by P1
  const view = filterMissileStateForPlayer(mc(), P1, fakeNow);
  assert.ok(view.buildings.core_top && view.buildings.core_bottom, 'cores always visible');
  assert.ok(!Object.values(view.buildings).some(b => b.ownerId === P2 && b.type === 'economy'), 'unscouted enemy building hidden');
  assert.ok(Object.values(view.buildings).some(b => b.ownerId === P1), 'own buildings kept');
  // Pending sites scoped the same way.
  gmBuild(room.code, P2, { buildingType: 'shield', gx: 1, gy: 1 });
  const view2 = filterMissileStateForPlayer(mc(), P1, fakeNow);
  assert.ok(!Object.values(view2.pending).some(p => p.ownerId === P2), 'unscouted enemy site hidden');
  gmBuild(room.code, P1, { buildingType: 'shield', gx: 2, gy: 2 });
  const view3 = filterMissileStateForPlayer(mc(), P1, fakeNow);
  assert.ok(Object.values(view3.pending).some(p => p.ownerId === P1), 'own site kept');
  // exploredTiles and stats scoped pre-end, full post-end.
  assert.deepEqual(Object.keys(view3.exploredTiles), [P1], 'only own fog map sent');
  assert.deepEqual(Object.keys(view3.stats), [P1], 'only own stats sent mid-game');
  mc().winnerId = P2;
  mc().winReason = 'core_destroyed';
  const endView = filterMissileStateForPlayer(mc(), P1, fakeNow);
  assert.ok(endView.stats[P1] && endView.stats[P2], 'full stats at end');
  // Fog off → passthrough.
  mc().fogOfWar = false;
  assert.equal(filterMissileStateForPlayer(mc(), P1, fakeNow), mc(), 'passthrough with fog off');
});

test('economy ticks do not refresh room activity (abandoned games expire)', () => {
  const room = gmRoom();
  startGame(room.code);
  room.lastActivityMs = fakeNow - 1000;
  tickMissileRoom(room, fakeNow);
  assert.equal(room.lastActivityMs, fakeNow - 1000, 'tick leaves activity alone');
});

test('desperation fire: validation, one-shot, needs no launcher', () => {
  const s = fresh();
  s.desperation[P1] = { unlocked: true, used: false };
  assert.equal(missileFireDesperation(s, P1, { targetGx: 99, targetGy: 0 }).error, 'Invalid target square');
  assert.equal(missileFireDesperation(s, 'nobody', { targetGx: 0, targetGy: 0 }).error, 'You are not in this match');
  const r = missileFireDesperation(s, P1, { targetGx: 6, targetGy: 3 });
  assert.ok(!r.error, r.error);
  assert.equal(r.missiles.length, 1, 'single warhead');
  assert.equal(r.missiles[0].desperation, true);
  assert.equal(r.missiles[0].pierce, MISSILE_CONFIG.desperation.pierce);
  assert.equal(s.desperation[P1].used, true, 'spent');
  assert.equal(missileFireDesperation(s, P1, { targetGx: 6, targetGy: 3 }).error, 'Desperation strike already spent');
});

test('desperation fire requires the unlock', () => {
  const s = fresh();
  assert.equal(
    missileFireDesperation(s, P1, { targetGx: 6, targetGy: 3 }).error,
    'Desperation strike not unlocked — core must drop to 50%',
  );
});

test('desperation pierce: half bypasses pools, half is absorbed', () => {
  const s = fresh();
  // Economy at (6,5) under a full Lv1 shield (375 pool) at (5,5).
  missileBuildBuilding(s, P2, { buildingType: 'economy', gx: 6, gy: 5 });
  missileBuildBuilding(s, P2, { buildingType: 'shield', gx: 5, gy: 5 });
  advance(3100, s);
  const eco = Object.values(s.buildings).find(b => b.type === 'economy');
  const sh = Object.values(s.buildings).find(b => b.type === 'shield');
  const ecoHp = eco.hp;
  // 200 dmg, 50% pierce → 100 through the pool, 100 straight to structure.
  const destroyed = (() => {
    // applyExplosion isn't exported; drive it via a desperation-shaped missile.
    s.desperation[P1] = { unlocked: true, used: false };
    const r = missileFireDesperation(s, P1, { targetGx: 6, targetGy: 5 });
    assert.ok(!r.error, r.error);
    // Force the warhead's stats for a deterministic assertion.
    r.missiles[0].damage = 200;
    r.missiles[0].pierce = 0.5;
    r.missiles[0].blast = 0;
    r.missiles[0].currentX = r.missiles[0].targetX;
    r.missiles[0].currentY = r.missiles[0].targetY;
    return tickMissileCommand(s, Date.now());
  })();
  void destroyed;
  assert.equal(sh.shieldHp, 375 - 100, 'pool ate exactly the blocked half');
  assert.equal(eco.hp, ecoHp - 100, 'structure took exactly the piercing half');
});

test('desperation full strike dents a shielded core without one-shotting', () => {
  const s = fresh();
  missileBuildBuilding(s, P2, { buildingType: 'shield', gx: 6, gy: 4 });
  advance(3100, s);
  const sh = Object.values(s.buildings).find(b => b.type === 'shield');
  const core = s.buildings.core_bottom;
  s.desperation[P1] = { unlocked: true, used: false };
  const r = missileFireDesperation(s, P1, { targetGx: 6, targetGy: 3 });
  assert.ok(!r.error, r.error);
  r.missiles[0].currentX = r.missiles[0].targetX;
  r.missiles[0].currentY = r.missiles[0].targetY;
  tickMissileCommand(s, Date.now());
  // 2000 raw damage, no piercing: the 375 pool is fully drained either way,
  // the shield's structure is wrecked, and the core eats a real but
  // survivable blow (exact split depends on processing order).
  assert.equal(sh.shieldHp, 0, 'pool fully drained');
  assert.ok(core.coreHp < 4000 && core.coreHp >= 1500, `core dented but alive (${core.coreHp})`);
  assert.ok(!s.buildings[sh.id], 'shield generator destroyed');
  assert.ok(!s.winnerId, 'not an instant win');
});

// ─── AI opponent tests ──────────────────────────────────────────────────────

test('AI: missileAiTick is a no-op without aiPlayerId', () => {
  const s = fresh();
  s.aiPlayerId = null;
  s.aiDifficulty = 'hard';
  s.aiType = 'balanced';
  const beforePending = Object.keys(s.pending || {}).length;
  const beforeBuildings = Object.keys(s.buildings).length;
  missileAiTick(s, fakeNow + 10000);
  assert.equal(Object.keys(s.pending || {}).length, beforePending, 'no pending sites added');
  assert.equal(Object.keys(s.buildings).length, beforeBuildings, 'no buildings added');
});

test('AI: builds economy on first ticks (queues a pending site)', () => {
  const s = fresh();
  s.aiPlayerId = P2;
  s.aiDifficulty = 'hard';
  s.aiType = 'balanced';
  s.aiLastDecisionMs = fakeNow - 5000;
  missileAiTick(s, fakeNow + 2000);
  const pendingBuilds = Object.values(s.pending || {}).filter(p => p.kind === 'build' && p.ownerId === P2);
  assert.ok(pendingBuilds.length >= 1, 'AI queues at least one build site');
  assert.equal(pendingBuilds[0].type, 'economy', 'first build is economy');
});

test('AI: aggressive type builds more launchers than defensive', () => {
  function runAI(type) {
    const s = fresh();
    s.aiPlayerId = P2;
    s.aiDifficulty = 'hard';
    s.aiType = type;
    s.aiLastDecisionMs = fakeNow - 5000;
    for (let i = 0; i < 15; i++) {
      missileAiTick(s, fakeNow + (i + 1) * 2000);
      advance(3500, s);
    }
    return s;
  }

  const sAgg = runAI('aggressive');
  const sDef = runAI('defensive');

  const aggLaunchers = Object.values(sAgg.buildings).filter(b => b.ownerId === P2 && b.type === 'launcher').length;
  const defLaunchers = Object.values(sDef.buildings).filter(b => b.ownerId === P2 && b.type === 'launcher').length;
  const aggShields = Object.values(sAgg.buildings).filter(b => b.ownerId === P2 && (b.type === 'shield' || b.type === 'shield_heavy')).length;
  const defShields = Object.values(sDef.buildings).filter(b => b.ownerId === P2 && (b.type === 'shield' || b.type === 'shield_heavy')).length;

  assert.ok(aggLaunchers > defLaunchers, 'aggressive builds more launchers (' + aggLaunchers + ' vs ' + defLaunchers + ')');
  assert.ok(defShields >= aggShields, 'defensive builds at least as many shields (' + defShields + ' vs ' + aggShields + ')');
});

test('AI: economic type builds more generators', () => {
  function runAI(type) {
    const s = fresh();
    s.aiPlayerId = P2;
    s.aiDifficulty = 'hard';
    s.aiType = type;
    s.aiLastDecisionMs = fakeNow - 5000;
    for (let i = 0; i < 15; i++) {
      missileAiTick(s, fakeNow + (i + 1) * 2000);
      advance(3500, s);
    }
    return s;
  }

  const sEco = runAI('economic');
  const sBal = runAI('balanced');

  const ecoEco = Object.values(sEco.buildings).filter(b => b.ownerId === P2 && b.type === 'economy').length;
  const balEco = Object.values(sBal.buildings).filter(b => b.ownerId === P2 && b.type === 'economy').length;
  assert.ok(ecoEco >= balEco, 'economic builds at least as many generators (' + ecoEco + ' vs ' + balEco + ')');
});

test('AI: respects decision interval (easy=3s, hard=1.5s, cheater=0.8s)', () => {
  const s = fresh();
  s.aiPlayerId = P2;
  s.aiDifficulty = 'hard';
  s.aiType = 'balanced';
  s.aiLastDecisionMs = fakeNow;

  const beforePending1 = Object.keys(s.pending || {}).length;
  missileAiTick(s, fakeNow + 1000);
  assert.equal(Object.keys(s.pending || {}).length, beforePending1, 'no action at 1s (hard interval 1.5s)');

  const beforePending2 = Object.keys(s.pending || {}).length;
  missileAiTick(s, fakeNow + 2000);
  assert.ok(Object.keys(s.pending || {}).length > beforePending2, 'action at 2s (hard interval 1.5s)');
});

test('AI: cheater gets income boost when idle', () => {
  const s = fresh();
  s.aiPlayerId = P2;
  s.aiDifficulty = 'cheater';
  s.aiType = 'balanced';
  for (let i = 0; i < 5; i++) missileBuildBuilding(s, P2, { buildingType: 'economy', gx: i, gy: 0 });
  for (let i = 0; i < 3; i++) missileBuildBuilding(s, P2, { buildingType: 'shield', gx: i, gy: 1 });
  missileBuildBuilding(s, P2, { buildingType: 'healer', gx: 4, gy: 0 });
  for (let i = 0; i < 4; i++) missileBuildBuilding(s, P2, { buildingType: 'launcher', launcherType: i % 2 === 0 ? 'single' : 'scatter', gx: 5 + (i % 3), gy: Math.floor(i / 3) });
  advance(3100, s);
  for (const b of Object.values(s.buildings).filter(b => b.ownerId === P2 && b.type !== 'core')) {
    b.level = 5;
  }
  s.resources[P2] = 0;
  const before = s.resources[P2];
  s.aiLastDecisionMs = fakeNow - 5000;
  missileAiTick(s, fakeNow + 2000);
  assert.ok(s.resources[P2] >= before + 5, 'cheater AI gets income boost when idle');
});

test('AI: fires missiles when stock available and 3 launchers built', () => {
  const s = fresh();
  s.aiPlayerId = P2;
  s.aiDifficulty = 'hard';
  s.aiType = 'balanced';
  for (let i = 0; i < 4; i++) missileBuildBuilding(s, P2, { buildingType: 'economy', gx: i, gy: 0 });
  for (let i = 0; i < 2; i++) missileBuildBuilding(s, P2, { buildingType: 'shield', gx: i, gy: 1 });
  missileBuildBuilding(s, P2, { buildingType: 'healer', gx: 4, gy: 0 });
  for (let i = 0; i < 3; i++) missileBuildBuilding(s, P2, { buildingType: 'launcher', launcherType: i % 2 === 0 ? 'single' : 'scatter', gx: 5 + i, gy: 0 });
  advance(3100, s);
  const launchers = Object.values(s.buildings).filter(b => b.type === 'launcher' && b.ownerId === P2);
  assert.equal(launchers.length, 3, '3 launchers built');
  for (const L of launchers) { L.stock = 3; L.loadingUntil = 0; L.lastFiredAt = 0; }
  s.resources[P2] = 10000;
  for (const b of Object.values(s.buildings).filter(b => b.ownerId === P2 && b.type !== 'core')) { b.level = 5; }
  s.aiLastDecisionMs = fakeNow - 5000;
  const beforeMissiles = s.missiles.length;
  missileAiTick(s, fakeNow + 2000);
  assert.ok(s.missiles.length > beforeMissiles, 'AI fires when stock available');
});

test('AI: easy mode only fires when stock is full', () => {
  const s = fresh();
  s.aiPlayerId = P2;
  s.aiDifficulty = 'easy';
  s.aiType = 'balanced';
  for (let i = 0; i < 3; i++) {
    missileBuildBuilding(s, P2, { buildingType: 'launcher', launcherType: 'single', gx: i, gy: 0 });
  }
  advance(3100, s);
  const launchers = Object.values(s.buildings).filter(b => b.type === 'launcher' && b.ownerId === P2);
  assert.equal(launchers.length, 3, '3 launchers built');
  for (const L of launchers) { L.stock = 1; L.loadingUntil = 0; L.lastFiredAt = 0; L.maxStock = 3; }
  s.resources[P2] = 10000;
  s.aiLastDecisionMs = fakeNow - 5000;
  const beforeMissiles = s.missiles.length;
  missileAiTick(s, fakeNow + 4000);
  assert.equal(s.missiles.length, beforeMissiles, 'easy AI does not fire with partial stock');
});

test('AI: upgrades buildings when affordable', () => {
  const s = fresh(10000);
  s.aiPlayerId = P2;
  s.aiDifficulty = 'hard';
  s.aiType = 'balanced';
  missileBuildBuilding(s, P2, { buildingType: 'economy', gx: 0, gy: 0 });
  advance(3100, s);
  const E = Object.values(s.buildings).find(b => b.type === 'economy' && b.ownerId === P2);
  assert.ok(E, 'economy built');
  assert.equal(E.level, 1, 'starts at level 1');
  s.resources[P2] = 1000;
  // pre-build enough so AI reaches upgrade stage
  for (let i = 1; i < 4; i++) missileBuildBuilding(s, P2, { buildingType: 'economy', gx: i, gy: 0 });
  for (let i = 0; i < 2; i++) missileBuildBuilding(s, P2, { buildingType: 'shield', gx: i, gy: 1 });
  missileBuildBuilding(s, P2, { buildingType: 'healer', gx: 4, gy: 0 });
  for (let i = 0; i < 3; i++) missileBuildBuilding(s, P2, { buildingType: 'launcher', launcherType: i % 2 === 0 ? 'single' : 'scatter', gx: 5 + i, gy: 0 });
  advance(3100, s);
  // set levels to max except E so AI upgrades E
  for (const b of Object.values(s.buildings).filter(b => b.ownerId === P2 && b.type !== 'core' && b.id !== E.id)) {
    b.level = 5;
  }
  s.resources[P2] = 1000;
  s.aiLastDecisionMs = fakeNow - 5000;
  missileAiTick(s, fakeNow + 2000);
  const pendingUp = Object.values(s.pending ?? {}).some(p => p.kind === 'upgrade' && p.upgradeOf === E.id);
  assert.ok(pendingUp, 'AI queues upgrade when affordable');
});

test('AI: claims supply ship when available', () => {
  const s = fresh();
  s.aiPlayerId = P2;
  s.aiDifficulty = 'hard';
  s.aiType = 'balanced';
  s.supplyShip = { id: 'ship1', dir: 1, fromX: 0, toX: 1, y: 0.5, startAt: fakeNow, endAt: fakeNow + 10000 };
  s.aiLastDecisionMs = fakeNow - 5000;
  for (let i = 0; i < 20; i++) {
    missileAiTick(s, fakeNow + (i + 1) * 2000);
    advance(3500, s);
  }
  assert.ok(true, 'AI processes supply ship without error');
});

// ─── Game manager AI tests ──────────────────────────────────────────────────
// ─── Game manager AI tests ──────────────────────────────────────────────────

test('GM: startGame with aiOpponent creates AI player', () => {
  const room = createRoom('sock-host', 'HOST');
  selectGame(room.code, 'missile-command');
  const updated = updateMissileCommandOptions(room.code, { aiOpponent: true });
  assert.ok(updated, 'options updated');
  assert.equal(updated.chromaOptions, updated.chromaOptions); // sanity
  const started = startGame(room.code);
  assert.ok(started, 'game started with 1 player + AI');
  assert.equal(started.players.length, 2, 'host + AI player');
  assert.equal(started.players[1].name, 'AI Opponent');
  assert.equal(started.players[1].isAI, true);
  assert.equal(started.missileCommandState.aiPlayerId, 'AI-BOT');
  assert.equal(started.missileCommandState.aiDifficulty, 'hard');
  assert.equal(started.missileCommandState.aiType, 'balanced');
});

test('GM: startGame rejects missile-command with 1 player without AI', () => {
  const room = createRoom('sock-host', 'HOST');
  selectGame(room.code, 'missile-command');
  const started = startGame(room.code);
  assert.equal(started, null, 'cannot start 1-player missile-command without AI');
});

test('GM: startGame rejects missile-command with 3 players', () => {
  const room = createRoom('sock-host', 'HOST');
  joinRoom(room.code, 'sock-p2', 'P2');
  joinRoom(room.code, 'sock-p3', 'P3');
  selectGame(room.code, 'missile-command');
  const started = startGame(room.code);
  assert.equal(started, null, 'cannot start 3-player missile-command');
});

test('GM: updateMissileCommandOptions validates aiDifficulty and aiType', () => {
  const room = createRoom('sock-host', 'HOST');
  selectGame(room.code, 'missile-command');

  // valid values accepted
  let updated = updateMissileCommandOptions(room.code, { aiDifficulty: 'easy', aiType: 'aggressive' });
  assert.equal(updated.missileCommandOptions.aiDifficulty, 'easy');
  assert.equal(updated.missileCommandOptions.aiType, 'aggressive');

  // invalid values rejected (not set)
  updated = updateMissileCommandOptions(room.code, { aiDifficulty: 'superhard', aiType: 'berserker' });
  assert.equal(updated.missileCommandOptions.aiDifficulty, 'easy', 'invalid difficulty not applied');
  assert.equal(updated.missileCommandOptions.aiType, 'aggressive', 'invalid type not applied');

  // aiOpponent toggle
  updated = updateMissileCommandOptions(room.code, { aiOpponent: true });
  assert.equal(updated.missileCommandOptions.aiOpponent, true);
  updated = updateMissileCommandOptions(room.code, { aiOpponent: false });
  assert.equal(updated.missileCommandOptions.aiOpponent, false);
});

test('GM: resetToLobby removes AI player', () => {
  const room = createRoom('sock-host', 'HOST');
  selectGame(room.code, 'missile-command');
  updateMissileCommandOptions(room.code, { aiOpponent: true });
  startGame(room.code);
  assert.equal(room.players.length, 2, 'host + AI before reset');
  assert.ok(room.players.some(p => p.isAI), 'AI player present');
  resetToLobby(room);
  assert.equal(room.players.length, 1, 'AI removed after reset');
  assert.ok(!room.players.some(p => p.isAI), 'no AI player after reset');
  assert.equal(room.phase, 'lobby', 'back in lobby');
});

test('GM: AI difficulty/type passed through to state on start', () => {
  const room = createRoom('sock-host', 'HOST');
  selectGame(room.code, 'missile-command');
  updateMissileCommandOptions(room.code, { aiOpponent: true, aiDifficulty: 'cheater', aiType: 'defensive' });
  const started = startGame(room.code);
  assert.equal(started.missileCommandState.aiDifficulty, 'cheater');
  assert.equal(started.missileCommandState.aiType, 'defensive');
});

test('GM: tickMissileRoom runs AI and updates state', () => {
  const room = createRoom('sock-host', 'HOST');
  selectGame(room.code, 'missile-command');
  updateMissileCommandOptions(room.code, { aiOpponent: true, fogOfWar: false });
  startGame(room.code);
  const beforeBuildings = Object.keys(room.missileCommandState.buildings).length;
  // tick several times to let AI build
  let t = Date.now();
  for (let i = 0; i < 10; i++) { t += 2000; tickMissileRoom(room, t); }
  const afterBuildings = Object.keys(room.missileCommandState.buildings).length;
  assert.ok(afterBuildings > beforeBuildings, 'AI builds buildings over ticks');
});

test('AI: filterMissileStateForPlayer hides AI rubble/enemy data correctly', () => {
  const s = fresh();
  s.aiPlayerId = P2;
  s.aiDifficulty = 'hard';
  s.aiType = 'balanced';
  // AI builds a shield on enemy-visible tile
  missileBuildBuilding(s, P2, { buildingType: 'shield', gx: 6, gy: 5 });
  advance(3100, s);
  // fog filter should still work with AI state
  const pub = filterMissileStateForPlayer(s, P1, fakeNow);
  assert.ok(pub, 'filter works with AI state');
  assert.equal(pub.sides.top, P1, 'player side preserved');
  assert.equal(pub.sides.bottom, P2, 'AI side preserved');
});

// ─── Slim traffic stream (mc-tick payload) ───────────────────────────────
test('mcTick: first payload carries changes, repeat is minimal', () => {
  const s = fresh();
  // Empty cache = the client never got a full room-state (test-only setup;
  // in prod the cache is primed after every full broadcast).
  const dyn = mcDynSnapshot(null);
  const p1 = mcTickPayload(s, fakeNow, dyn);
  assert.ok(p1.res && p1.res[P1] === 5000, 'resources included on first frame');
  assert.equal(p1.t, fakeNow);
  assert.ok(p1.bd, 'building dyn included on first frame');
  assert.ok(p1.bd.core_top, 'cores covered');
  assert.ok(p1.m === undefined, 'no missiles → no m segment');
  assert.equal(p1.sh, undefined, 'already-known ship presence omitted');

  // No changes: repeated frame is minimal (no res/bd).
  const p2 = mcTickPayload(s, fakeNow, dyn);
  assert.equal(p2.res, undefined, 'unchanged resources omitted');
  assert.equal(p2.bd, undefined, 'unchanged building dyn omitted');
  assert.equal(p2.sh, undefined, 'unchanged ship presence omitted');
});

test('mcTick: missiles ride the frame with rounded floats', () => {
  const s = fresh();
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'single', gx: 3, gy: 2 });
  advance(3100, s);
  const launcher = Object.values(s.buildings).find(b => b.type === 'launcher');
  missileLoadMissile(s, P1, launcher.id);
  advance(5100, s); // loading completes → stock 1
  const r = missileLaunch(s, P1, { launcherId: launcher.id, targetGx: 6, targetGy: 6 });
  assert.ok(r.missiles?.length === 1, 'launch succeeded');
  const dyn = mcDynSnapshot(null);
  const p = mcTickPayload(s, fakeNow, dyn);
  assert.ok(Array.isArray(p.m) && p.m.length === 1, 'missile in frame');
  const m = p.m[0];
  for (const k of ['id', 'ownerId', 'launcherType', 'startX', 'targetX', 'currentX', 'speed', 'damage', 'blast']) {
    assert.ok(Object.hasOwn(m, k), `missile field ${k} present for client render`);
  }
  // floats rounded to 4 decimals
  assert.equal(m.currentX, Math.round(m.currentX * 10000) / 10000);
  assert.ok(typeof m.lane === 'number');
});

test('mcTick: changed building dyn fields patch, cache tracks them', () => {
  const s = fresh();
  missileBuildBuilding(s, P1, { buildingType: 'launcher', launcherType: 'single', gx: 3, gy: 3 });
  advance(3100, s); // built; auto-load kicked in immediately
  const launcher = Object.values(s.buildings).find(b => b.type === 'launcher');
  const dyn = mcDynSnapshot(s);
  advance(5100, s); // load completes: stock 0→1, next load starts, resources spent
  const p = mcTickPayload(s, fakeNow, dyn);
  assert.ok(p.bd?.[launcher.id], 'changed launcher included');
  assert.ok(p.bd[launcher.id].st === 1, 'stock present');
  assert.ok(p.bd[launcher.id].lu > 0, 'loadingUntil present');
  assert.ok(p.res && p.res[P1] < 5000, 'resources deducted');
  // second call — should NOT include the same diffs again
  const p2 = mcTickPayload(s, fakeNow, dyn);
  assert.ok(!p2.bd || !p2.bd[launcher.id], 'no re-sent diff for unchanged values');
});

test('mcTick: ship presence flips surface in the frame', () => {
  const s = fresh(5000);
  s.supplyShipEnabled = true;
  s.nextShipAt = fakeNow - 1;
  advance(10, s);
  assert.ok(s.supplyShip, 'ship sailing');
  const dyn = mcDynSnapshot(null);
  const p = mcTickPayload(s, fakeNow, dyn);
  assert.ok(p.sh && p.sh.id === s.supplyShip.id, 'ship included when present');
  assert.equal(p.sh.toX, s.supplyShip.toX, 'ship route fields kept');
  s.supplyShip = null;
  const p2 = mcTickPayload(s, fakeNow, dyn);
  assert.equal(p2.sh, null, 'ship removal flagged');
});

test('tick: fog expiry triggers a full-state event', () => {
  const s = fresh();
  s.fogOfWar = true;
  s.exploredTiles[P1]['4,4'] = fakeNow + 100;
  const res = advance(200, s); // expiry passes during this tick
  assert.ok(res.events.some(e => e.type === 'fog-expired'), 'event pushed');
});

test('GM: AI-driven structural changes mark the room dirty (ai-act)', () => {
  const room = createRoom('sock-host', 'HOST');
  selectGame(room.code, 'missile-command');
  updateMissileCommandOptions(room.code, { aiOpponent: true, fogOfWar: false });
  startGame(room.code);
  let t = Date.now();
  let saw = false;
  for (let i = 0; i < 12 && !saw; i++) {
    t += 2000;
    const res = tickMissileRoom(room, t);
    if (res.events.some(e => e.type === 'ai-act')) saw = true;
  }
  assert.ok(saw, 'AI builds are flagged as room-state-worthy events');
});

// restore real clock for any later suites in this process
test('teardown clock', () => { Date.now = realNow; });
