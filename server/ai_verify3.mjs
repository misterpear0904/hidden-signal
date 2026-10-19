import {
  rooms, createRoom, selectGame, startGame,
  tickMissileRoom, updateMissileCommandOptions,
} from './gameManager.js';

for (const k of [...rooms.keys()]) rooms.delete(k);
const room = createRoom('host', 'HOST');
selectGame(room.code, 'missile-command');
updateMissileCommandOptions(room.code, { aiOpponent: true, fogOfWar: false, aiType: 'balanced' });
startGame(room.code);
const ai = 'AI-BOT';
let t = Date.now();
let ticks = 0;
while (ticks < 2000 && room.phase === 'missile-command-play') {
  t += 150; tickMissileRoom(room, t); ticks++;
  if (ticks % 400 === 0) {
    const st = room.missileCommandState;
    const aiB = Object.values(st.buildings).filter(b => b.ownerId === ai);
    console.log('tick', ticks, 'ai buildings:', aiB.length, 'launchers:', aiB.filter(b=>b.type==='launcher').length, 'eco:', aiB.filter(b=>b.type==='economy').length, 'shields:', aiB.filter(b=>b.type==='shield'||b.type==='shield_heavy').length, 'pending:', Object.values(st.pending).filter(p=>p.ownerId===ai).length, 'missiles:', st.missiles.length, 'launched:', st.stats[ai].missilesLaunched);
  }
}
console.log('final phase:', room.phase, 'winner:', room.missileCommandState?.winnerId);
console.log('scores:', room.players.map(p=>p.name+':'+p.score).join(', '));
