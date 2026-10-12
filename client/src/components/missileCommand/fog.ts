// Pure fog-of-war vision helpers (no React, no DOM).
// exploredTiles encoding: 0 = permanent (core), -1 = remembered, >0 = expiry ms.

export type TileVision = 'live' | 'stale' | 'hidden';

export function visionOfTile(
  explored: Record<string, number> | undefined,
  opts: { fogOfWar: boolean; fogHistory: boolean; now: number },
  gx: number,
  gy: number,
): TileVision {
  if (!opts.fogOfWar) return 'live';
  const v = explored?.[`${gx},${gy}`];
  if (v === undefined) return 'hidden';
  if (v === 0 || v > opts.now) return 'live';
  // Lapsed reveal: remembered only with history on, otherwise fully dark.
  return opts.fogHistory ? 'stale' : 'hidden';
}

// Live sight only. Stale tiles are memory, not vision — aura/beam effects
// and inspection must not leak through them.
export function canSeeEnemyAtTile(
  explored: Record<string, number> | undefined,
  opts: { fogOfWar: boolean; fogHistory: boolean; now: number },
  gx: number,
  gy: number,
): boolean {
  return visionOfTile(explored, opts, gx, gy) === 'live';
}

// Enemy buildings render when seen; stale ones render dimmed, never hidden
// (history on). Cores and own buildings always render.
export function enemyBuildingVisibility(
  isMine: boolean,
  isCore: boolean,
  vision: TileVision,
): 'live' | 'stale' | 'hidden' {
  if (isMine || isCore) return 'live';
  return vision;
}

// Construction/upgrade activity is transient intel: only with live vision.
// (A stale 🚧 would double-show once the site completes into a building.)
export function showEnemyPending(vision: TileVision): boolean {
  return vision === 'live';
}
