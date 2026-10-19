// Unit tests for the slim mc-tick merge (bandwidth plan option 1).
// The server sends tiny high-frequency frames between full room-states;
// applyMissileTick patches only the volatile parts onto the current state.
import { describe, it, expect } from 'vitest';
import { applyMissileTick, type MissileTickPayload } from './mcTick';
import type { RoomState } from '../../types/game';

const roomState = (mc: Record<string, unknown> = {}): RoomState => ({
  missileCommandState: {
    sides: { top: 'p1', bottom: 'p2' },
    buildings: {
      core_top: { id: 'core_top', type: 'core', coreHp: 4000, maxCoreHp: 4000 },
      shield1: { id: 'shield1', type: 'shield', shieldHp: 100, maxShieldHp: 200, healTargetId: null },
    },
    missiles: [],
    resources: { p1: 200, p2: 200 },
    supplyShip: null,
    ...mc,
  } as unknown as RoomState['missileCommandState'],
  players: [],
} as unknown as RoomState);

describe('applyMissileTick', () => {
  it('replaces the missile list and keeps other state intact', () => {
    const rs = roomState({ missiles: [{ id: 'gone' }] as never });
    const out = applyMissileTick(rs, {
      m: [{ id: 'm1', ownerId: 'p1', launcherId: null as never, launcherType: 'single' }] as never,
    });
    const mc = out.missileCommandState!;
    expect(mc.missiles).toHaveLength(1);
    expect((mc.missiles![0] as { id: string }).id).toBe('m1');
    expect(mc.buildings.core_top).toBe(rs.missileCommandState!.buildings.core_top);
  });

  it('merges resources per player', () => {
    const rs = roomState();
    const out = applyMissileTick(rs, { res: { p1:  231 } });
    expect(out.missileCommandState!.resources.p1).toBe(231);
    expect(out.missileCommandState!.resources.p2).toBe(200);
  });

  it('patches only provided building fields and skips unknown ids', () => {
    const rs = roomState();
    const out = applyMissileTick(rs, { bd: { shield1: { s: 142, ht: 'shield1' }, ghost: { s: 1 } } });
    const b = out.missileCommandState!.buildings.shield1 as Record<string, unknown>;
    expect(b.shieldHp).toBe(142);
    expect(b.healTargetId).toBe('shield1');
    expect(b.maxShieldHp).toBe(200, 'unpatched field preserved');
    expect((out.missileCommandState!.buildings as Record<string, unknown>).ghost).toBeUndefined();
  });

  it('handles ship appearance and sailing away', () => {
    const ship = { id: 'sh1', dir: 1, fromX: -0.12, toX: 1.12, y: 0.5, startAt: 0, endAt: 900 };
    const rs = roomState();
    const appeared = applyMissileTick(rs, { sh: ship });
    expect(appeared.missileCommandState!.supplyShip).toEqual(ship);
    const gone = applyMissileTick(appeared, { sh: null });
    expect(gone.missileCommandState!.supplyShip).toBeNull();
  });

  it('returns the same reference when nothing applies', () => {
    const rs = roomState();
    expect(applyMissileTick(rs, {})).toBe(rs);
    expect(applyMissileTick(rs, { bd: {} })).toBe(rs, 'empty diff object is a no-op');
  });

  it('tolerates a state without missile data', () => {
    const rarity = { phase: 'lobby', missileCommandState: null } as unknown as RoomState;
    expect(applyMissileTick(rarity, { m: [] as never })).toBe(rarity);
  });
});
