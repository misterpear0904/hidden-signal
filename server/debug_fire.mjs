const realNow = Date.now;
let fakeNow = 1_700_000_000_000;
Date.now = () => fakeNow;

const { MISSILE_CONFIG, createMissileCommandState, missileBuildBuilding, missileAiTick, missileSideForPlayer, tickMissileCommand } = await import('./missileCommand.js');

const P1 = 'p1-top';
const P2 = 'p2-bottom';
const s = createMissileCommandState([P1, P2], { startingResources: 5000 });
s.aiPlayerId = P2;
s.aiDifficulty = 'hard';
s.aiType = 'balanced';

for (let i = 0; i < 4; i++) missileBuildBuilding(s, P2, { buildingType: 'economy', gx: i, gy: 0 });
for (let i = 0; i < 2; i++) missileBuildBuilding(s, P2, { buildingType: 'shield', gx: i, gy: 1 });
missileBuildBuilding(s, P2, { buildingType: 'healer', gx: 4, gy: 0 });
for (let i = 0; i < 3; i++) missileBuildBuilding(s, P2, { buildingType: 'launcher', launcherType: i % 2 === 0 ? 'single' : 'scatter', gx: 5 + i, gy: 0 });

fakeNow += 3100;
for (const p of Object.values(s.pending || {})) { p.completeAt = fakeNow - 1; }
tickMissileCommand(s, fakeNow);

const launchers = Object.values(s.buildings).filter(b => b.type === 'launcher' && b.ownerId === P2);
console.log('launchers:', launchers.length);
for (const L of launchers) { L.stock = 3; L.loadingUntil = 0; L.lastFiredAt = 0; }
s.resources[P2] = 10000;
for (const b of Object.values(s.buildings).filter(b => b.ownerId === P2 && b.type !== 'core')) { b.level = 5; }
s.aiLastDecisionMs = fakeNow - 5000;

const beforeMissiles = s.missiles.length;
missileAiTick(s, fakeNow + 2000);
console.log('missiles before:', beforeMissiles, 'after:', s.missiles.length);
console.log('aiLastDecisionMs:', s.aiLastDecisionMs);

for (const L of launchers) {
  console.log('launcher', L.id, 'stock:', L.stock, 'lastFiredAt:', L.lastFiredAt);
}

Date.now = realNow;