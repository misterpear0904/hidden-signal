import { describe, it, expect } from 'vitest';
import { emptyStats, statsOf, totalIncome, formatDuration, matchDurationSec } from './MissileCommandStats';
import type { MissileCommandState } from '../../types/game';

function mcWithStats(): MissileCommandState {
  return {
    sides: { top: 'p1', bottom: 'p2' },
    gridCols: 13,
    gridRows: 7,
    shieldTiles: 3,
    healerTiles: 2,
    buildings: {},
    pending: {},
    missiles: [],
    resources: { p1: 0, p2: 0 },
    gameStartTime: 1000,
    gameEndTime: 61000,
    lastEconomyTick: 1000,
    winnerId: 'p1',
    winReason: 'core_destroyed',
    fogOfWar: false,
    fogHistory: false,
    stats: {
      p1: { ...emptyStats(), damageDealt: 500, incomeEconomy: 100, incomeCore: 50, incomeSupply: 25 },
      p2: { ...emptyStats(), damageDealt: 300 },
    },
  };
}

describe('missile post-game stats helpers', () => {
  it('falls back to zeros for unknown players', () => {
    const mc = mcWithStats();
    expect(statsOf(mc, 'nobody').damageDealt).toBe(0);
    expect(statsOf(null, 'p1').missilesLaunched).toBe(0);
  });

  it('sums income across economy + core + supply', () => {
    const mc = mcWithStats();
    expect(totalIncome(statsOf(mc, 'p1'))).toBe(175);
  });

  it('formats match duration', () => {
    const mc = mcWithStats();
    expect(matchDurationSec(mc)).toBe(60);
    expect(formatDuration(65)).toBe('1:05');
  });
});
