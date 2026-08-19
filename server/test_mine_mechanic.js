import assert from 'node:assert';
import {
  createRoom,
  joinRoom,
  selectGame,
  startGame,
  updateTerritoryOptions,
  placeTerritoryMine,
  submitTerritoryPick,
  triggerTerritoryMineDetonations,
  resolveTerritoryTurn,
} from './gameManager.js';

console.log('--- Starting Territory Push Mine Mechanics Test Suite ---');

// Test 1: Mine Placement Validation
{
  const room = createRoom('sock_p1', 'Player1');
  const code = room.code;
  joinRoom(code, 'sock_p2', 'Player2');
  selectGame(code, 'territory-push');
  updateTerritoryOptions(code, { extremeMode: true });
  startGame(code);

  const pRed = room.territoryState.teams.red[0];
  const pBlue = room.territoryState.teams.blue[0];

  // Red player places mine in red territory (row 3, col 2)
  const placeResult1 = placeTerritoryMine(code, pRed, 3, 2);
  assert.strictEqual(placeResult1.error, undefined, 'Red player should successfully place mine in red territory');
  assert.strictEqual(placeResult1.room.territoryState.mines[pRed].row, 3);
  assert.strictEqual(placeResult1.room.territoryState.mines[pRed].col, 2);
  assert.strictEqual(placeResult1.room.territoryState.mines[pRed].team, 'red');

  // Red player attempts to place in blue territory (row 15, col 2) - should fail
  const placeResultInvalid = placeTerritoryMine(code, pRed, 15, 2);
  assert.ok(placeResultInvalid.error, 'Should reject placing mine outside friendly territory');

  // Red player moves mine to another valid red tile (row 7, col 4)
  const moveResult = placeTerritoryMine(code, pRed, 7, 4);
  assert.strictEqual(moveResult.error, undefined, 'Should successfully move mine');
  assert.strictEqual(moveResult.room.territoryState.mines[pRed].row, 7);
  assert.strictEqual(moveResult.room.territoryState.mines[pRed].col, 4);

  // Blue player places mine in blue territory (row 12, col 4)
  const p2Place = placeTerritoryMine(code, pBlue, 12, 4);
  assert.strictEqual(p2Place.error, undefined, 'Blue player should successfully place mine in blue territory');

  console.log('✓ Test 1: Mine Placement & Validation Passed');
}

// Test 2: Extreme Mode Detonation Trigger (2-tile radius claim & refund)
{
  const room = createRoom('sock_p1', 'Player1');
  const code = room.code;
  joinRoom(code, 'sock_p2', 'Player2');
  selectGame(code, 'territory-push');
  updateTerritoryOptions(code, { extremeMode: true });
  startGame(code);

  const pRed = room.territoryState.teams.red[0];
  const pBlue = room.territoryState.teams.blue[0];

  // Initial frontiers at row 9 for all cols (height 20)
  // Blue places mine at col 5, row 10 (just 1 step inside Blue territory)
  placeTerritoryMine(code, pBlue, 10, 5);
  assert.ok(room.territoryState.mines[pBlue], 'Blue mine placed at col 5 row 10');

  // Red attacks col 5 (advancing frontier from 9 to 10)
  // Red has 1 shot ready
  const pickRes = submitTerritoryPick(code, pRed, 5);
  assert.ok(pickRes, 'Pick submitted');

  // Red attempted to capture row 10 at col 5, which contained Blue's mine!
  // Blue's trap should have detonated and converted 2-tile radius (cols 3..7, rows 8..12) to Blue!
  // For cols 3..7, the new red frontier should be pulled back to row 7 (since Blue captured down to row 8).
  for (let c = 3; c <= 7; c++) {
    assert.strictEqual(room.territoryState.board[c], 7, `Col ${c} red frontier should be pushed back to row 7 by Blue mine explosion`);
  }

  // Mine should be consumed and removed from board
  assert.strictEqual(room.territoryState.mines[pBlue], undefined, 'Blue mine should be removed from board after detonation');
  assert.ok(room.territoryState.recentExplosions.length > 0, 'Explosion should be logged');
  assert.strictEqual(room.territoryState.recentExplosions[0].team, 'blue', 'Detonation was Blue trap');

  // Blue player should now be able to place another mine immediately!
  const rearmResult = placeTerritoryMine(code, pBlue, 14, 5);
  assert.strictEqual(rearmResult.error, undefined, 'Blue player can rearm mine after detonation');
  assert.strictEqual(room.territoryState.mines[pBlue].row, 14);

  console.log('✓ Test 2: Extreme Mode Detonation & Re-arming Passed');
}

