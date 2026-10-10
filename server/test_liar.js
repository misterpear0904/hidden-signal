// test_liar.js — locks Liar's Dice bidding + call-resolution rules.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rooms,
  startGame,
  submitLiarBid,
  resolveLiarCall,
  expireLiarBid,
} from './gameManager.js';

const A = 'liar-a';
const B = 'liar-b';

function fakeRoom() {
  const room = {
    code: 'LIARTEST',
    selectedGameId: 'liar-dice',
    players: [
      { id: A, name: 'A', score: 0, isHost: true, connected: true },
      { id: B, name: 'B', score: 0, isHost: false, connected: true },
    ],
    round: 1,
    liarOptions: { extremeMode: false },
    liarState: null,
    phase: 'lobby',
    timerEnd: null,
    endVote: null,
    lastActivityMs: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

test('each player gets sorted-able dice hands of the configured size', () => {
  const room = fakeRoom();
  try {
    startGame(room.code);
    assert.equal(room.phase, 'liar-bid');
    assert.equal(room.liarState.dice[A].length, 3);
    assert.equal(room.liarState.dice[B].length, 3);
    for (const hand of Object.values(room.liarState.dice)) {
      assert.ok(hand.every(d => d >= 1 && d <= 6), 'faces in 1..6');
    }
  } finally {
    rooms.delete(room.code);
  }
});

test('bids must rise in turn order', () => {
  const room = fakeRoom();
  try {
    startGame(room.code);
    const first = room.liarState.toActId;
    const second = first === A ? B : A;
    assert.ok(submitLiarBid(room.code, first, 2, 3), 'opening bid accepted');
    assert.equal(submitLiarBid(room.code, first, 3, 3), null, 'same player cannot bid twice');
    assert.equal(submitLiarBid(room.code, second, 2, 3), null, 'repeating the bid rejected');
    assert.equal(submitLiarBid(room.code, second, 2, 2), null, 'lower face at same qty rejected');
    assert.ok(submitLiarBid(room.code, second, 2, 4), 'higher face accepted');
    assert.ok(submitLiarBid(room.code, first, 3, 4), 'higher qty accepted');
  } finally {
    rooms.delete(room.code);
  }
});

test('LIAR call: false bid wins for the caller, true bid for the bidder', () => {
  const room = fakeRoom();
  try {
    startGame(room.code);
    // hands: two 3s total
    room.liarState.dice = { [A]: [3, 3, 4], [B]: [1, 2, 5] };
    room.liarState.toActId = A;
    room.liarState.bids = [];
    submitLiarBid(room.code, A, 3, 3); // claims three 3s — FALSE (only two)
    const res = resolveLiarCall(room.code, B, 'liar');
    assert.ok(res, 'call resolves');
    assert.equal(res.liarState.winnerId, B, 'caller wins on false bid');
    assert.equal(res.liarState.actualCount, 2);
    assert.equal(res.phase, 'liar-reveal');
  } finally {
    rooms.delete(room.code);
  }

  const room2 = fakeRoom();
  try {
    startGame(room2.code);
    room2.liarState.dice = { [A]: [3, 3, 4], [B]: [1, 2, 5] };
    room2.liarState.toActId = A;
    room2.liarState.bids = [];
    submitLiarBid(room2.code, A, 2, 3); // claims two 3s — TRUE
    const res = resolveLiarCall(room2.code, B, 'liar');
    assert.equal(res.liarState.winnerId, A, 'bidder wins on true bid');
  } finally {
    rooms.delete(room2.code);
  }
});

test('EXACT call pays bonus only on exact count', () => {
  const room = fakeRoom();
  try {
    startGame(room.code);
    room.liarState.dice = { [A]: [3, 3, 4], [B]: [1, 2, 5] };
    room.liarState.toActId = A;
    room.liarState.bids = [];
    submitLiarBid(room.code, A, 2, 3);
    const res = resolveLiarCall(room.code, B, 'exact');
    assert.equal(res.liarState.winnerId, B);
    assert.equal(res.liarState.points[B], 2, 'exact steal pays +2');
  } finally {
    rooms.delete(room.code);
  }

  const room2 = fakeRoom();
  try {
    startGame(room2.code);
    room2.liarState.dice = { [A]: [3, 3, 4], [B]: [1, 2, 5] };
    room2.liarState.toActId = A;
    room2.liarState.bids = [];
    submitLiarBid(room2.code, A, 3, 3);
    const res = resolveLiarCall(room2.code, B, 'exact');
    assert.equal(res.liarState.winnerId, A, 'wrong exact hands the round to the bidder');
    assert.equal(res.liarState.points[A], 1);
  } finally {
    rooms.delete(room2.code);
  }
});

test('bid timeout awards the round to the opponent', () => {
  const room = fakeRoom();
  try {
    startGame(room.code);
    const toAct = room.liarState.toActId;
    const other = toAct === A ? B : A;
    const res = expireLiarBid(room.code);
    assert.equal(res.liarState.winnerId, other);
    assert.equal(res.liarState.reason, 'timeout');
  } finally {
    rooms.delete(room.code);
  }
});
