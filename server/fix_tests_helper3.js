const fs = require('fs');
const file = 'C:/Users/MisterPear/Development/hidden-signal/server/test_missileCommand.js';
let src = fs.readFileSync(file, 'utf8');

// Fix 1: cheater income boost test
const oldCheater = `test('AI: cheater gets income boost when idle', () => {
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
});`;

const newCheater = `test('AI: cheater gets income boost when idle', () => {
  const s = fresh();
  s.aiPlayerId = P2;
  s.aiDifficulty = 'cheater';
  s.aiType = 'balanced';
  // pre-build all targets so AI reaches idle state
  for (let i = 0; i < 5; i++) missileBuildBuilding(s, P2, { buildingType: 'economy', gx: i, gy: 0 });
  for (let i = 0; i < 3; i++) missileBuildBuilding(s, P2, { buildingType: 'shield', gx: i, gy: 1 });
  missileBuildBuilding(s, P2, { buildingType: 'healer', gx: 4, gy: 0 });
  for (let i = 0; i < 4; i++) missileBuildBuilding(s, P2, { buildingType: 'launcher', launcherType: i % 2 === 0 ? 'single' : 'scatter', gx: 5 + (i % 3), gy: Math.floor(i / 3) });
  advance(3100, s);
  // set levels to max so no upgrades possible
  for (const b of Object.values(s.buildings).filter(b => b.ownerId === P2 && b.type !== 'core')) {
    b.level = 5;
  }
  s.resources[P2] = 0;
  const before = s.resources[P2];
  s.aiLastDecisionMs = fakeNow - 5000;
  missileAiTick(s, fakeNow + 2000);
  assert.ok(s.resources[P2] >= before + 5, 'cheater AI gets income boost when idle');
});`;

if (!src.includes(oldCheater)) {
  console.error('cheater test not found');
  process.exit(1);
}
src = src.replace(oldCheater, newCheater);

// Fix 2: fires missiles test
const oldFire = `test('AI: fires missiles when stock available and 3 launchers built', () => {
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
});`;

const newFire = `test('AI: fires missiles when stock available and 3 launchers built', () => {
  const s = fresh();
  s.aiPlayerId = P2;
  s.aiDifficulty = 'hard';
  s.aiType = 'balanced';
  // pre-build enough buildings so AI reaches firing stage
  for (let i = 0; i < 4; i++) missileBuildBuilding(s, P2, { buildingType: 'economy', gx: i, gy: 0 });
  for (let i = 0; i < 2; i++) missileBuildBuilding(s, P2, { buildingType: 'shield', gx: i, gy: 1 });
  missileBuildBuilding(s, P2, { buildingType: 'healer', gx: 4, gy: 0 });
  for (let i = 0; i < 3; i++) missileBuildBuilding(s, P2, { buildingType: 'launcher', launcherType: i % 2 === 0 ? 'single' : 'scatter', gx: 5 + i, gy: 0 });
  advance(3100, s);
  const launchers = Object.values(s.buildings).filter(b => b.type === 'launcher' && b.ownerId === P2);
  assert.equal(launchers.length, 3, '3 launchers built');
  for (const L of launchers) { L.stock = 3; L.loadingUntil = 0; L.lastFiredAt = 0; }
  s.resources[P2] = 10000;
  // set levels to max so no upgrades possible
  for (const b of Object.values(s.buildings).filter(b => b.ownerId === P2 && b.type !== 'core')) { b.level = 5; }
  s.aiLastDecisionMs = fakeNow - 5000;
  const beforeMissiles = s.missiles.length;
  missileAiTick(s, fakeNow + 2000);
  assert.ok(s.missiles.length > beforeMissiles, 'AI fires when stock available');
});`;

if (!src.includes(oldFire)) {
  console.error('fire test not found');
  process.exit(1);
}
src = src.replace(oldFire, newFire);

// Fix 3: upgrades buildings test
const oldUpg = `test('AI: upgrades buildings when affordable', () => {
  const s = fresh(10000);
  s.aiPlayerId = P2;
  s.aiDifficulty = 'hard';
  s.aiType = 'balanced';
  missileBuildBuilding(s, P2, { buildingType: 'economy', gx: 0, gy: 0 });
  advance(3100, s);
  const E = Object.values(s.buildings).find(b => b.type === 'economy' && b.ownerId === P2);
  assert.ok(E, 'economy built');
  assert.equal(E.level, 1, 'starts at level 1');
  s.resources[P2] = 1000; // plenty of credits
  s.aiLastDecisionMs = fakeNow;
  missileAiTick(s, fakeNow + 2000);
  // should have queued an upgrade
  const pendingUp = Object.values(s.pending ?? {}).some(p => p.kind === 'upgrade' && p.upgradeOf === E.id);
  assert.ok(pendingUp, 'AI queues upgrade when affordable');
});`;

const newUpg = `test('AI: upgrades buildings when affordable', () => {
  const s = fresh(10000);
  s.aiPlayerId = P2;
  s.aiDifficulty = 'hard';
  s.aiType = 'balanced';
  missileBuildBuilding(s, P2, { buildingType: 'economy', gx: 0, gy: 0 });
  advance(3100, s);
  const E = Object.values(s.buildings).find(b => b.type === 'economy' && b.ownerId === P2);
  assert.ok(E, 'economy built');
  assert.equal(E.level, 1, 'starts at level 1');
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
});`;

if (!src.includes(oldUpg)) {
  console.error('upgrade test not found');
  process.exit(1);
}
src = src.replace(oldUpg, newUpg);

fs.writeFileSync(file, src);
console.log('done');
`;

fs.writeFileSync('C:/Users/MisterPear/Development/hidden-signal/server/fix_tests.cjs', script);
console.log('written');