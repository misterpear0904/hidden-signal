// ─── Slim missile tick merge ("mc-tick") ────────────────────────────────
// Bandwidth plan option 1: the server's full `room-state` now travels only
// on real events (launch/impact/build/...). Between events a tiny `mc-tick`
// frame carries just the volatile parts: missiles in flight, floored
// resources, changed building dynamic fields, and the supply ship only when
// its presence flips. This module merges one such frame over the currently
// known RoomState.
//
// Ordering is safe without timestamps: both messages ride the same socket.io
// connection and engine.io preserves FIFO, so any mc-tick that arrives after
// a room-state was emitted later on the server.
import type { RoomState, MissileInFlight } from '../../types/game';

// Per-building dynamic fields the server may patch. `s` shield pool HP,
// `c` core HP, `st` stockpile count, `lu` missile load completion timestamp,
// `ht` heal-beam target id (null when idle). Only fields present in the
// patch are applied — absent keys leave the known value untouched.
export interface MissileTickBuildingDyn {
  s?: number;
  c?: number;
  st?: number;
  lu?: number;
  ht?: string | null;
}

export interface MissileTickPayload {
  t?: number; // server clock (ms) — informational
  m?: MissileInFlight[]; // full list of missiles in flight (rounded floats)
  res?: Record<string, number>; // floored resources, only changed players
  bd?: Record<string, MissileTickBuildingDyn>; // only buildings that changed
  sh?: Record<string, number | string> | null; // supply ship or (sailed away)
}

export function applyMissileTick(prev: RoomState, payload: MissileTickPayload): RoomState {
  const mc = prev?.missileCommandState as typeof prev.missileCommandState | null;
  if (!mc) return prev;
  let nextMc: typeof mc | null = null;
  const dirty = () => { nextMc = nextMc ?? { ...mc }; return nextMc; };

  if (payload.m) (dirty()).missiles = payload.m;
  if (payload.res) {
    const n = dirty();
    n.resources = { ...mc.resources, ...payload.res };
  }
  if (payload.bd && Object.keys(payload.bd).length > 0) {
    const buildings = { ...(mc.buildings ?? {}) };
    let changed = false;
    for (const [id, patch] of Object.entries(payload.bd)) {
      const b = buildings[id];
      if (!b) continue; // unknown id (e.g. fog-filtered or stale) — ignore
      const p = patch as Partial<MissileInFlight & MissileTickBuildingDyn & { lu: number }>;
      const nb: typeof b = { ...b };
      if (p.s !== undefined) nb.shieldHp = p.s;
      if (p.c !== undefined) nb.coreHp = p.c;
      if (p.st !== undefined) nb.stock = p.st;
      if (p.lu !== undefined) nb.loadingUntil = p.lu;
      if (patch.ht !== undefined) nb.healTargetId = patch.ht;
      if (nb !== b) { buildings[id] = nb; changed = true; }
    }
    // Only dirt() when a field actually changed, so no-op frames keep the
    // mc object identity stable (ups counter + memos skip re-renders).
    if (changed) nextMc = { ...nextMc ?? mc, buildings };
  }

  // Supply ship presence flips: at sea (object) or sailed off (null).
  if (payload.sh !== undefined) {
    const next = dirty();
    next.supplyShip = payload.sh === null ? null : (next.supplyShip
      ? { ...next.supplyShip, ...payload.sh } as typeof next.supplyShip
      : payload.sh as unknown as typeof next.supplyShip);
  }

  return nextMc ? { ...prev, missileCommandState: nextMc } : prev;
}