// Test 3: Standard Turn-Based Detonation Trigger
{
  const room = createRoom('sock_p1', 'Player1');
  const code = room.code;
  joinRoom(code, 'sock_p2', 'Player2');
  selectGame(code, 'territory-push');
  updateTerritoryOptions(code, { extremeMode: false });
  startGame(code);

  const pRed = room.territoryState.teams.red[0];
  const pBlue = room.territoryState.teams.blue[0];

  // Red places mine at row 4, col 4 (on Red's active frontier)
  placeTerritoryMine(code, pRed, 4, 4);

  // Both submit turn: Blue pushes col 4 (moving frontier from 4 to 3, capturing Red's row 4 with mine)
  submitTerritoryPick(code, pRed, 1); // Red pushes col 1
  submitTerritoryPick(code, pBlue, 4); // Blue pushes col 4 (attacks Red mine at row 4)

  // Turn resolves automatically and advances to Turn 2
  assert.strictEqual(room.phase, 'territory-turn');
  assert.strictEqual(room.territoryState.turn, 2);

  // Red mine at (row 4, col 4) detonated! 2-tile radius (cols 2..6, rows 2..6) claimed for Red!
  // In cols 2..6, Red owns rows up to row 6!
  for (let c = 2; c <= 6; c++) {
    assert.strictEqual(room.territoryState.board[c], 6, `Col ${c} red frontier should be pushed forward to row 6 by Red mine explosion`);
  }

  // Red mine consumed and logged
  assert.strictEqual(room.territoryState.mines[pRed], undefined, 'Red mine consumed');
  assert.ok(room.territoryState.recentExplosions.length > 0, 'Explosion recorded');
  console.log('✓ Test 3: Standard Turn-Based Mode Detonation Passed');
}

// Test 4: Recharge Booster Placement & Distribution Verification
{
  for (let i = 0; i < 20; i++) {
    const room = createRoom('sock_p1', 'Player1');
    const code = room.code;
    joinRoom(code, 'sock_p2', 'Player2');
    selectGame(code, 'territory-push');
    updateTerritoryOptions(code, { extremeMode: true });
    startGame(code);

    const bonusSquares = room.territoryState.bonusSquares;
    assert.strictEqual(bonusSquares.length, 8, 'Must generate exactly 8 booster squares');

    const redSquares = bonusSquares.filter(s => s.initialTeam === 'red');
    const blueSquares = bonusSquares.filter(s => s.initialTeam === 'blue');
    assert.strictEqual(redSquares.length, 4, 'Must have 4 red boosters');
    assert.strictEqual(blueSquares.length, 4, 'Must have 4 blue boosters');

    // Verify all 8 columns are unique
    const allCols = new Set(bonusSquares.map(s => s.col));
    assert.strictEqual(allCols.size, 8, 'All 8 bonus squares must occupy distinct columns');

    // Verify rows 6-8 for red, 11-13 for blue
    for (const sq of redSquares) {
      assert.ok(sq.row >= 6 && sq.row <= 8, `Red booster row ${sq.row} must be between 6 and 8`);
    }
    for (const sq of blueSquares) {
      assert.ok(sq.row >= 11 && sq.row <= 13, `Blue booster row ${sq.row} must be between 11 and 13`);
    }
  }
  console.log('✓ Test 4: Recharge Booster Generation (Unique Cols & Row Constraints) Passed');
}

// Test 5: Chain Reactions (Mine detonating into another opposing mine)
{
  const room = createRoom('sock_p1', 'Player1');
  const code = room.code;
  joinRoom(code, 'sock_p2', 'Player2');
  selectGame(code, 'territory-push');
  updateTerritoryOptions(code, { extremeMode: true });
  startGame(code);

  const pRed = room.territoryState.teams.red[0];
  const pBlue = room.territoryState.teams.blue[0];

  // Red places mine at (row 9, col 5)
  placeTerritoryMine(code, pRed, 9, 5);
  // Blue places mine at (row 10, col 4)
  placeTerritoryMine(code, pBlue, 10, 4);

  // Red attacks col 4 (hits Blue's mine at row 10, col 4)
  submitTerritoryPick(code, pRed, 4);

  // Blue's mine detonated converting 2-tile radius (cols 2..6, rows 8..12) to Blue
  // Red's mine at (row 9, col 5) is within cols 2..6, rows 8..12!
  // It gets swallowed by Blue's territory expansion, triggering a CHAIN REACTION!
  // Red's mine detonates in response and reclaims 2-tile radius (cols 3..7, rows 7..11) for Red!
  assert.strictEqual(room.territoryState.mines[pBlue], undefined, 'Blue mine consumed');
  assert.strictEqual(room.territoryState.mines[pRed], undefined, 'Red mine consumed in chain reaction');
  assert.strictEqual(room.territoryState.recentExplosions.length, 2, 'Two explosions occurred from chain reaction');

  console.log('✓ Test 5: Chain Reaction Detonations Passed');
}

console.log('🎉 All Territory Push Mine Unit Tests Passed Successfully!');
