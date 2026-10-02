import assert from 'node:assert';
import { 
  createRoom, joinRoom, selectGame, startGame, 
  submitBlendClue, blendAllCluesIn, advanceToBlendVote,
  submitBlendVote, blendAllVotesIn, resolveBlendVotes,
  submitBlendGuess, nextBlendRound, getRoom
} from './gameManager.js';

function mk3() {
  const r = createRoom('h', 'Host');
  const code = r.code;
  joinRoom(code, 'o', 'Opp');
  joinRoom(code, 'x', 'X');
  return { code, ids: getRoom(code).players.map(p => p.id) };
}

function mk4() {
  const r = createRoom('h4', 'H');
  const code = r.code;
  joinRoom(code, 'x', 'X');
  joinRoom(code, 'y', 'Y');
  joinRoom(code, 'z', 'Z');
  return { code, ids: getRoom(code).players.map(p => p.id) };
}

console.log('Running Blend In tests...');

// Basic setup
let t = mk3();
assert.ok(selectGame(t.code, 'blend-in'), 'selectable');
assert.equal(startGame(t.code).phase, 'blend-word', 'starts word phase');
let st = getRoom(t.code);
const ids = t.ids;
assert.ok(st.blendState.category && st.blendState.secretWord && st.blendState.chameleonId, 'secret dealt');
assert.equal(startGame(mk3().code), null, 'needs 3 players');
for (const id of ids) assert.ok(submitBlendClue(t.code, id, 'clue'), 'clue accepted');
assert.ok(blendAllCluesIn(getRoom(t.code)), 'all clues in');
assert.ok(!submitBlendClue(t.code, ids[0], 'again'), 'no double clue');
advanceToBlendVote(t.code);
assert.equal(getRoom(t.code).phase, 'blend-vote');
const cham = st.blendState.chameleonId;
assert.ok(!submitBlendVote(t.code, ids[0], ids[0]), 'self vote rejected');
for (const id of ids) {
  const target = id === cham ? ids.find(i => i !== cham) : cham;
  assert.ok(submitBlendVote(t.code, id, target), 'vote accepted for ' + id);
}
assert.ok(blendAllVotesIn(getRoom(t.code)), 'all votes in');
resolveBlendVotes(t.code);
st = getRoom(t.code);
assert.equal(st.phase, 'blend-guess', 'caught -> guess phase');
assert.ok(st.blendState.caught, 'caught flag');
for (const id of ids.filter(i => i !== cham)) assert.equal(st.players.find(p=>p.id===id).score, 1, 'voter +1');
const word = st.blendState.secretWord;
assert.ok(!submitBlendGuess(t.code, ids.find(i => i !== cham), word), 'only chameleon guesses');
assert.ok(submitBlendGuess(t.code, cham, '  ' + word.toUpperCase() + '  '), 'steal guess accepted');
st = getRoom(t.code);
assert.equal(st.phase, 'blend-reveal', 'reveal after guess');
assert.ok(st.blendState.stealSuccess, 'steal detected');
assert.equal(st.players.find(p=>p.id===cham).score, 2, 'steal +2');
assert.ok(!submitBlendGuess(t.code, cham, word), 'no guess after reveal');

// Escape path
t = mk3();
selectGame(t.code, 'blend-in');
startGame(t.code);
for (const id of t.ids) submitBlendClue(t.code, id, 'w');
advanceToBlendVote(t.code);
const cham2 = getRoom(t.code).blendState.chameleonId;
const innocent = t.ids.find(i => i !== cham2);
for (const id of t.ids) {
  if (id === innocent) { submitBlendVote(t.code, id, t.ids.find(i => i !== innocent && i !== cham2) || cham2); }
  else submitBlendVote(t.code, id, innocent);
}
resolveBlendVotes(t.code);
st = getRoom(t.code);
assert.equal(st.phase, 'blend-reveal', 'escape -> straight to reveal');
assert.ok(!st.blendState.caught, 'not caught');
assert.equal(st.players.find(p=>p.id===cham2).score, 2, 'escape +2');
assert.ok(st.players.filter(p=>p.id!==cham2).every(p=>p.score===0), 'voters score nothing on escape');

// Tie -> escape (4 players: 2-2 tie)
const r4 = createRoom('h4', 'H');
const c4 = r4.code;
joinRoom(c4, 'x', 'X');
joinRoom(c4, 'y', 'Y');
joinRoom(c4, 'z', 'Z');
selectGame(c4, 'blend-in');
startGame(c4);
for (const id of ['h4','x','y','z']) submitBlendClue(c4, id, 'w');
advanceToBlendVote(c4);
const ids4 = getRoom(c4).players.map(p => p.id);
submitBlendVote(c4, ids4[0], ids4[1]);
submitBlendVote(c4, ids4[1], ids4[0]);
submitBlendVote(c4, ids4[2], ids4[3]);
submitBlendVote(c4, ids4[3], ids4[2]);
resolveBlendVotes(c4);
assert.equal(getRoom(c4).phase, 'blend-reveal', 'tie -> reveal');
assert.ok(!getRoom(c4).blendState.caught, 'tie escapes');

// 5-round full game to end
t = mk3();
selectGame(t.code, 'blend-in');
startGame(t.code);
for (let r = 1; r <= 5; r++) {
  for (const id of t.ids) submitBlendClue(t.code, id, 'w');
  advanceToBlendVote(t.code);
  for (const id of t.ids) submitBlendVote(t.code, id, t.ids[(t.ids.indexOf(id)+1)%t.ids.length]);
  resolveBlendVotes(t.code);
  let s = getRoom(t.code);
  if (s.phase === 'blend-guess') { const c = s.blendState.chameleonId; submitBlendGuess(t.code, c, 'wrong'); }
  if (r < 5) { const nx = nextBlendRound(t.code); assert.equal(nx.round, r + 1, 'round advances'); }
}
assert.equal(nextBlendRound(t.code).phase, 'end', 'ends after 5 rounds');

console.log('BLEND TESTS PASSED');