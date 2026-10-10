// missileCommand.js — SILO'D module for Missile Command (Island War) game.
// All Missile Command tuning + state logic lives here. gameManager.js only
// delegates to these functions so the game can be removed cleanly.
//
// GRID MODEL: each island is a GRID_COLS x GRID_ROWS grid. Every building
// occupies exactly 1x1 cell. Shields cover Manhattan ranges (no diagonals).
// distance <= shieldTiles), so coverage is obvious on the grid.

export const MISSILE_CONFIG = {
  startingResources: 200,
  economyTickMs: 500,
  maxLevel: 5,
  maxBuildingsPerPlayer: 40,
  // Grid per island (odd columns so the core sits in the very middle)
  gridCols: 13,
  gridRows: 7,
  // Manhattan ranges (no diagonals): shield aura covers 25 squares, healer 13
  shieldTiles: 3, // |dx|+|dy| <= 3 → 25-square aura
  healerTiles: 2, // |dx|+|dy| <= 2 → 13-square aura
  // Missile stockpiling per launcher
  maxStock: 3,
  // Time to build one missile (each launcher builds one at a time)
  loadMs: 5000,
  // Build durations (ms) by target level — each building/upgrade runs its own
  // timer, so everything constructs in parallel.
  buildMs: { 1: 3000, 2: 5000, 3: 10000, 4: 20000, 5: 30000 },
  // Core baseline economy
  coreIncomePerSec: 5,
  // Core
  core: {
    maxHp: 2000,
    regenPerSec: 2,
    // exact middle cell of each island grid
    cell: { gx: 6, gy: 3 },
  },
  costs: {
    // Upgrade costs are near-exponential by current level (cost to go level -> level+1).
    economy: { build: 50, upgrade: [0, 60, 150, 375, 900, 0] },
    shield: { build: 40, upgrade: [0, 50, 125, 300, 700, 0] },
    shield_heavy: { build: 40, upgrade: [0, 50, 125, 300, 700, 0] },
    healer: { build: 45, upgrade: [0, 55, 140, 330, 750, 0] },
    launcher_single: { build: 120 },
    launcher_scatter: { build: 150 },
  },
  economy: {
    // income per sec by level 1..5 — snowballs hard (tuned down slightly)
    income: [0, 2, 4, 7, 11, 15],
    hp: [0, 100, 150, 210, 280, 360],
  },
  shield: {
    tiles: 3, // aura radius (Manhattan, no diagonals) → 25 squares
    hp: [0, 375, 750, 1250, 1875, 2500],
    buildingHp: [0, 150, 225, 313, 413, 525],
  },
  shield_heavy: {
    // 2-tile range, 2x HP
    tiles: 2, // → 13 squares
    hp: [0, 750, 1500, 2500, 3750, 5000],
    buildingHp: [0, 300, 450, 626, 826, 1050],
  },
  healer: {
    healPerSec: [0, 8, 16, 28, 44, 65],
    hp: [0, 100, 150, 210, 280, 360],
  },
  launchers: {
    single: {
      // Missile costs steepen hard with level (entry stays cheap).
      missileCost: [0, 30, 55, 100, 170, 280],
      damage: [0, 120, 200, 300, 420, 560],
      blast: 0, // tiles (Manhattan) — hits the single target cell
      cooldownMs: [0, 4000, 3800, 3500, 3200, 2800],
      speed: 0.103125, // slow cruise — time to see and react (75% pace)
      hp: [0, 120, 180, 250, 330, 420],
    },
    scatter: {
      missileCost: [0, 45, 80, 140, 230, 360],
      // per-pellet damage, 5 pellets each hitting 1 cell — best total damage
      damage: [0, 35, 55, 80, 110, 145],
      pellets: 5,
      blast: 0,
      cooldownMs: [0, 6000, 5700, 5400, 5000, 4600],
      speed: 0.09375,
      hp: [0, 120, 180, 250, 330, 420],
    },
  },
  buildingHpFallback: 120,
};

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function missileSideForPlayer(state, playerId) {
  if (!state?.sides) return null;
  if (state.sides.top === playerId) return 'top';
  if (state.sides.bottom === playerId) return 'bottom';
  return null;
}

