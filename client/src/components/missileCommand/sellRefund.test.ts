// Client/server refund parity: the lobby/panel quote (client/config.ts) must
// match the actual payout (server/missileCommand.js) for every building type
// and level, or players get a different number than advertised.
import { describe, it, expect } from 'vitest';
import { sellRefundFor, SELL_SECONDS, SELL_REFUND_RATE } from './config';
import {
  totalInvestedFor,
  sellRefundForBuilding,
  MISSILE_CONFIG,
} from '../../../../server/missileCommand.js';

describe('sell refund parity', () => {
  it('mirrors the server tuning constants', () => {
    expect(SELL_SECONDS * 1000).toBe(MISSILE_CONFIG.sellMs);
    expect(SELL_REFUND_RATE).toBe(MISSILE_CONFIG.sellRefundRate);
  });

  const cases: Array<{
    type: 'economy' | 'shield' | 'shield_heavy' | 'healer' | 'launcher';
    launcherType?: 'single' | 'scatter';
  }> = [
    { type: 'economy' },
    { type: 'shield' },
    { type: 'shield_heavy' },
    { type: 'healer' },
    { type: 'launcher', launcherType: 'single' },
    { type: 'launcher', launcherType: 'scatter' },
  ];

  for (const { type, launcherType } of cases) {
    for (let level = 1; level <= 5; level++) {
      it(`quotes the exact payout for ${type}${launcherType ? `/${launcherType}` : ''} Lv${level}`, () => {
        const mine = sellRefundFor({ type, level, launcherType });
        const theirs = sellRefundForBuilding({ type, launcherType, level });
        expect(mine).toBe(theirs);
        // Sanity: refund is 70% floored of the true total invested.
        expect(mine).toBe(Math.floor(totalInvestedFor(type, launcherType, level) * 0.7));
      });
    }
  }
});
