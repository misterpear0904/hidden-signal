// test_mobile_touch.js — tests for mobile touch handling in Missile Command.
// Run with: npm test (node --test test_*.js)

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mock the gesture handling logic
function createGestureState() {
  return {
    pointers: new Map(),
    pinchDist: 0,
    pinchZoom: 1,
  };
}

const TAP_TOL = 40;
const TAP_MAX_MS = 800;

function onPointerDown(gesture, pointerId, clientX, clientY, pointerType) {
  const g = gesture;
  g.pointers.set(pointerId, {
    x: clientX, y: clientY,
    downX: clientX, downY: clientY,
    downT: Date.now(), moved: false,
    tol: pointerType === 'touch' ? 40 : 10,
  });
  if (g.pointers.size === 2) {
    const [a, b] = [...g.pointers.values()];
    g.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    g.pinchZoom = 1;
  }
}

function onPointerMove(gesture, pointerId, clientX, clientY) {
  const p = gesture.pointers.get(pointerId);
  if (!p) return;
  const prevX = p.x, prevY = p.y;
  p.x = clientX; p.y = clientY;
  if (Math.hypot(p.x - p.downX, p.y - p.downY) > p.tol) p.moved = true;
}

function onPointerUp(gesture, pointerId, clientX, clientY) {
  const g = { ...gesture };
  const me = g.pointers.get(pointerId);
  if (!me) return false;
  g.pointers.delete(pointerId);
  if (me && !me.moved && Date.now() - me.downT < 800) {
    // Tap only if every REMAINING finger is also still
    const othersStill = [...g.pointers.values()].every(p => !p.moved);
    if (othersStill || g.pointers.size === 0) {
      return true; // tap detected
    }
  }
  return false;
}

function createTouchPointer(pointerId, x, y) {
  return { pointerId, x, y, pointerType: 'touch' };
}

function createMousePointer(pointerId, x, y) {
  return { pointerId, x, y, pointerType: 'mouse' };
}

test('single touch tap registers within tolerance', () => {
  const g = createGestureState();
  const now = Date.now();
  
  onPointerDown(g, 1, 100, 100, 'touch');
  // Simulate time passing
  const ptr = g.pointers.get(1);
  ptr.downT = Date.now() - 100; // 100ms ago
  
  const result = onPointerUp(g, 1, 100, 100);
  assert.equal(result, true, 'Should register tap within tolerance and time');
});

test('touch movement beyond tolerance cancels tap', () => {
  const g = createGestureState();
  
  onPointerDown(g, 1, 100, 100, 'touch');
  onPointerMove(g, 1, 150, 100); // Move 50px - beyond 40px tolerance
  
  const result = onPointerUp(g, 1, 150, 100);
  assert.equal(result, false, 'Should not register tap when moved beyond tolerance');
});

test('touch within tolerance registers tap', () => {
  const g = createGestureState();
  
  onPointerDown(g, 1, 100, 100, 'touch');
  onPointerMove(g, 1, 110, 105); // Move 11px - within 40px tolerance
  
  const result = onPointerUp(g, 1, 110, 105);
  assert.equal(result, true, 'Should register tap within tolerance');
});

test('tap too slow cancels tap', () => {
  const g = createGestureState();
  
  onPointerDown(g, 1, 100, 100, 'touch');
  const ptr = g.pointers.get(1);
  ptr.downT = Date.now() - 1000; // 1000ms ago - beyond 800ms limit
  
  const result = onPointerUp(g, 1, 100, 100);
  assert.equal(result, false, 'Should not register tap when too slow');
});

test('resting thumb does not cancel tap from another finger', () => {
  const g = createGestureState();
  
  // Finger 1: thumb moves beyond tolerance (50px > 40px)
  onPointerDown(g, 1, 50, 500, 'touch');
  onPointerMove(g, 1, 100, 500); // Move 50px - beyond 40px tolerance
  // thumb moved = true
  
  // Finger 2: quick tap
  onPointerDown(g, 2, 200, 200, 'touch');
  
  const result = onPointerUp(g, 2, 200, 200);
  assert.equal(result, false, 'Should not register tap when other finger moved');
  
  // Reset for next test
  const g2 = createGestureState();
  
  // Finger 1: thumb stays perfectly still
  onPointerDown(g2, 1, 50, 500, 'touch');
  // thumb doesn't move at all
  
  // Finger 2: quick tap
  onPointerDown(g2, 2, 200, 200, 'touch');
  
  const result2 = onPointerUp(g2, 2, 200, 200);
  assert.equal(result2, true, 'Should register tap when other finger stayed still');
});

test('two-finger pinch does not register as tap', () => {
  const g = createGestureState();
  
  onPointerDown(g, 1, 100, 100, 'touch');
  onPointerDown(g, 2, 200, 200, 'touch');
  onPointerMove(g, 1, 150, 110); // pinch gesture - move > 40px
  onPointerMove(g, 2, 150, 150); // pinch gesture - move > 40px
  
  const result = onPointerUp(g, 1, 150, 110);
  assert.equal(result, false, 'Pinch gesture should not register as tap');
});

test('mouse click has smaller tolerance', () => {
  const g = createGestureState();
  
  onPointerDown(g, 1, 100, 100, 'mouse');
  onPointerMove(g, 1, 108, 100); // Move 8px - within mouse tolerance (10px)
  
  const result = onPointerUp(g, 1, 108, 100);
  assert.equal(result, true, 'Mouse click within 10px tolerance should register');
  
  const g2 = createGestureState();
  onPointerDown(g2, 1, 100, 100, 'mouse');
  onPointerMove(g2, 1, 112, 100); // Move 12px - beyond mouse tolerance (10px)
  
  const result2 = onPointerUp(g2, 1, 112, 100);
  assert.equal(result2, false, 'Mouse click beyond 10px tolerance should not register');
});