// Manhattan distance on the grid (adjacent tiles only — no diagonals)
export function cellDist(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

export function isValidCell(gx, gy) {
  return Number.isInteger(gx) && Number.isInteger(gy) &&
    gx >= 0 && gx < MISSILE_CONFIG.gridCols &&
    gy >= 0 && gy < MISSILE_CONFIG.gridRows;
}

// Normalized world coords of a cell center (for missile flight rendering).
// Top island rect: x 0.01..0.99, y 0.01..0.42. Bottom: y 0.58..0.99.
export function cellToWorld(side, gx, gy) {
  const x = 0.01 + ((gx + 0.5) / MISSILE_CONFIG.gridCols) * 0.98;
  const y = side === 'top'
    ? 0.01 + ((gy + 0.5) / MISSILE_CONFIG.gridRows) * 0.41
    : 0.58 + ((gy + 0.5) / MISSILE_CONFIG.gridRows) * 0.41;
  return { x, y };
}

// Both shield variants share the whole shield pipeline (aura, pool, blocking,
// healing). Heavy is just 2x pool for a smaller aura — it MUST be included
// everywhere a shield is checked or it degenerates into a plain building.
function isShieldType(type) {
  return type === 'shield' || type === 'shield_heavy';
}

function baseStatsFor(type, launcherType, level) {
  const L = Math.max(1, Math.min(5, level));
  if (type === 'economy') return { incomePerSec: MISSILE_CONFIG.economy.income[L], hp: MISSILE_CONFIG.economy.hp[L] };
  if (isShieldType(type)) {
    const cfg = MISSILE_CONFIG[type];
    return { maxShieldHp: cfg.hp[L], shieldTiles: cfg.tiles, hp: cfg.buildingHp[L] };
  }
  if (type === 'healer') return { healPerSec: MISSILE_CONFIG.healer.healPerSec[L], hp: MISSILE_CONFIG.healer.hp[L] };
  if (type === 'launcher') {
    const cfg = MISSILE_CONFIG.launchers[launcherType];
    return {
      missileCost: cfg.missileCost[L],
      missileDamage: cfg.damage[L],
      blast: cfg.blast,
      cooldownMs: cfg.cooldownMs[L],
      missileSpeed: cfg.speed,
      hp: cfg.hp[L],
    };
  }
  return {};
}

export function createMissileCommandState(playerIds, options = {}) {
  const now = Date.now();
  const [p1, p2] = playerIds;
  const buildings = {};
  const resources = {};
  resources[p1] = options.startingResources ?? MISSILE_CONFIG.startingResources;
  resources[p2] = options.startingResources ?? MISSILE_CONFIG.startingResources;

  const cc = MISSILE_CONFIG.core.cell;
  const mkCore = (id, side, ownerId) => ({
    id, type: 'core', side, gx: cc.gx, gy: cc.gy, level: 1, ownerId,
    coreHp: MISSILE_CONFIG.core.maxHp, maxCoreHp: MISSILE_CONFIG.core.maxHp,
    coreRegenPerSec: MISSILE_CONFIG.core.regenPerSec,
    hp: MISSILE_CONFIG.core.maxHp, maxHp: MISSILE_CONFIG.core.maxHp,
  });
  buildings.core_top = mkCore('core_top', 'top', p1);
  buildings.core_bottom = mkCore('core_bottom', 'bottom', p2);

  // Fog of war: each player has a set of explored tiles with timestamps
  // Key: "gx,gy", Value: timestamp when explored (or 0 for permanent)
  const fogOfWar = options.fogOfWar ?? false;

  return {
    sides: { top: p1, bottom: p2 },
    gridCols: MISSILE_CONFIG.gridCols,
    gridRows: MISSILE_CONFIG.gridRows,
    shieldTiles: MISSILE_CONFIG.shieldTiles,
    healerTiles: MISSILE_CONFIG.healerTiles,
    coreIncomePerSec: MISSILE_CONFIG.coreIncomePerSec,
    buildings,
    pending: {}, // construction sites & in-progress upgrades, keyed by id
    missiles: [],
    // Keep-firing locks, keyed by playerId. `null`/absent = off. Otherwise
    // { targetGx, targetGy, launcherType, since } — see missileSetKeepFire.
    keepFire: {},
    resources,
    gameStartTime: now,
    lastEconomyTick: now,
    winnerId: null,
    winReason: null,
    fogOfWar,
    // exploredTiles[playerId] = Map<"gx,gy", timestamp> — 0 = permanent (core), >0 = temporary
    exploredTiles: { [p1]: new Map(), [p2]: new Map() },
  };
}

function buildingCountFor(state, playerId) {
  return Object.values(state.buildings).filter(b => b.ownerId === playerId && b.type !== 'core').length;
}

function buildCostFor(buildingType, launcherType) {
  if (buildingType === 'launcher') return MISSILE_CONFIG.costs[`launcher_${launcherType}`]?.build ?? 150;
  if (buildingType === 'shield_heavy') return MISSILE_CONFIG.costs.shield_heavy?.build ?? 40;
  return MISSILE_CONFIG.costs[buildingType]?.build ?? 50;
}

function occupiedCell(state, side, gx, gy, ignoreId = null) {
  if (Object.values(state.buildings).some(b => b.side === side && b.gx === gx && b.gy === gy && b.id !== ignoreId)) return true;
  // Construction sites reserve their cell too
  return Object.values(state.pending ?? {}).some(p => p.kind === 'build' && p.side === side && p.gx === gx && p.gy === gy);
}

function pendingUpgradeFor(state, buildingId) {
  return Object.values(state.pending ?? {}).find(p => p.kind === 'upgrade' && p.upgradeOf === buildingId) || null;
}

// Create the level-1 building for a finished construction site.
function materializeBuilding(state, p) {
  const stats = baseStatsFor(p.type, p.launcherType, 1);
  const b = { id: p.id, type: p.type, side: p.side, gx: p.gx, gy: p.gy, level: 1, ownerId: p.ownerId, hp: stats.hp ?? MISSILE_CONFIG.buildingHpFallback, maxHp: stats.hp ?? MISSILE_CONFIG.buildingHpFallback };
  if (p.type === 'economy') b.incomePerSec = stats.incomePerSec;
  if (isShieldType(p.type)) { b.shieldHp = stats.maxShieldHp; b.maxShieldHp = stats.maxShieldHp; b.shieldTiles = stats.shieldTiles; }
  if (p.type === 'healer') { b.healPerSec = stats.healPerSec; b.healTargetId = null; }
  if (p.type === 'launcher') {
    b.launcherType = p.launcherType;
    b.missileCost = stats.missileCost;
    b.missileDamage = stats.missileDamage;
    b.blast = stats.blast;
    b.missileSpeed = stats.missileSpeed;
    b.cooldownMs = stats.cooldownMs;
    b.lastFiredAt = 0;
    b.stock = 0;
    b.maxStock = MISSILE_CONFIG.maxStock;
    b.loadingUntil = 0;
    b.autobuild = false;
  }
  state.buildings[p.id] = b;
  return b;
}

// Apply a finished upgrade to a building (it kept working at old stats meanwhile).
function applyLevelUp(state, b) {
  b.level += 1;
  const stats = baseStatsFor(b.type, b.launcherType, b.level);
  b.maxHp = stats.hp ?? b.maxHp;
  b.hp = Math.min(b.maxHp, (b.hp ?? b.maxHp) + Math.round(b.maxHp * 0.4)); // heal chunk on upgrade
  if (b.type === 'economy') b.incomePerSec = stats.incomePerSec;
  if (isShieldType(b.type)) {
    const prevMax = b.maxShieldHp;
    b.maxShieldHp = stats.maxShieldHp;
    b.shieldTiles = stats.shieldTiles;
    b.shieldHp = Math.min(b.maxShieldHp, (b.shieldHp ?? prevMax) + Math.round(b.maxShieldHp * 0.5));
  }
  if (b.type === 'healer') { b.healPerSec = stats.healPerSec; }
  if (b.type === 'launcher') {
    b.missileCost = stats.missileCost;
    b.missileDamage = stats.missileDamage;
    b.blast = stats.blast;
    b.cooldownMs = stats.cooldownMs;
    b.missileSpeed = stats.missileSpeed;
  }
  return b;
}

export function missileBuildBuilding(state, playerId, action) {
  const side = missileSideForPlayer(state, playerId);
  if (!side) return { error: 'You are not in this match' };
  if (state.winnerId) return { error: 'Game is over' };
  const { buildingType, launcherType, gx, gy } = action || {};
  if (!['economy', 'shield', 'shield_heavy', 'healer', 'launcher'].includes(buildingType)) return { error: 'Invalid building type' };
  if (buildingType === 'launcher' && !['single', 'scatter'].includes(launcherType)) {
    return { error: 'Pick a launcher type: single or scatter' };
  }
  if (!isValidCell(gx, gy)) return { error: 'Invalid grid square' };
  if (occupiedCell(state, side, gx, gy)) return { error: 'Square occupied — pick an empty square' };
  // Cap counts finished buildings AND queued construction sites (else the cap
  // could be dodged with a queueing spree).
  const activeCount = buildingCountFor(state, playerId) +
    Object.values(state.pending ?? {}).filter(p => p.kind === 'build' && p.ownerId === playerId).length;
  if (activeCount >= MISSILE_CONFIG.maxBuildingsPerPlayer) {
    return { error: 'Building cap reached' };
  }
  const cost = buildCostFor(buildingType, launcherType);
  if ((state.resources[playerId] ?? 0) < cost) return { error: `Need ${cost} credits` };

  // Pay upfront; the site finishes after the Lv1 build time. Runs in parallel
  // with everything else.
  state.resources[playerId] -= cost;
  const now = Date.now();
  const site = {
    id: uid('c'), kind: 'build', type: buildingType, launcherType: buildingType === 'launcher' ? launcherType : undefined,
    side, gx, gy, ownerId: playerId, targetLevel: 1,
    completeAt: now + (MISSILE_CONFIG.buildMs[1] ?? 3000),
  };
  if (!state.pending) state.pending = {};
  state.pending[site.id] = site;
  return { pending: site };
}

function upgradeCostFor(b) {
  if (b.level >= MISSILE_CONFIG.maxLevel) return null;
  if (b.type === 'launcher') {
    // Near-exponential launcher upgrades: 1.2x, 2.5x, 5x, 10x of build cost.
    const mult = [0, 1.2, 2.5, 5, 10][b.level] ?? 10;
    const base = buildCostFor('launcher', b.launcherType);
    return Math.round(base * mult);
  }
  // upgrade table is indexed by current level: cost to go level -> level+1
  const table = MISSILE_CONFIG.costs[b.type]?.upgrade;
  return table ? table[b.level] : 100 * b.level;
}

export function missileUpgradeBuilding(state, playerId, buildingId) {
  if (state.winnerId) return { error: 'Game is over' };
  const b = state.buildings[buildingId];
  if (!b) return { error: 'Building not found' };
  if (b.ownerId !== playerId) return { error: 'Not your building' };
  if (b.type === 'core') return { error: 'Core cannot be upgraded' };
  if (b.level >= MISSILE_CONFIG.maxLevel) return { error: 'Already max level' };
  if (pendingUpgradeFor(state, buildingId)) return { error: 'Upgrade already in progress' };
  const cost = upgradeCostFor(b);
  if ((state.resources[playerId] ?? 0) < cost) return { error: `Need ${cost} credits to upgrade` };
  // Pay upfront; the building keeps working at its old level until the upgrade
  // timer finishes. Each upgrade runs its own timer (parallel upgrades OK).
  state.resources[playerId] -= cost;
  const targetLevel = b.level + 1;
  const now = Date.now();
  const job = {
    id: uid('c'), kind: 'upgrade', type: b.type, launcherType: b.launcherType,
    side: b.side, gx: b.gx, gy: b.gy, ownerId: playerId, targetLevel,
    upgradeOf: buildingId,
    completeAt: now + (MISSILE_CONFIG.buildMs[targetLevel] ?? 5000),
  };
  if (!state.pending) state.pending = {};
  state.pending[job.id] = job;
  return { pending: job };
}

// Build one full shot pattern (single missile / scatter pellets).
// Does NOT push to state or stagger — used per banked shot when firing.
function buildShotPattern(state, launcher, side, enemySide, targetGx, targetGy, now) {
  const from = cellToWorld(launcher.side, launcher.gx, launcher.gy);
  const to = cellToWorld(enemySide, targetGx, targetGy);

  const mk = (cellGx, cellGy, wx, wy, dmg, blast) => ({
    id: uid('m'),
    ownerId: launcher.ownerId,
    launcherId: launcher.id,
    launcherType: launcher.launcherType,
    startX: from.x, startY: from.y,
    targetX: wx, targetY: wy,
    targetGx: cellGx, targetGy: cellGy,
    currentX: from.x, currentY: from.y,
    damage: dmg, blast,
    speed: launcher.missileSpeed || 0.1375,
    createdAt: now,
    deployAt: now,
  });

  if (launcher.launcherType === 'single') {
    return [mk(targetGx, targetGy, to.x, to.y, launcher.missileDamage, launcher.blast)];
  }
  // scatter: 5 pellets on target + orthogonal neighbors (off-island = wasted)
  const cells = [{ gx: targetGx, gy: targetGy }];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const gx = targetGx + dx, gy = targetGy + dy;
    if (isValidCell(gx, gy)) cells.push({ gx, gy });
  }
  return cells.map(c => {
    const w = cellToWorld(enemySide, c.gx, c.gy);
    return mk(c.gx, c.gy, w.x, w.y, launcher.missileDamage, launcher.blast);
  });
}

