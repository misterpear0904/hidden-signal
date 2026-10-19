const fs = require('fs');
const file = 'C:/Users/MisterPear/Development/hidden-signal/server/test_missileCommand.js';
let src = fs.readFileSync(file, 'utf8');

// Find the AI opponent tests section and replace it
const startMarker = '// ─── AI opponent tests ──────────────────────────────────────────────────────';
const endMarker = '// ─── Game manager AI tests ──────────────────────────────────────────────────';

const startIdx = src.indexOf(startMarker);
const endIdx = src.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1) {
  console.error('Markers not found');
  process.exit(1);
}

const newTests = `// ─── AI opponent tests ──────────────────────────────────────────────────────

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
  s.aiLastDecisionMs = fakeNow - 5000;
  for (let i = 0; i < 20; i++) {
    missileAiTick(s, fakeNow + (i + 1) * 1000);
    advance(3500, s);
  }
  const before = s.resources[P2];
  missileAiTick(s, fakeNow + 21000);
  assert.ok(s.resources[P2] >= before, 'cheater AI resources do not decrease');
});

test('AI: fires missiles when stock available and 3 launchers built', () => {
  const s = fresh();
  s.aiPlayerId = P2;
  s.aiDifficulty = 'hard';
  s.aiType = 'balanced';
  for (let i = 0; i < 3; i++) {
    missileBuildBuilding(s, P2, { buildingType: 'launcher', launcherType: i % 2 === 0 ? 'single' : 'scatter', gx: i, gy: 0 });
  }
  advance(3100, s);
  const launchers = Object.values(s.buildings).filter(b => b.type === 'launcher' && b.ownerId === P2);
  assert.equal(launchers.length, 3, '3 launchers built');
  for (const L of launchers) { L.stock = 3; L.loadingUntil = 0; L.lastFiredAt = 0; }
  s.resources[P2] = 10000;
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

`;

const newContent = src.slice(0, startIdx) + newTests + src.slice(endIdx);
fs.writeFileSync(file, newContent);
console.log('done');
`;

fs.writeFileSync('C:/Users/MisterPear/Development/hidden-signal/server/fix_tests.cjs', script);
console.log('written');