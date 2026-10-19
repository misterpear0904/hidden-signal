const realNow = Date.now;
let fakeNow = 1_700_000_000_000;
Date.now = () => fakeNow;

const { MISSILE_CONFIG, createMissileCommandState, missileBuildBuilding, missileAiTick, missileSideForPlayer } = await import('./missileCommand.js');

const P1 = 'p1-top';
const P2 = 'p2-bottom';
const s = createMissileCommandState([P1, P2], { startingResources: 5000 });
s.aiPlayerId = P2;
s.aiDifficulty = 'hard';
s.aiType = 'aggressive';
s.aiLastDecisionMs = fakeNow - 5000;

for (let i = 0; i < 5; i++) {
  console.log('tick', i, 'before: eco=' + Object.values(s.buildings).filter(b => b.ownerId === P2 && b.type === 'economy').length + ' pending_eco=' + Object.values(s.pending || {}).filter(p => p.ownerId === P2 && p.type === 'economy').length);
  missileAiTick(s, fakeNow + (i + 1) * 2000);
  console.log('  after: pending=' + Object.keys(s.pending || {}).length + ' buildings=' + Object.keys(s.buildings).length);
  fakeNow += 3500;
  // complete builds
  for (const p of Object.values(s.pending || {})) { if (p.completeAt > fakeNow) p.completeAt = fakeNow - 1; }
  const { tickMissileCommand } = await import('./missileCommand.js');
  tickMissileCommand(s, fakeNow);
}

console.log('final eco:', Object.values(s.buildings).filter(b => b.ownerId === P2 && b.type === 'economy').length);
console.log('final launchers:', Object.values(s.buildings).filter(b => b.ownerId === P2 && b.type === 'launcher').length);

Date.now = realNow;