// Pay to start building one missile in a launcher's stockpile (max 3).
// Takes loadMs to finish (one at a time); completion happens in the tick.
export function missileLoadMissile(state, playerId, launcherId) {
  if (state.winnerId) return { error: 'Game is over' };
  const side = missileSideForPlayer(state, playerId);
  if (!side) return { error: 'You are not in this match' };
  const launcher = state.buildings[launcherId];
  if (!launcher || launcher.type !== 'launcher') return { error: 'Launcher not found' };
  if (launcher.ownerId !== playerId) return { error: 'Not your launcher' };
  const maxStock = launcher.maxStock ?? MISSILE_CONFIG.maxStock;
  if ((launcher.stock ?? 0) >= maxStock) return { error: `Stockpile full (${maxStock})` };
  const now = Date.now();
  if ((launcher.loadingUntil ?? 0) > now) {
    const wait = Math.ceil((launcher.loadingUntil - now) / 1000);
    return { error: `Missile already building… ${wait}s` };
  }
  if ((state.resources[playerId] ?? 0) < (launcher.missileCost || 0)) {
    return { error: `Need ${launcher.missileCost} credits to build a missile` };
  }
  state.resources[playerId] -= launcher.missileCost;
  launcher.loadingUntil = now + (MISSILE_CONFIG.loadMs ?? 5000);
  return { building: launcher };
}

