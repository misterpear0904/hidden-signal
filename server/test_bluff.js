// test_bluff.js — locks Bluff Card showdown + bidding-cap rules.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rooms,
  startBluffRound,
  submitBluffAction,
  resolveBluffShowdown,
} from './gameManager.js';

const A = 'bluff-a';
const B = 'bluff-b';

function fakeRoom() {
  const room = {
    code: 'BLUFFTEST',
    players: [
      { id: A, name: 'A', score: 0, isHost: true, connected: true },
      { id: B, name: 'B', score: 0, isHost: false, connected: true },
    ],
    round: 1,
    bluffState: null,
    phase: 'bluff-bet',
    timerEnd: null,
    lastActivityMs: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

function showdown(aCard, bCard) {
  const room = fakeRoom();
  try {
    startBluffRound(room);
    room.bluffState.cards = { [A]: aCard, [B]: bCard };
    resolveBluffShowdown(room);
    return room.bluffState.winnerId;
  } finally {
    rooms.delete(room.code);
  }
}

test('Joker beats ONLY Kings', () => {
  assert.equal(showdown('Joker', 'K'), A, 'Joker beats King');
  assert.equal(showdown('K', 'Joker'), B, 'King loses to Joker');
  assert.equal(showdown('Joker', 'Q'), B, 'Joker loses to Queen');
  assert.equal(showdown('Q', 'Joker'), A, 'Queen beats Joker');
  assert.equal(showdown('Joker', 'J'), B, 'Joker loses to Jack');
  assert.equal(showdown('J', 'Joker'), A, 'Jack beats Joker');
});

test('plain ranks resolve high-card-wins', () => {
  assert.equal(showdown('K', 'Q'), A);
  assert.equal(showdown('Q', 'K'), B);
  assert.equal(showdown('Q', 'J'), A);
  assert.equal(showdown('J', 'Q'), B);
  assert.equal(showdown('K', 'J'), A);
});

test('bidding goes back and forth with raises', () => {
  const room = fakeRoom();
  try {
    startBluffRound(room);
    // force A to act first regardless of round rotation
    room.bluffState.toActId = A;
    room.bluffState.firstId = A;
    assert.ok(submitBluffAction(room.code, A, 'bet'), 'A bets');
    assert.equal(room.bluffState.toActId, B);
    assert.ok(submitBluffAction(room.code, B, 'raise'), 'B raises on top');
    assert.equal(room.bluffState.toActId, A, 'back to A');
    assert.equal(room.bluffState.betCount, 2);
    assert.ok(submitBluffAction(room.code, A, 'raise'), 'A re-raises');
    assert.equal(room.bluffState.toActId, B);
    assert.equal(room.bluffState.betCount, 3);
  } finally {
    rooms.delete(room.code);
  }
});

test('10-raise cap forces a call (raise and fold rejected)', () => {
  const room = fakeRoom();
  try {
    startBluffRound(room);
    room.bluffState.toActId = A;
    room.bluffState.firstId = A;
    submitBluffAction(room.code, A, 'bet');
    // alternate raises to reach the cap: bet(1) + 9 raises = 10
    let toAct = B;
    for (let i = 0; i < 9; i++) {
      const res = submitBluffAction(room.code, toAct, 'raise');
      assert.ok(res, `raise ${i + 2} accepted`);
      toAct = toAct === A ? B : A;
    }
    assert.equal(room.bluffState.betCount, 10);
    assert.equal(room.bluffState.toActId, toAct);
    assert.equal(submitBluffAction(room.code, toAct, 'raise'), null, 'raise rejected at cap');
    assert.equal(submitBluffAction(room.code, toAct, 'fold'), null, 'fold rejected at cap');
    const done = submitBluffAction(room.code, toAct, 'call');
    assert.ok(done, 'call accepted at cap');
    assert.equal(room.phase, 'bluff-reveal', 'showdown resolves');
    assert.ok(done.bluffState.winnerId, 'a winner is declared');
  } finally {
    rooms.delete(room.code);
  }
});

test('fold and check-call basics still work', () => {
  const room = fakeRoom();
  try {
    startBluffRound(room);
    room.bluffState.toActId = A;
    room.bluffState.firstId = A;
    submitBluffAction(room.code, A, 'check');
    submitBluffAction(room.code, B, 'check');
    assert.equal(room.phase, 'bluff-reveal', 'check-check shows down');
  } finally {
    rooms.delete(room.code);
  }
  const room2 = fakeRoom();
  try {
    startBluffRound(room2);
    room2.bluffState.toActId = A;
    room2.bluffState.firstId = A;
    submitBluffAction(room2.code, A, 'bet');
    submitBluffAction(room2.code, B, 'fold');
    assert.equal(room2.phase, 'bluff-reveal');
    assert.equal(room2.bluffState.reason, 'fold');
  } finally {
    rooms.delete(room2.code);
  }
});
