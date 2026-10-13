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
  // Selling takes 20s and refunds 70% of total invested (build + upgrades).
  sellMs: 20000,
  sellRefundRate: 0.7,
  // Core baseline economy
  coreIncomePerSec: 5,
  // Core
  core: {
    maxHp: 4000,
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
      speed: 0.07734375, // slow cruise — time to see and react
      hp: [0, 120, 180, 250, 330, 420],
    },
    scatter: {
      missileCost: [0, 45, 80, 140, 230, 360],
      // per-pellet damage, 5 pellets each hitting 1 cell — best total damage
      damage: [0, 35, 55, 80, 110, 145],
      pellets: 5,
      blast: 0,
      cooldownMs: [0, 6000, 5700, 5400, 5000, 4600],
      speed: 0.0703125,
      hp: [0, 120, 180, 250, 330, 420],
    },
  },
  // One-time comeback superweapon. Unlocks when your core drops to 50% HP.
  // No launcher needed, free to fire — the price was nearly losing. Big raw
  // damage over a wide blast; shields absorb it normally (no piercing), so it
  // cracks entrenched positions but never one-shots a healthy core.
  desperation: {
    thresholdPct: 0.5,
    damage: 2000,
    blast: 2, // Manhattan radius
    pierce: 0, // no shield bypass — raw damage only
    speed: 0.09,
  },
  // Neutral supply ship (optional lobby toggle, off by default). A freighter
  // periodically crosses the channel; either player can tap it to claim a
  // random payout. Every payout scales with net-worth disparity (your
  // buildings' invested value vs theirs), clamped 0.5x–2x, so the player
  // who is behind gets more.
  supplyShip: {
    intervalMs: 60000, // average time between sailings
    jitterMs: 15000, // randomized ± on top of the interval
    crossMs: 18000, // time to cross the channel (claim window)
    firstShipMs: 25000, // first sailing after game start
    channelY: 0.5, // normalized y of the shipping lane
    barrageDamage: 80, // per-tile damage of the missile-rain payout
    barrageSpeed: 0.09, // cruise speed of rain missiles
    barrageStaggerMs: 150, // ripple between rain missiles
    baseCoverage: 0.25, // enemy-tile fraction rained on, before scaling
    maxCoverage: 0.5, // ...never more than half the island
    baseCredits: 500, // credits payout, before scaling
    maxCredits: 1000, // ...capped here
    surgeBaseMs: 30000, // 2x build-speed window, before scaling
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

  // Fog of war: each player has a set of explored tiles with timestamps.
  // Key: "gx,gy", Value: expiry timestamp (0 = permanent). Plain objects, not
  // Maps — Maps serialize to {} over socket.io and the client would see no
  // fog data at all.
  const fogOfWar = options.fogOfWar ?? true;
  // History (remembered last-known buildings) is OFF by default — lapsed
  // reveals vanish entirely unless the lobby opts in.
  const fogHistory = options.fogHistory ?? false;
  const exploredTiles = { [p1]: {}, [p2]: {} };
  // Seed both cores as permanently explored for BOTH players, so the very
  // first state a client receives already knows where the cores are.
  if (fogOfWar) {
    for (const core of Object.values(buildings)) {
      exploredTiles[p1][`${core.gx},${core.gy}`] = 0;
      exploredTiles[p2][`${core.gx},${core.gy}`] = 0;
    }
  }

  return {
    sides: { top: p1, bottom: p2 },
    gridCols: MISSILE_CONFIG.gridCols,
    gridRows: MISSILE_CONFIG.gridRows,
    shieldTiles: MISSILE_CONFIG.shieldTiles,
    healerTiles: MISSILE_CONFIG.healerTiles,
    coreIncomePerSec: MISSILE_CONFIG.coreIncomePerSec,
    buildings,
    pending: {}, // construction sites & in-progress upgrades, keyed by id
    // Rubble left by destroyed buildings, keyed by id. { id, side, gx, gy,
    // ownerId, type, launcherType?, createdAt }. Sell-demolished and cores
    // leave none — only enemy-fire destruction.
    rubble: {},
    missiles: [],
    // Keep-firing locks, keyed by playerId. `null`/absent = off. Otherwise
    // { targetGx, targetGy, launcherType, since } — see missileSetKeepFire.
    keepFire: {},
    // Desperation strike per player: { unlocked, used }. Unlocks once your
    // core hits 50% HP and latches — healing back above it keeps the unlock.
    desperation: { [p1]: { unlocked: false, used: false }, [p2]: { unlocked: false, used: false } },
    // Neutral supply ship (optional). supplyShip is the live freighter or
    // null; nextShipAt schedules the next sailing; buildSurge maps playerId
    // to the ms timestamp a 2x build-speed window expires; lastSupply is the
    // most recent claim, so clients can toast it.
    supplyShipEnabled: options.supplyShip ?? false,
    supplyShip: null,
    nextShipAt: now + (MISSILE_CONFIG.supplyShip.firstShipMs ?? 25000),
    buildSurge: {},
    lastSupply: null,
    resources,
    gameStartTime: now,
    gameEndTime: null,
    lastEconomyTick: now,
    winnerId: null,
    winReason: null,
    stats: { [p1]: freshMissileStats(), [p2]: freshMissileStats() },
    // Income-rate history for the post-game chart: samples are
    // [secondsSinceStart, topIncomePerSec, bottomIncomePerSec], taken every
    // ~2s in the tick and capped so long games can't grow it unbounded.
    incomeHistory: { samples: [], lastSampleAt: 0 },
    fogOfWar,
    fogHistory,
    // exploredTiles[playerId]["gx,gy"] = 0 permanent, -1 remembered, else expiry ms
    exploredTiles: { [p1]: exploredTiles[p1], [p2]: exploredTiles[p2] },
  };
}