// Flip a launcher's autobuild flag (auto-loads whenever stock isn't full
// and the owner can afford it).
export function missileToggleAutobuild(state, playerId, launcherId) {
  if (state.winnerId) return { error: 'Game is over' };
  if (!missileSideForPlayer(state, playerId)) return { error: 'You are not in this match' };
  const launcher = state.buildings[launcherId];
  if (!launcher || launcher.type !== 'launcher') return { error: 'Launcher not found' };
  if (launcher.ownerId !== playerId) return { error: 'Not your launcher' };
  launcher.autobuild = !launcher.autobuild;
  return { building: launcher };
}

// Fire one launcher's entire stockpile at a cell — everything launches at
// the SAME time (no stagger). Each missile gets a visual lane (-2..2) so
// stacked volleys fan out instead of overlapping pixel-perfect.
function fireVolley(state, launcher, enemySide, targetGx, targetGy, now) {
  const stock = launcher.stock ?? 0;
  if (stock <= 0) return [];
  launcher.stock = 0;
  launcher.lastFiredAt = now;
  const added = [];
  let k = 0;
  for (let i = 0; i < stock; i++) {
    const pattern = buildShotPattern(state, launcher, launcher.side, enemySide, targetGx, targetGy, now);
    for (const m of pattern) {
      m.deployAt = now;
      m.lane = (k++ % 5) - 2;
    }
    added.push(...pattern);
  }
  state.missiles.push(...added);
  return added;
}

