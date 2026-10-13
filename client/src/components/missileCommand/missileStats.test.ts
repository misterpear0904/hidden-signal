import { describe, it, expect } from 'vitest';
import { emptyStats, statsOf, totalIncome, formatDuration, matchDurationSec, incomeSeries } from './MissileCommandStats';
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

  it('normalizes the income-rate series for the chart', () => {
    const mc = mcWithStats();
    expect(incomeSeries(mc)).toEqual([]);
    expect(incomeSeries(null)).toEqual([]);
    mc.incomeHistory = { samples: [[0, 5, 5], [60, 12.5, 7], [120, 20, 7]] };
    expect(incomeSeries(mc)).toEqual([
      { t: 0, top: 5, bottom: 5 },
      { t: 60, top: 12.5, bottom: 7 },
      { t: 120, top: 20, bottom: 7 },
    ]);
  });

  it('drops malformed samples and clamps negatives', () => {
    const mc = mcWithStats();
    mc.incomeHistory = { samples: [[10, 8, 6], ['x', 1, 2] as unknown as [number, number, number], [20, -4, 6], [30]] as unknown as Array<[number, number, number]> };
    expect(incomeSeries(mc)).toEqual([
      { t: 10, top: 8, bottom: 6 },
      { t: 20, top: 0, bottom: 6 },
    ]);
  });
});