export function freshMissileStats() {
  return {
    damageDealt: 0, // raw HP removed from enemy (structure + core, post-shield)
    shieldAbsorbedByEnemy: 0, // your missiles eaten by enemy shield pools
    shieldBlocked: 0, // damage YOUR shields absorbed (defensive)
    structureDamage: 0, // non-core structure HP removed by you
    coreDamage: 0, // core HP removed by you
    missilesLaunched: 0, // projectiles (scatter pellets count individually)
    volleys: 0, // launcher-volleys fired (one launcher firing once)
    buildingsBuilt: 0,
    buildingsLost: 0, // your buildings destroyed by enemy fire
    buildingsDestroyed: 0, // enemy buildings you destroyed
    buildingsSold: 0,
    incomeEconomy: 0,
    incomeCore: 0,
    incomeSupply: 0,
    supplyClaims: 0,
    shieldHealed: 0, // pool HP restored (healers + self-repair)
  };
}

function ensureStats(state, playerId) {
  if (!state.stats) state.stats = {};
  if (!state.stats[playerId]) state.stats[playerId] = freshMissileStats();
  return state.stats[playerId];
}

function ensureAllStats(state) {
  if (!state.stats) state.stats = {};
  for (const pid of [state.sides?.top, state.sides?.bottom]) {
    if (pid) ensureStats(state, pid);
  }
  return state.stats;
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

function pendingSellFor(state, buildingId) {
  return Object.values(state.pending ?? {}).find(p => p.kind === 'sell' && p.sellOf === buildingId) || null;
}

// Total credits ever paid for a building: build cost + every upgrade cost on
// the way to its current level. Upgrade pricing is deterministic per level,
// so this reconstructs the exact spend without tracking it per building.
export function totalInvestedFor(type, launcherType, level) {
  let total = buildCostFor(type, launcherType);
  for (let l = 1; l < (level ?? 1); l++) {
    total += upgradeCostFor({ type, launcherType, level: l }) ?? 0;
  }
  return total;
}

// 70% of total invested, rounded down. Computed once when the sale is
// ordered and stored on the job, so the payout can't shift mid-sale.
export function sellRefundForBuilding(b) {
  return Math.floor(totalInvestedFor(b.type, b.launcherType, b.level ?? 1) * (MISSILE_CONFIG.sellRefundRate ?? 0.7));
}

// Build-speed multiplier from an active shipyard-surge payout (2x while the
// window lasts, 1x otherwise). Applied to construction, upgrades, and
// missile loads started inside the window.
export function surgeRate(state, playerId, now = Date.now()) {
  return (state.buildSurge?.[playerId] ?? 0) > now ? 2 : 1;
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
    // Autobuild is always ON: every launcher auto-loads whenever stock isn't
    // full and the owner can afford it. No toggle — one less thing to manage.
    b.autobuild = true;
  }
  state.buildings[p.id] = b;
  try { ensureStats(state, p.ownerId).buildingsBuilt += 1; } catch { /* stats optional */ }
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
  // No building cap: the grid itself (13x7 per island) is the only limit.
  const cost = buildCostFor(buildingType, launcherType);
  if ((state.resources[playerId] ?? 0) < cost) return { error: `Need ${cost} credits` };

  // Pay upfront; the site finishes after the Lv1 build time. Runs in parallel
  // with everything else. Building over your own rubble clears it (the ♻️
  // rebuild button is the discounted instant path; this is the flexible one).
  state.resources[playerId] -= cost;
  for (const [rid, rb] of Object.entries(state.rubble ?? {})) {
    if (rb.side === side && rb.gx === gx && rb.gy === gy && rb.ownerId === playerId) {
      delete state.rubble[rid];
      break;
    }
  }
  const now = Date.now();
  const site = {
    id: uid('c'), kind: 'build', type: buildingType, launcherType: buildingType === 'launcher' ? launcherType : undefined,
    side, gx, gy, ownerId: playerId, targetLevel: 1, cost,
    completeAt: now + (MISSILE_CONFIG.buildMs[1] ?? 3000) / surgeRate(state, playerId, now),
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
  if (pendingSellFor(state, buildingId)) return { error: 'Sale in progress — cancel it first' };
  const cost = upgradeCostFor(b);
  if ((state.resources[playerId] ?? 0) < cost) return { error: `Need ${cost} credits to upgrade` };
  // Pay upfront; the building keeps working at its old level until the upgrade
  // timer finishes. Each upgrade runs its own timer (parallel upgrades OK).
  state.resources[playerId] -= cost;
  const targetLevel = b.level + 1;
  const now = Date.now();
  const job = {
    id: uid('c'), kind: 'upgrade', type: b.type, launcherType: b.launcherType,
    side: b.side, gx: b.gx, gy: b.gy, ownerId: playerId, targetLevel, cost,
    upgradeOf: buildingId,
    completeAt: now + (MISSILE_CONFIG.buildMs[targetLevel] ?? 5000) / surgeRate(state, playerId, now),
  };
  if (!state.pending) state.pending = {};
  state.pending[job.id] = job;
  return { pending: job };
}

// List a building for sale. It keeps working for the 20s demolition timer,
// then is removed and 70% of total invested (build + upgrades) is refunded.
// Stockpiled missiles and in-progress loads are lost with it — sell AFTER
// firing if that matters. Cancelling is free (nothing is paid upfront).
export function missileSellBuilding(state, playerId, buildingId) {
  if (state.winnerId) return { error: 'Game is over' };
  const side = missileSideForPlayer(state, playerId);
  if (!side) return { error: 'You are not in this match' };
  const b = state.buildings[buildingId];
  if (!b) return { error: 'Building not found' };
  if (b.ownerId !== playerId) return { error: 'Not your building' };
  if (b.type === 'core') return { error: 'Core cannot be sold' };
  if (pendingSellFor(state, buildingId)) return { error: 'Sale already in progress' };
  if (pendingUpgradeFor(state, buildingId)) return { error: 'Upgrade in progress — wait or let it finish first' };
  const now = Date.now();
  const job = {
    id: uid('c'), kind: 'sell', type: b.type, launcherType: b.launcherType,
    side: b.side, gx: b.gx, gy: b.gy, ownerId: playerId,
    sellOf: buildingId, refund: sellRefundForBuilding(b),
    completeAt: now + (MISSILE_CONFIG.sellMs ?? 20000),
  };
  if (!state.pending) state.pending = {};
  state.pending[job.id] = job;
  return { pending: job };
}

// Cancel a pending sale. Free — the refund was never paid out.
export function missileCancelSell(state, playerId, buildingId) {
  if (state.winnerId) return { error: 'Game is over' };
  if (!missileSideForPlayer(state, playerId)) return { error: 'You are not in this match' };
  const job = pendingSellFor(state, buildingId);
  if (!job) return { error: 'No sale in progress' };
  if (job.ownerId !== playerId) return { error: 'Not your building' };
  delete state.pending[job.id];
  return { cancelled: buildingId };
}

// Rebuild on your own rubble: SAME type as the destroyed building comes
// back instantly at level 1 for half the build cost. Anything else goes
// through the normal build pipeline (full cost + build time), which also
// clears the rubble — use the ♻️ button for the discount, the build menu
// for flexibility.
export function missileRebuildRubble(state, playerId, rubbleId) {
  if (state.winnerId) return { error: 'Game is over' };
  const side = missileSideForPlayer(state, playerId);
  if (!side) return { error: 'You are not in this match' };
  const r = state.rubble?.[rubbleId];
  if (!r) return { error: 'Rubble not found' };
  if (r.ownerId !== playerId || r.side !== side) return { error: 'Not your rubble' };
  if (occupiedCell(state, side, r.gx, r.gy)) return { error: 'Square occupied' };
  const cost = Math.floor(buildCostFor(r.type, r.launcherType) / 2);
  if ((state.resources[playerId] ?? 0) < cost) return { error: `Need ${cost} credits` };
  state.resources[playerId] -= cost;
  const b = materializeBuilding(state, {
    id: uid('b'), type: r.type, launcherType: r.launcherType,
    side: r.side, gx: r.gx, gy: r.gy, ownerId: playerId,
  });
  delete state.rubble[rubbleId];
  return { building: b };
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
  launcher.loadingUntil = now + (MISSILE_CONFIG.loadMs ?? 5000) / surgeRate(state, playerId, now);
  return { building: launcher };
}

// Fire one launcher's entire stockpile at a cell — everything launches at
// the SAME time (no stagger). Each missile gets a visual lane (-2..2) so
// stacked volleys fan out instead of overlapping pixel-perfect.
function fireVolley(state, launcher, enemySide, targetGx, targetGy, now) {
  const stock = launcher.stock ?? 0;
  if (stock <= 0) return [];
  // Per-launcher fire-rate gate. Cooldowns were configured and tracked but
  // never read — this is what differentiates single (4s) vs scatter (6s)
  // and rate-limits keep-fire autofire. Checked BEFORE consuming stock.
  const cd = launcher.cooldownMs ?? 0;
  if (cd > 0 && now - (launcher.lastFiredAt ?? 0) < cd) return [];
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
  try {
    const st = ensureStats(state, launcher.ownerId);
    st.missilesLaunched += added.length;
    st.volleys += 1;
  } catch { /* stats optional */ }
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
  const now = Date.now();
  const cd = launcher.cooldownMs ?? 0;
  if (cd > 0 && now - (launcher.lastFiredAt ?? 0) < cd) {
    const wait = Math.ceil((cd - (now - launcher.lastFiredAt)) / 1000);
    return { error: `Launcher recharging… ${wait}s` };
  }
  const enemySide = side === 'top' ? 'bottom' : 'top';
  const added = fireVolley(state, launcher, enemySide, targetGx, targetGy, now);
  return { missiles: added };
}

// Fire ALL loaded launchers of one type at the same cell ("launch all").
// Each launcher's full stock goes; launchers ripple 300ms apart so the
// barrage reads as a wave instead of one instant stack.
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
  let li = 0;
  for (const launcher of launchers) {
    const batch = fireVolley(state, launcher, enemySide, targetGx, targetGy, now);
    for (const m of batch) m.deployAt = now + li * 300;
    li++;
    added.push(...batch);
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

// Fire the one-time desperation strike. Needs no launcher and costs nothing —
// the price was nearly losing. Launches from the owner's core as a single
// NON-piercing warhead (shields absorb it normally).
export function missileFireDesperation(state, playerId, action) {
  if (state.winnerId) return { error: 'Game is over' };
  const side = missileSideForPlayer(state, playerId);
  if (!side) return { error: 'You are not in this match' };
  const { targetGx, targetGy } = action || {};
  if (!isValidCell(targetGx, targetGy)) return { error: 'Invalid target square' };
  const flag = state.desperation?.[playerId];
  if (!flag?.unlocked) return { error: 'Desperation strike not unlocked — core must drop to 50%' };
  if (flag.used) return { error: 'Desperation strike already spent' };
  const core = Object.values(state.buildings).find(b => b.type === 'core' && b.ownerId === playerId);
  if (!core || (core.coreHp ?? 0) <= 0) return { error: 'Your core is gone' };
  const cfg = MISSILE_CONFIG.desperation;
  const enemySide = side === 'top' ? 'bottom' : 'top';
  const now = Date.now();
  const from = cellToWorld(side, core.gx, core.gy);
  const to = cellToWorld(enemySide, targetGx, targetGy);
  const m = {
    id: uid('m'),
    ownerId: playerId,
    launcherId: null,
    launcherType: 'single',
    desperation: true,
    startX: from.x, startY: from.y,
    targetX: to.x, targetY: to.y,
    targetGx, targetGy,
    currentX: from.x, currentY: from.y,
    damage: cfg.damage, blast: cfg.blast, pierce: cfg.pierce,
    speed: cfg.speed,
    createdAt: now,
    deployAt: now,
  };
  flag.used = true;
  state.missiles.push(m);
  try {
    const st = ensureStats(state, playerId);
    st.missilesLaunched += 1;
    st.volleys += 1;
  } catch { /* stats optional */ }
  return { missiles: [m] };
}

// Net worth: total invested value of a player's living buildings (cores
// excluded — they were never built). Drives supply-ship payout scaling.
export function netWorthFor(state, playerId) {
  let worth = 0;
  for (const b of Object.values(state.buildings)) {
    if (b.ownerId !== playerId || b.type === 'core') continue;
    worth += totalInvestedFor(b.type, b.launcherType, b.level ?? 1);
  }
  return worth;
}

// Payout scale from net-worth disparity: the further behind you are, the
// bigger the freighter's gift. 1x when even, up to 2x when crushed, down to
// 0.5x when ahead (the leader still gets something for contesting it).
export function supplyScaleFor(myWorth, enemyWorth) {
  const ratio = enemyWorth / Math.max(1, myWorth);
  return Math.max(0.5, Math.min(2, ratio));
}

// Claim the neutral supply freighter by tapping it. First tap wins; the ship
// sails on and the next one is scheduled. One of three payouts, all scaled
// by net-worth disparity:
//   credits — up to 1000cr straight into your wallet
//   barrage — a ripple of ship-launched missiles over random enemy tiles
//   surge   — 2x construction/upgrade/missile-load speed for a scaled window
export function missileClaimShip(state, playerId) {
  if (state.winnerId) return { error: 'Game is over' };
  const side = missileSideForPlayer(state, playerId);
  if (!side) return { error: 'You are not in this match' };
  if (!state.supplyShipEnabled) return { error: 'Supply ships are off' };
  const ship = state.supplyShip;
  const now = Date.now();
  if (!ship || now > ship.endAt) return { error: 'No supply ship right now' };
  const enemySide = side === 'top' ? 'bottom' : 'top';
  const enemyId = state.sides[enemySide];
  const scale = supplyScaleFor(netWorthFor(state, playerId), netWorthFor(state, enemyId));
  const cfg = MISSILE_CONFIG.supplyShip;
  const kinds = ['credits', 'barrage', 'surge'];
  const kind = kinds[Math.floor(Math.random() * kinds.length)];
  let detail = {};
  if (kind === 'credits') {
    const amount = Math.floor(Math.min(cfg.maxCredits, cfg.baseCredits * scale));
    state.resources[playerId] = (state.resources[playerId] ?? 0) + amount;
    detail = { amount };
    try {
      const st = ensureStats(state, playerId);
      st.incomeSupply += amount;
      st.supplyClaims += 1;
    } catch { /* stats optional */ }
  } else if (kind === 'barrage') {
    const cols = MISSILE_CONFIG.gridCols, rows = MISSILE_CONFIG.gridRows;
    const count = Math.round(cols * rows * Math.min(cfg.maxCoverage, cfg.baseCoverage * scale));
    // Distinct random enemy tiles, most-distant-first is unnecessary — pure lottery.
    const tiles = [];
    const seen = new Set();
    let guard = 0;
    while (tiles.length < count && guard++ < count * 20) {
      const gx = Math.floor(Math.random() * cols), gy = Math.floor(Math.random() * rows);
      const key = `${gx},${gy}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tiles.push({ gx, gy });
    }
    const from = { x: shipXAt(ship, now), y: ship.y };
    const added = tiles.map((t, i) => {
      const to = cellToWorld(enemySide, t.gx, t.gy);
      return {
        id: uid('m'),
        ownerId: playerId,
        launcherId: null,
        launcherType: 'single',
        supplyBarrage: true,
        startX: from.x, startY: from.y,
        targetX: to.x, targetY: to.y,
        targetGx: t.gx, targetGy: t.gy,
        currentX: from.x, currentY: from.y,
        damage: cfg.barrageDamage, blast: 0,
        speed: cfg.barrageSpeed ?? 0.12,
        createdAt: now,
        deployAt: now + i * (cfg.barrageStaggerMs ?? 150),
        lane: (i % 5) - 2,
      };
    });
    state.missiles.push(...added);
    detail = { tiles: tiles.length };
    try {
      const st = ensureStats(state, playerId);
      st.missilesLaunched += added.length;
      st.volleys += 1;
      st.supplyClaims += 1;
    } catch { /* stats optional */ }
  } else {
    const durationMs = Math.round(cfg.surgeBaseMs * scale);
    // In-flight work jumps to halfway done; new work started inside the
    // window builds at 2x (see surgeRate at each timer-creation point).
    for (const p of Object.values(state.pending ?? {})) {
      if (p.ownerId !== playerId || (p.kind !== 'build' && p.kind !== 'upgrade')) continue;
      if ((p.completeAt ?? 0) > now) p.completeAt = now + (p.completeAt - now) / 2;
    }
    for (const b of Object.values(state.buildings)) {
      if (b.type !== 'launcher' || b.ownerId !== playerId) continue;
      if ((b.loadingUntil ?? 0) > now) b.loadingUntil = now + (b.loadingUntil - now) / 2;
    }
    if (!state.buildSurge) state.buildSurge = {};
    state.buildSurge[playerId] = now + durationMs;
    detail = { seconds: Math.round(durationMs / 1000) };
    try { ensureStats(state, playerId).supplyClaims += 1; } catch { /* stats optional */ }
  }
  state.supplyShip = null;
  state.nextShipAt = now + cfg.intervalMs + Math.random() * (cfg.jitterMs ?? 0);
  state.lastSupply = { ownerId: playerId, kind, detail, at: now };
  return { supply: state.lastSupply };
}

// Normalized x of the freighter at time `now` (shared by server scheduling
// and client rendering so both agree where the ship is).
export function shipXAt(ship, now) {
  const t = Math.max(0, Math.min(1, (now - ship.startAt) / Math.max(1, ship.endAt - ship.startAt)));
  return ship.fromX + (ship.toX - ship.fromX) * t;
}

// Apply explosion damage centered on an enemy grid cell with Manhattan radius.
// `pierce` (0..1) is the fraction of damage that bypasses shield pools and
// hits structure directly — the desperation strike's bunker-buster edge.
function applyExplosion(state, ownerId, enemySide, gx, gy, blast, damage, pierce = 0) {
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
  // Snapshot shield pools + structure HP so the post-game breakdown can split
  // each blast into shield-absorbed vs structure vs core damage.
  const shieldBefore = new Map(shields.map(s => [s.id, s.shieldHp ?? 0]));
  const structBefore = new Map(buildings.map(b => [b.id, b.type === 'core' ? (b.coreHp ?? 0) : (b.hp ?? 0)]));
  for (const b of buildings) {
    const d = cellDist(b.gx, b.gy, gx, gy);
    if (d > blast) continue;
    hitAny = true;
    // falloff: center full, edge 60%
    const falloff = blast === 0 ? 1 : 1 - (d / (blast + 1)) * 0.4;
    let dmg = damage * falloff;
    // Piercing damage skips every pool and lands on structure directly.
    const direct = dmg * Math.max(0, Math.min(1, pierce));
    dmg -= direct;
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
    dmg += direct;
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
  // Destroyed buildings leave rubble the owner can instantly rebuild
  // (same type, level 1, half cost) or build over with something else.
  if (!state.rubble) state.rubble = {};
  for (const id of destroyed) {
    const victim = state.buildings[id];
    if (!victim || victim.type === 'core') continue;
    delete state.buildings[id];
    const rid = uid('r');
    state.rubble[rid] = {
      id: rid, side: victim.side, gx: victim.gx, gy: victim.gy,
      ownerId: victim.ownerId, type: victim.type, launcherType: victim.launcherType,
      createdAt: Date.now(),
    };
  }
  // Empty covered tile: the shield still intercepts the blast. Same rule as a
  // real hit — fullest pool first, overflow spilling into the next-fullest.
  // (Piercing damage has no structure to hit on an empty tile, so it fizzles.)
  if (!hitAny) {
    const guards = shields
      .filter(s => cellDist(s.gx, s.gy, gx, gy) <= rangeOf(s))
      .sort((a, c) => pctLeft(c) - pctLeft(a));
    absorbThrough(guards, damage * (1 - Math.max(0, Math.min(1, pierce))));
  }
  try {
    ensureAllStats(state);
    let absorbed = 0;
    for (const s of shields) {
      const before = shieldBefore.get(s.id) ?? 0;
      absorbed += Math.max(0, before - (s.shieldHp ?? 0));
    }
    let struct = 0;
    let core = 0;
    for (const b of buildings) {
      const before = structBefore.get(b.id) ?? 0;
      const after = b.type === 'core' ? (b.coreHp ?? 0) : (b.hp ?? (state.buildings[b.id]?.hp ?? 0));
      const dealt = Math.max(0, before - after);
      if (dealt <= 0) continue;
      if (b.type === 'core') core += dealt;
      else struct += dealt;
    }
    const atk = ensureStats(state, ownerId);
    atk.shieldAbsorbedByEnemy += absorbed;
    atk.structureDamage += struct;
    atk.coreDamage += core;
    atk.damageDealt += struct + core;
    // Defensive credit: absorbed damage belongs to whoever owns the shields.
    // In 1v1 every shield on the enemy side shares one owner, but attribute
    // per-shield so future modes stay correct.
    const blockedByOwner = new Map();
    for (const s of shields) {
      const before = shieldBefore.get(s.id) ?? 0;
      const lost = Math.max(0, before - (s.shieldHp ?? 0));
      if (lost > 0) blockedByOwner.set(s.ownerId, (blockedByOwner.get(s.ownerId) ?? 0) + lost);
    }
    for (const [pid, amt] of blockedByOwner) ensureStats(state, pid).shieldBlocked += amt;
    // Kills / losses for destroyed non-core buildings.
    for (const id of destroyed) {
      const victim = buildings.find(b => b.id === id);
      const victimId = victim?.ownerId ?? state.sides?.[enemySide];
      if (victim && victim.type !== 'core') {
        atk.buildingsDestroyed += 1;
        if (victimId) ensureStats(state, victimId).buildingsLost += 1;
      }
    }
  } catch { /* stats optional */ }
  return destroyed;
}

// Fog of war constants
const FOG_REVEAL_RADIUS = 1; // Manhattan distance around impact
const FOG_TEMPORARY_DURATION = 5000; // 5 seconds in ms

// Idempotently re-assert core visibility. Mostly redundant now that state
// creation seeds it, but it also heals a state that lost its core entry.
function initFogOfWar(state) {
  if (!state.fogOfWar) return;
  const [p1, p2] = [state.sides.top, state.sides.bottom];
  for (const core of [state.buildings.core_top, state.buildings.core_bottom]) {
    if (!core) continue;
    const key = `${core.gx},${core.gy}`;
    if (state.exploredTiles[p1][key] === undefined) state.exploredTiles[p1][key] = 0;
    if (state.exploredTiles[p2][key] === undefined) state.exploredTiles[p2][key] = 0;
  }
}

// Per-player broadcast view. Fog of war used to be client-side only: the
// server sent BOTH islands' full buildings/pending maps to everyone, so any
// modified client could see the whole enemy island. This redacts to what the
// viewer may know — own everything, enemy cores (permanently revealed, see
// above), enemy buildings/pending only on live tiles. Deliberately KEPT
// visible: enemy missiles in flight (incoming ordnance must stay reactable),
// resources (HUD totals), supply ship (neutral), desperation flags (enemy
// core HP is public via the permanently revealed core anyway).
export function filterMissileStateForPlayer(state, forPlayerId, now = Date.now()) {
  if (!state || !state.fogOfWar || !forPlayerId || !state.exploredTiles) return state;
  const mine = state.exploredTiles[forPlayerId] ?? {};
  const live = (gx, gy) => {
    const v = mine[`${gx},${gy}`];
    return v === 0 || (typeof v === 'number' && v > now);
  };
  const buildings = {};
  for (const [id, b] of Object.entries(state.buildings)) {
    if (b.ownerId === forPlayerId || b.type === 'core' || live(b.gx, b.gy)) buildings[id] = b;
  }
  const pending = {};
  for (const [id, p] of Object.entries(state.pending || {})) {
    if (p.ownerId === forPlayerId || live(p.gx, p.gy)) pending[id] = p;
  }
  // Rubble follows the pending rule: always yours, enemy's only on live
  // tiles (a marker would otherwise scout enemy losses through the fog).
  const rubble = {};
  for (const [id, r] of Object.entries(state.rubble || {})) {
    if (r.ownerId === forPlayerId || live(r.gx, r.gy)) rubble[id] = r;
  }
  const stats = (state.winnerId || state.winReason)
    ? state.stats
    : { [forPlayerId]: state.stats?.[forPlayerId] };
  const over = !!(state.winnerId || state.winReason);
  // Income history would leak the enemy economy through fog mid-game —
  // the score screen gets it, live play does not.
  const incomeHistory = over ? state.incomeHistory : undefined;
  const keepFire = state.keepFire
    ? { [forPlayerId]: state.keepFire[forPlayerId] ?? null }
    : state.keepFire;
  return {
    ...state,
    buildings,
    pending,
    rubble,
    stats,
    keepFire,
    incomeHistory,
    exploredTiles: { [forPlayerId]: mine },
  };
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
      const existing = state.exploredTiles[ownerId][key];
      if (existing === 0) continue; // permanent core reveal — never overwrite
      if (existing === undefined || existing < expiresAt) {
        state.exploredTiles[ownerId][key] = expiresAt;
      }
    }
  }
}

// Expire temporary fog revelations. With history ON the tile that goes dark
// is REMEMBERED (-1): the player keeps a dimmed last-known view of it.
// With history OFF (default) it is forgotten outright — no buildings linger.
function expireFog(state, now) {
  if (!state.fogOfWar) return;
  const remember = state.fogHistory === true;
  for (const tiles of Object.values(state.exploredTiles)) {
    for (const [key, expiresAt] of Object.entries(tiles)) {
      if (expiresAt > 0 && expiresAt <= now) {
        if (remember) tiles[key] = -1;
        else delete tiles[key];
      }
    }
  }
}

// Advance simulation by dt seconds. Returns events for logging.
export function tickMissileCommand(state, now = Date.now()) {
  if (!state || state.winnerId || state.gameEndTime) return { events: [] };
  const events = [];
  const last = state.lastEconomyTick || now;
  const dt = Math.max(0, Math.min(5, (now - last) / 1000));
  state.lastEconomyTick = now;

  // Initialize fog of war on first tick (cores permanently visible)
  initFogOfWar(state);

  // Expire temporary fog revelations
  expireFog(state, now);

  // 0d. Supply freighter schedule: sail one crossing, then go dark until
  // the next sailing. Unclaimed ships simply sail away.
  if (state.supplyShipEnabled && !state.winnerId) {
    const scfg = MISSILE_CONFIG.supplyShip;
    if (!state.supplyShip && now >= (state.nextShipAt ?? 0)) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      state.supplyShip = {
        id: uid('sh'),
        dir,
        fromX: dir > 0 ? -0.12 : 1.12,
        toX: dir > 0 ? 1.12 : -0.12,
        y: scfg.channelY ?? 0.5,
        startAt: now,
        endAt: now + (scfg.crossMs ?? 18000),
      };
      events.push({ type: 'supply-sailed', id: state.supplyShip.id });
    } else if (state.supplyShip && now >= state.supplyShip.endAt) {
      state.supplyShip = null;
      state.nextShipAt = now + scfg.intervalMs + Math.random() * (scfg.jitterMs ?? 0);
    }
  }

  // 0. Construction & upgrades completing now (each runs its own timer)
  if (state.pending) {
    for (const [pid, p] of Object.entries(state.pending)) {
      if (p.completeAt > now) continue;
      delete state.pending[pid];
      if (p.kind === 'build') {
        if (!occupiedCell(state, p.side, p.gx, p.gy)) {
          const b = materializeBuilding(state, p);
          events.push({ type: 'built', id: b.id });
        } else {
          // Cell was taken while building — refund the upfront payment
          // instead of eating it silently.
          state.resources[p.ownerId] = (state.resources[p.ownerId] ?? 0) + (p.cost ?? 0);
          events.push({ type: 'build-failed', id: p.id });
        }
      } else if (p.kind === 'upgrade') {
        const b = state.buildings[p.upgradeOf];
        // Only apply if the building survived and is still the expected level
        if (b && b.type !== 'core' && b.level === p.targetLevel - 1) {
          applyLevelUp(state, b);
          events.push({ type: 'upgraded', id: b.id, level: b.level });
        } else {
          // Building died mid-upgrade — refund the upfront payment.
          state.resources[p.ownerId] = (state.resources[p.ownerId] ?? 0) + (p.cost ?? 0);
          events.push({ type: 'upgrade-failed', id: p.upgradeOf });
        }
      } else if (p.kind === 'sell') {
        const b = state.buildings[p.sellOf];
        // Only pays if the building survived to demolition (destroyed
        // buildings fizzle the sale with no refund) and is still the
        // seller's non-core building.
        if (b && b.ownerId === p.ownerId && b.type !== 'core') {
          delete state.buildings[p.sellOf];
          state.resources[p.ownerId] = (state.resources[p.ownerId] ?? 0) + (p.refund ?? 0);
          events.push({ type: 'sold', id: p.sellOf, refund: p.refund ?? 0 });
          try { ensureStats(state, p.ownerId).buildingsSold += 1; } catch { /* stats optional */ }
        }
      }
    }
  }

  // 0b. Missile builds finishing now (one at a time per launcher), then
  // auto-load kicks off the next one wherever stock isn't full and the
  // owner can afford it. Always on — no toggle.
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
    if (b.type !== 'launcher') continue;
    if ((b.loadingUntil ?? 0) > now) continue;
    if ((b.stock ?? 0) >= (b.maxStock ?? MISSILE_CONFIG.maxStock)) continue;
    if ((state.resources[b.ownerId] ?? 0) < (b.missileCost || 0)) continue;
    state.resources[b.ownerId] -= b.missileCost;
    b.loadingUntil = now + (MISSILE_CONFIG.loadMs ?? 5000) / surgeRate(state, b.ownerId, now);
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
    const gain = (b.incomePerSec ?? 0) * dt;
    state.resources[b.ownerId] = (state.resources[b.ownerId] ?? 0) + gain;
    try { ensureStats(state, b.ownerId).incomeEconomy += gain; } catch { /* stats optional */ }
  }
  const coreIncome = state.coreIncomePerSec ?? MISSILE_CONFIG.coreIncomePerSec;
  for (const b of Object.values(state.buildings)) {
    if (b.type !== 'core') continue;
    if ((b.coreHp ?? 0) <= 0) continue;
    const gain = coreIncome * dt;
    state.resources[b.ownerId] = (state.resources[b.ownerId] ?? 0) + gain;
    try { ensureStats(state, b.ownerId).incomeCore += gain; } catch { /* stats optional */ }
  }
  // 1b. Income-rate samples for the post-game chart (~2s cadence, capped).
  // Rates (not totals) so the chart shows economic momentum over time.
  if (!state.incomeHistory) state.incomeHistory = { samples: [], lastSampleAt: 0 };
  if (now - (state.incomeHistory.lastSampleAt ?? 0) >= 2000) {
    state.incomeHistory.lastSampleAt = now;
    const r1 = (n) => Math.round(n * 10) / 10;
    state.incomeHistory.samples.push([
      Math.max(0, Math.round(((now - (state.gameStartTime ?? now)) / 1000) * 10) / 10),
      r1(missileIncomePerSec(state, state.sides?.top)),
      r1(missileIncomePerSec(state, state.sides?.bottom)),
    ]);
    if (state.incomeHistory.samples.length > 900) {
      state.incomeHistory.samples.splice(0, state.incomeHistory.samples.length - 900);
    }
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
      const before = best.shieldHp ?? 0;
      best.shieldHp = Math.min(best.maxShieldHp, before + (h.healPerSec ?? 0) * dt);
      h.healTargetId = best.id;
      try { ensureStats(state, h.ownerId).shieldHealed += Math.max(0, best.shieldHp - before); } catch { /* stats optional */ }
    } else {
      h.healTargetId = null;
    }
  }
  for (const s of shields) {
    const selfRate = (MISSILE_CONFIG.healer.healPerSec[Math.max(1, Math.min(5, s.level))] ?? 0) / 8;
    const before = s.shieldHp ?? 0;
    s.shieldHp = Math.min(s.maxShieldHp, before + selfRate * dt);
    try { ensureStats(state, s.ownerId).shieldHealed += Math.max(0, s.shieldHp - before); } catch { /* stats optional */ }
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
      const destroyed = applyExplosion(state, m.ownerId, enemySide, m.targetGx, m.targetGy, m.blast, m.damage, m.pierce ?? 0);
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

  // 4b. Desperation unlocks: a living core at or under 50% HP arms its
  // owner's one-time strike. Latches — healing back above keeps it.
  if (state.desperation) {
    const threshold = MISSILE_CONFIG.desperation.thresholdPct ?? 0.5;
    for (const b of Object.values(state.buildings)) {
      if (b.type !== 'core' || (b.coreHp ?? 1) <= 0) continue;
      if (b.coreHp <= (b.maxCoreHp ?? 1) * threshold) {
        const flag = state.desperation[b.ownerId];
        if (flag && !flag.unlocked) {
          flag.unlocked = true;
          events.push({ type: 'desperation-unlocked', ownerId: b.ownerId });
        }
      }
    }
  }

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
      state.gameEndTime = now;
      state.keepFire = {};
      events.push({ type: 'core_destroyed', side: deadSide, winnerId: state.winnerId });
    } else {
      // Simultaneous destruction — neither side wins. Ends the game as a
      // draw so the tick doesn't run forever on two dead cores.
      state.winnerId = null;
      state.winReason = 'draw';
      state.gameEndTime = now;
      state.keepFire = {};
      events.push({ type: 'draw' });
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