// Fire EVERYTHING stockpiled in one launcher as a volley. Stock is consumed.
export function missileLaunch(state, playerId, action) {
  if (state.winnerId) return { error: 'Game is over' };
  const side = missileSideForPlayer(state, playerId);
  if (!side) return { error: 'You are not in this match' };
  const { launcherId, targetGx, targetGy } = action || {};
  const launcher = state.buildings[launcherId];
  if (!launcher || launcher.type !== 'launcher') return { error: 'Launcher not found' };
  if (launcher.ownerId !== playerId) return { error: 'Not your launcher' };
  if (!isValidCell(targetGx, targetGy)) return { error: 'Invalid target square' };
  if ((launcher.stock ?? 0) <= 0) return { error: 'No missiles stockpiled — build some first' };
  const enemySide = side === 'top' ? 'bottom' : 'top';
  const added = fireVolley(state, launcher, enemySide, targetGx, targetGy, Date.now());
  return { missiles: added };
}

// Fire ALL loaded launchers of one type at the same cell ("launch all").
// Each launcher's full stock goes; launchers ripple 300ms apart per missile.
export function missileLaunchType(state, playerId, launcherType, targetGx, targetGy) {
  if (state.winnerId) return { error: 'Game is over' };
  const side = missileSideForPlayer(state, playerId);
  if (!side) return { error: 'You are not in this match' };
  if (!['single', 'scatter'].includes(launcherType)) return { error: 'Invalid launcher type' };
  if (!isValidCell(targetGx, targetGy)) return { error: 'Invalid target square' };
  const launchers = Object.values(state.buildings).filter(
    b => b.type === 'launcher' && b.ownerId === playerId && b.launcherType === launcherType && (b.stock ?? 0) > 0,
  );
  if (launchers.length === 0) return { error: `No loaded ${launcherType} launchers` };
  const enemySide = side === 'top' ? 'bottom' : 'top';
  const now = Date.now();
  const added = [];
  for (const launcher of launchers) {
    added.push(...fireVolley(state, launcher, enemySide, targetGx, targetGy, now));
  }
  return { missiles: added };
}

// Arm or clear a "keep firing" lock. While armed, EVERY missile that finishes
// loading is auto-launched at the locked tile — the player never taps again.
// One lock per player; the launcher type is part of the lock so the ALL 🎯 /
// ALL 💥 choice is baked into it.
export function missileSetKeepFire(state, playerId, action) {
  if (state.winnerId) return { error: 'Game is over' };
  const side = missileSideForPlayer(state, playerId);
  if (!side) return { error: 'You are not in this match' };
  if (!state.keepFire) state.keepFire = {};
  if (!action || action.armed !== true) {
    state.keepFire[playerId] = null;
    return { keepFire: null };
  }
  const { targetGx, targetGy, launcherType } = action;
  if (!isValidCell(targetGx, targetGy)) return { error: 'Invalid target square' };
  if (!['single', 'scatter'].includes(launcherType)) return { error: 'Invalid launcher type' };
  state.keepFire[playerId] = { targetGx, targetGy, launcherType, since: Date.now() };
  return { keepFire: state.keepFire[playerId] };
}

