// Unit tests for the pure fog-of-war vision helpers.
// These pin the exact rules every render path must follow:
// aura gating, healer beams, building visibility, pending sites, selection.
import { describe, it, expect } from 'vitest';
import {
  visionOfTile,
  canSeeEnemyAtTile,
  enemyBuildingVisibility,
  showEnemyPending,
} from './fog';

const NOW = 1_000_000;
const live = (tiles: Record<string, number> = {}) => ({
  fogOfWar: true,
  fogHistory: true,
  now: NOW,
  tiles,
});

describe('visionOfTile', () => {
  it('reports live for everything when fog is off', () => {
    const opts = { fogOfWar: false, fogHistory: false, now: NOW };
    expect(visionOfTile(undefined, opts, 0, 0)).toBe('live');
    expect(visionOfTile({}, opts, 6, 3)).toBe('live');
  });

  it('reports hidden for never-seen tiles', () => {
    expect(visionOfTile({}, live(), 3, 3)).toBe('hidden');
    expect(visionOfTile(undefined, live(), 3, 3)).toBe('hidden');
  });

  it('reports live for permanent (0) and unexpired reveals', () => {
    const o = live({ '6,3': 0, '1,1': NOW + 4999 });
    expect(visionOfTile(o.tiles, o, 6, 3)).toBe('live');
    expect(visionOfTile(o.tiles, o, 1, 1)).toBe('live');
  });

  it('reports stale for remembered (-1) tiles when history is on', () => {
    const o = live({ '2,2': -1 });
    expect(visionOfTile(o.tiles, o, 2, 2)).toBe('stale');
  });

  it('reports hidden for remembered (-1) tiles when history is off', () => {
    const o = { fogOfWar: true, fogHistory: false, now: NOW, tiles: { '2,2': -1 } };
    expect(visionOfTile(o.tiles, o, 2, 2)).toBe('hidden');
  });

  it('reports stale for lapsed reveals when history is on, hidden when off', () => {
    const tiles = { '4,4': NOW - 1 };
    expect(visionOfTile(tiles, live(), 4, 4)).toBe('stale');
    expect(visionOfTile(tiles, { fogOfWar: true, fogHistory: false, now: NOW }, 4, 4)).toBe('hidden');
  });
});

describe('canSeeEnemyAtTile', () => {
  it('is true only for live tiles', () => {
    const o = live({ '6,3': 0, '1,1': NOW + 1000, '2,2': -1 });
    expect(canSeeEnemyAtTile(o.tiles, o, 6, 3)).toBe(true);
    expect(canSeeEnemyAtTile(o.tiles, o, 1, 1)).toBe(true);
    expect(canSeeEnemyAtTile(o.tiles, o, 2, 2)).toBe(false);
    expect(canSeeEnemyAtTile(o.tiles, o, 9, 9)).toBe(false);
  });
});

describe('enemyBuildingVisibility', () => {
  it('always shows own buildings and cores', () => {
    expect(enemyBuildingVisibility(true, false, 'hidden')).toBe('live');
    expect(enemyBuildingVisibility(false, true, 'hidden')).toBe('live');
  });

  it('passes enemy vision through unchanged', () => {
    expect(enemyBuildingVisibility(false, false, 'live')).toBe('live');
    expect(enemyBuildingVisibility(false, false, 'stale')).toBe('stale');
    expect(enemyBuildingVisibility(false, false, 'hidden')).toBe('hidden');
  });
});

describe('showEnemyPending', () => {
  it('shows construction activity only with live vision', () => {
    expect(showEnemyPending('live')).toBe(true);
    // Stale sites would double-show once completed into buildings.
    expect(showEnemyPending('stale')).toBe(false);
    expect(showEnemyPending('hidden')).toBe(false);
  });
});
