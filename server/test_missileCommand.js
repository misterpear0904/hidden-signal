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
import {
  rooms,
  startGame,
  buildMissileBuilding as gmBuild,
  upgradeMissileBuilding as gmUpgrade,
  loadMissile as gmLoad,
  launchMissile as gmFire,
  launchMissileType as gmFireType,
  tickMissileRoom,
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
  for (let i = 0; i < n; i++) {
    launcher.loadingUntil = 0;
    const r = gmLoad(room.code, playerId, launcher.id);
    assert.ok(!r.error, `load ${i + 1}: ${r.error}`);
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
    while (!room.missileCommandState.winnerId && guard++ < 12) {
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
    assert.ok(Math.abs(mc().resources[P1] - before - 250) < 0.01, '20/s gen + 5/s core × 10s');
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

test('building cap counts non-core buildings', () => {
  const room = gmRoom(99999);
  try {
    startGame(room.code);
    const mc = () => room.missileCommandState;
    for (let i = 0; i < 40; i++) {
      const gx = i % 13, gy = Math.floor(i / 13);
      const r = gmBuild(room.code, P1, { buildingType: 'economy', gx, gy });
      assert.ok(!r.error, `build ${i}: ${r.error}`);
    }
    const capped = gmBuild(room.code, P1, { buildingType: 'economy', gx: 12, gy: 6 });
    assert.equal(capped.error, 'Building cap reached');
    advance(3100, mc());
    assert.equal(Object.values(mc().buildings).filter(b => b.type === 'economy').length, 40);
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

// restore real clock for any later suites in this process
test('teardown clock', () => { Date.now = realNow; });