// Apply explosion damage centered on an enemy grid cell with Manhattan radius.
function applyExplosion(state, ownerId, enemySide, gx, gy, blast, damage) {
  const buildings = Object.values(state.buildings).filter(b => b.side === enemySide);
  const shields = buildings.filter(b => isShieldType(b.type) && (b.shieldHp ?? 0) > 0);
  const defaultTiles = state.shieldTiles ?? MISSILE_CONFIG.shieldTiles;

  // Fraction of a shield's pool still standing. Compared across shield and
  // shield_heavy (different max pools) so "% left" is the common currency.
  const pctLeft = (s) => (s.shieldHp ?? 0) / (s.maxShieldHp || 1);
  // Aura radius is per variant: shield 3, shield_heavy 2.
  const rangeOf = (s) => s.shieldTiles ?? defaultTiles;

  // Every shield covering `b`, fullest pool FIRST. A shield never covers
  // itself, but overlapping shields DO cover each other.
  const coveringShields = (b) => shields
    .filter(s => s.id !== b.id && cellDist(s.gx, s.gy, b.gx, b.gy) <= rangeOf(s))
    .sort((a, c) => pctLeft(c) - pctLeft(a));

  // Drain `dmg` down `list` in order — the fullest pool eats the blast and the
  // overflow spills into the next-fullest, so a nearly-spent generator is
  // never sacrificed first. Returns whatever the shields couldn't absorb.
  const absorbThrough = (list, dmg) => {
    let left = dmg;
    for (const s of list) {
      if (left <= 0) break;
      const pool = s.shieldHp ?? 0;
      if (pool <= 0) continue;
      if (pool >= left) { s.shieldHp = pool - left; left = 0; }
      else { s.shieldHp = 0; left = left - pool; }
    }
    return left;
  };

  const destroyed = [];
  let hitAny = false;
  for (const b of buildings) {
    const d = cellDist(b.gx, b.gy, gx, gy);
    if (d > blast) continue;
    hitAny = true;
    // falloff: center full, edge 60%
    const falloff = blast === 0 ? 1 : 1 - (d / (blast + 1)) * 0.4;
    let dmg = damage * falloff;
    if (isShieldType(b.type)) {
      // Shields are covered by overlapping shields too: the covering pools
      // absorb first (full block + overflow), then this shield's own pool,
      // then its structure.
      dmg = absorbThrough(coveringShields(b), dmg);
      if (dmg > 0) dmg = absorbThrough([b], dmg);
    } else {
      // Full block while the pools last: damage eats shield pools in order
      // of % remaining. Only true overflow reaches the building.
      dmg = absorbThrough(coveringShields(b), dmg);
    }
    if (dmg <= 0) continue;
    if (b.type === 'core') {
      b.coreHp = Math.max(0, (b.coreHp ?? 0) - dmg);
      b.hp = b.coreHp;
      // Cores are never deleted — they stay at 0 HP so the win check can fire.
      if (b.coreHp <= 0) destroyed.push(b.id);
    } else {
      b.hp = Math.max(0, (b.hp ?? 100) - dmg);
      if (b.hp <= 0) destroyed.push(b.id);
    }
  }
  // Delete destroyed non-core buildings; cores persist at 0 HP (see win check).
  for (const id of destroyed) {
    if (state.buildings[id]?.type !== 'core') delete state.buildings[id];
  }
  // Empty covered tile: the shield still intercepts the blast. Same rule as a
  // real hit — fullest pool first, overflow spilling into the next-fullest.
  if (!hitAny) {
    const guards = shields
      .filter(s => cellDist(s.gx, s.gy, gx, gy) <= rangeOf(s))
      .sort((a, c) => pctLeft(c) - pctLeft(a));
    absorbThrough(guards, damage);
  }
  return destroyed;
}

// Fog of war constants
const FOG_REVEAL_RADIUS = 3; // Manhattan distance around impact
const FOG_TEMPORARY_DURATION = 5000; // 5 seconds in ms

// Initialize fog of war: cores are permanently visible to both players
function initFogOfWar(state) {
  if (!state.fogOfWar) return;
  const [p1, p2] = [state.sides.top, state.sides.bottom];
  const coreTop = state.buildings.core_top;
  const coreBottom = state.buildings.core_bottom;
  if (coreTop) {
    const key = `${coreTop.gx},${coreTop.gy}`;
    state.exploredTiles[p1].set(key, 0);
    state.exploredTiles[p2].set(key, 0);
  }
  if (coreBottom) {
    const key = `${coreBottom.gx},${coreBottom.gy}`;
    state.exploredTiles[p1].set(key, 0);
    state.exploredTiles[p2].set(key, 0);
  }
}

// Explore tiles around a point (missile impact) for the attacker
function exploreAround(state, ownerId, gx, gy, radius = FOG_REVEAL_RADIUS, duration = FOG_TEMPORARY_DURATION) {
  if (!state.fogOfWar) return;
  const enemyId = state.sides.top === ownerId ? state.sides.bottom : state.sides.top;
  const now = Date.now();
  const expiresAt = now + duration;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      if (Math.abs(dx) + Math.abs(dy) > radius) continue; // Manhattan distance
      const tx = gx + dx;
      const ty = gy + dy;
      if (tx < 0 || tx >= MISSILE_CONFIG.gridCols || ty < 0 || ty >= MISSILE_CONFIG.gridRows) continue;
      const key = `${tx},${ty}`;
      const existing = state.exploredTiles[ownerId].get(key);
      if (existing === 0) continue;
      if (!existing || existing < expiresAt) {
        state.exploredTiles[ownerId].set(key, expiresAt);
      }
    }
  }
}

// Expire temporary fog revelations
function expireFog(state, now) {
  if (!state.fogOfWar) return;
  for (const [pid, tiles] of Object.entries(state.exploredTiles)) {
    for (const [key, expiresAt] of tiles.entries()) {
      if (expiresAt > 0 && expiresAt <= now) {
        tiles.delete(key);
      }
    }
  }
}

// Advance simulation by dt seconds. Returns events for logging.
export function tickMissileCommand(state, now = Date.now()) {
  if (!state || state.winnerId) return { events: [] };
  const events = [];
  const last = state.lastEconomyTick || now;
  const dt = Math.max(0, Math.min(5, (now - last) / 1000));
  state.lastEconomyTick = now;

  // Initialize fog of war on first tick (cores permanently visible)
  initFogOfWar(state);

  // Expire temporary fog revelations
  expireFog(state, now);

  // 0. Construction & upgrades completing now (each runs its own timer)
  if (state.pending) {
    for (const [pid, p] of Object.entries(state.pending)) {
      if (p.completeAt > now) continue;
      delete state.pending[pid];
      if (p.kind === 'build') {
        if (!occupiedCell(state, p.side, p.gx, p.gy)) {
          const b = materializeBuilding(state, p);
          events.push({ type: 'built', id: b.id });
        }
      } else if (p.kind === 'upgrade') {
        const b = state.buildings[p.upgradeOf];
        // Only apply if the building survived and is still the expected level
        if (b && b.type !== 'core' && b.level === p.targetLevel - 1) {
          applyLevelUp(state, b);
          events.push({ type: 'upgraded', id: b.id, level: b.level });
        }
      }
    }
  }

  // 0b. Missile builds finishing now (one at a time per launcher), then
  // autobuild kicks off the next one where enabled and affordable.
  for (const b of Object.values(state.buildings)) {
    if (b.type !== 'launcher') continue;
    if ((b.loadingUntil ?? 0) > 0 && (b.loadingUntil ?? 0) <= now) {
      const maxStock = b.maxStock ?? MISSILE_CONFIG.maxStock;
      if ((b.stock ?? 0) < maxStock) {
        b.stock = (b.stock ?? 0) + 1;
        events.push({ type: 'missile-ready', id: b.id, stock: b.stock });
      }
      b.loadingUntil = 0;
    }
  }
  for (const b of Object.values(state.buildings)) {
    if (b.type !== 'launcher' || !b.autobuild) continue;
    if ((b.loadingUntil ?? 0) > now) continue;
    if ((b.stock ?? 0) >= (b.maxStock ?? MISSILE_CONFIG.maxStock)) continue;
    if ((state.resources[b.ownerId] ?? 0) < (b.missileCost || 0)) continue;
    state.resources[b.ownerId] -= b.missileCost;
    b.loadingUntil = now + (MISSILE_CONFIG.loadMs ?? 5000);
  }

  // 0c. Keep-firing locks: anything stockpiled goes out at the locked tile
  //     the moment it's ready — including missiles that were already loaded
  //     when the lock was armed. Runs before economy so a fresh volley pays
  //     full price and can't be funded by same-tick income.
  if (state.keepFire) {
    for (const [pid, lock] of Object.entries(state.keepFire)) {
      if (!lock) continue;
      const side = missileSideForPlayer(state, pid);
      if (!side) { state.keepFire[pid] = null; continue; }
      const enemySide = side === 'top' ? 'bottom' : 'top';
      for (const b of Object.values(state.buildings)) {
        if (b.type !== 'launcher' || b.ownerId !== pid) continue;
        if (b.launcherType !== lock.launcherType) continue;
        if ((b.stock ?? 0) <= 0) continue;
        const added = fireVolley(state, b, enemySide, lock.targetGx, lock.targetGy, now);
        if (added.length) events.push({ type: 'keepfire', id: b.id, count: added.length });
      }
    }
  }

  // 1. Economy income (continuous) — generators plus each living core's baseline
  for (const b of Object.values(state.buildings)) {
    if (b.type !== 'economy') continue;
    state.resources[b.ownerId] = (state.resources[b.ownerId] ?? 0) + (b.incomePerSec ?? 0) * dt;
  }
  const coreIncome = state.coreIncomePerSec ?? MISSILE_CONFIG.coreIncomePerSec;
  for (const b of Object.values(state.buildings)) {
    if (b.type !== 'core') continue;
    if ((b.coreHp ?? 0) <= 0) continue;
    state.resources[b.ownerId] = (state.resources[b.ownerId] ?? 0) + coreIncome * dt;
  }
  // 2. Core regen (dead cores stay dead)
  for (const b of Object.values(state.buildings)) {
    if (b.type !== 'core') continue;
    if ((b.coreHp ?? 0) <= 0) continue;
    b.coreHp = Math.min(b.maxCoreHp, (b.coreHp ?? b.maxCoreHp) + (b.coreRegenPerSec ?? 0) * dt);
    b.hp = b.coreHp;
  }
  // 3. Shield healers: ONE shield at a time — the least healthy % in range.
  //    The target id is stored on the healer so clients can draw the heal beam.
  //    Shields also slowly self-repair (1/8 of a same-level healer's rate).
  const healerTiles = state.healerTiles ?? MISSILE_CONFIG.healerTiles;
  const shields = Object.values(state.buildings).filter(b => isShieldType(b.type));
  const healers = Object.values(state.buildings).filter(b => b.type === 'healer');
  for (const h of healers) {
    let best = null;
    let bestPct = 1;
    for (const s of shields) {
      if (s.side !== h.side) continue;
      if (cellDist(h.gx, h.gy, s.gx, s.gy) > healerTiles) continue;
      const pct = (s.shieldHp ?? 0) / (s.maxShieldHp ?? 1);
      if (pct < bestPct) { bestPct = pct; best = s; }
    }
    if (best && bestPct < 1 - 1e-6) {
      best.shieldHp = Math.min(best.maxShieldHp, (best.shieldHp ?? 0) + (h.healPerSec ?? 0) * dt);
      h.healTargetId = best.id;
    } else {
      h.healTargetId = null;
    }
  }
  for (const s of shields) {
    const selfRate = (MISSILE_CONFIG.healer.healPerSec[Math.max(1, Math.min(5, s.level))] ?? 0) / 8;
    s.shieldHp = Math.min(s.maxShieldHp, (s.shieldHp ?? 0) + selfRate * dt);
  }
  // 4. Missiles (banked volleys deploy 300ms apart)
  const remaining = [];
  for (const m of state.missiles) {
    if ((m.deployAt ?? 0) > now) { remaining.push(m); continue; }
    const dx = m.targetX - m.currentX;
    const dy = m.targetY - m.currentY;
    const d = Math.sqrt(dx * dx + dy * dy);
    const step = (m.speed || 0.5) * dt;
    if (d <= step + 1e-6) {
      // impact!
      const ownerSide = missileSideForPlayer(state, m.ownerId);
      const enemySide = ownerSide === 'top' ? 'bottom' : 'top';
      const destroyed = applyExplosion(state, m.ownerId, enemySide, m.targetGx, m.targetGy, m.blast, m.damage);
      if (destroyed.length) events.push({ type: 'destroyed', ids: destroyed });
      events.push({ type: 'impact', gx: m.targetGx, gy: m.targetGy, kind: m.launcherType });
      // Fog of war: reveal area around impact for the attacker
      exploreAround(state, m.ownerId, m.targetGx, m.targetGy);
    } else {
      m.currentX += (dx / d) * step;
      m.currentY += (dy / d) * step;
      remaining.push(m);
    }
  }
  state.missiles = remaining;

  // 5. Win check — core at 0 HP (cores persist instead of being deleted)
  const topCore = Object.values(state.buildings).find(b => b.type === 'core' && b.side === 'top');
  const botCore = Object.values(state.buildings).find(b => b.type === 'core' && b.side === 'bottom');
  const topDead = !topCore || (topCore.coreHp ?? 1) <= 0;
  const botDead = !botCore || (botCore.coreHp ?? 1) <= 0;
  if (topDead || botDead) {
    const deadSide = topDead && !botDead ? 'top' : !topDead && botDead ? 'bottom' : null;
    if (deadSide) {
      const winnerSide = deadSide === 'top' ? 'bottom' : 'top';
      state.winnerId = state.sides[winnerSide];
      state.winReason = 'core_destroyed';
      state.keepFire = {};
      events.push({ type: 'core_destroyed', side: deadSide, winnerId: state.winnerId });
    }
  }
  // NOTE: resources stay fractional internally (no per-tick rounding — that
  // would compound upward); clients floor values for display.
  return { events };
}

export function missileIncomePerSec(state, playerId) {
  let income = Object.values(state.buildings)
    .filter(b => b.ownerId === playerId && b.type === 'economy')
    .reduce((s, b) => s + (b.incomePerSec ?? 0), 0);
  const core = Object.values(state.buildings).find(b => b.ownerId === playerId && b.type === 'core');
  if (core && (core.coreHp ?? 0) > 0) income += state.coreIncomePerSec ?? MISSILE_CONFIG.coreIncomePerSec;
  return income;
}
