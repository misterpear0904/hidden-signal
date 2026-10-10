// missileCommand.js — SILO'D module for Missile Command (Island War) game.
// All Missile Command tuning + state logic lives here. gameManager.js only
// delegates to these functions so the game can be removed cleanly.
//
// GRID MODEL: each island is a GRID_COLS x GRID_ROWS grid. Every building
// occupies exactly 1x1 cell. Shields cover a square of cells (Chebyshev
// distance <= shieldTiles), so coverage is obvious on the grid.

export const MISSILE_CONFIG = {
  startingResources: 200,
  economyTickMs: 500,
  maxLevel: 5,
  maxBuildingsPerPlayer: 40,
  // Grid per island (odd columns so the core sits in the very middle)
  gridCols: 13,
  gridRows: 7,
  // Manhattan ranges (no diagonals): shield aura covers 13 squares, healer 5
  shieldTiles: 2, // |dx|+|dy| <= 2 → 13-square aura
  healerTiles: 1, // |dx|+|dy| <= 1 → 5-square (plus) aura
  // Missile stockpiling per launcher
  maxStock: 3,
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
    economy: { build: 50, upgrade: [0, 60, 120, 220, 350, 0] },
    shield: { build: 40, upgrade: [0, 50, 100, 180, 280, 0] },
    healer: { build: 45, upgrade: [0, 55, 110, 190, 290, 0] },
    launcher_single: { build: 120 },
    launcher_scatter: { build: 150 },
    launcher_cluster: { build: 170 },
  },
  economy: {
    // income per sec by level 1..5 — snowballs hard
    income: [0, 2, 5, 9, 14, 20],
    hp: [0, 100, 150, 210, 280, 360],
  },
  shield: {
    hp: [0, 150, 300, 500, 750, 1000],
    buildingHp: [0, 120, 180, 250, 330, 420],
  },
  healer: {
    healPerSec: [0, 8, 16, 28, 44, 65],
    hp: [0, 100, 150, 210, 280, 360],
  },
  launchers: {
    single: {
      missileCost: [0, 30, 45, 65, 90, 120],
      damage: [0, 120, 200, 300, 420, 560],
      blast: 0, // tiles (Chebyshev) — hits the single target cell
      cooldownMs: [0, 4000, 3800, 3500, 3200, 2800],
      speed: 0.55, // normalized units/sec
      hp: [0, 120, 180, 250, 330, 420],
    },
    scatter: {
      missileCost: [0, 45, 65, 90, 120, 155],
      // per-pellet damage, 5 pellets each hitting 1 cell
      damage: [0, 35, 55, 80, 110, 145],
      pellets: 5,
      blast: 0,
      cooldownMs: [0, 6000, 5700, 5400, 5000, 4600],
      speed: 0.5,
      hp: [0, 120, 180, 250, 330, 420],
    },
    cluster: {
      missileCost: [0, 60, 85, 115, 150, 190],
      // total damage split across 4 sub-munitions, each blasts 3x3
      damage: [0, 180, 280, 400, 540, 700],
      submunitions: 4,
      blast: 1,
      cooldownMs: [0, 8000, 7600, 7200, 6700, 6200],
      speed: 0.42,
      hp: [0, 130, 190, 260, 340, 430],
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

function baseStatsFor(type, launcherType, level) {
  const L = Math.max(1, Math.min(5, level));
  if (type === 'economy') return { incomePerSec: MISSILE_CONFIG.economy.income[L], hp: MISSILE_CONFIG.economy.hp[L] };
  if (type === 'shield') return { maxShieldHp: MISSILE_CONFIG.shield.hp[L], hp: MISSILE_CONFIG.shield.buildingHp[L] };
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

  return {
    sides: { top: p1, bottom: p2 },
    gridCols: MISSILE_CONFIG.gridCols,
    gridRows: MISSILE_CONFIG.gridRows,
    shieldTiles: MISSILE_CONFIG.shieldTiles,
    healerTiles: MISSILE_CONFIG.healerTiles,
    coreIncomePerSec: MISSILE_CONFIG.coreIncomePerSec,
    buildings,
    missiles: [],
    resources,
    gameStartTime: now,
    lastEconomyTick: now,
    winnerId: null,
    winReason: null,
  };
}

function buildingCountFor(state, playerId) {
  return Object.values(state.buildings).filter(b => b.ownerId === playerId && b.type !== 'core').length;
}

function buildCostFor(buildingType, launcherType) {
  if (buildingType === 'launcher') return MISSILE_CONFIG.costs[`launcher_${launcherType}`]?.build ?? 150;
  return MISSILE_CONFIG.costs[buildingType]?.build ?? 50;
}

function occupiedCell(state, side, gx, gy, ignoreId = null) {
  return Object.values(state.buildings).some(b => b.side === side && b.gx === gx && b.gy === gy && b.id !== ignoreId);
}

export function missileBuildBuilding(state, playerId, action) {
  const side = missileSideForPlayer(state, playerId);
  if (!side) return { error: 'You are not in this match' };
  if (state.winnerId) return { error: 'Game is over' };
  const { buildingType, launcherType, gx, gy } = action || {};
  if (!['economy', 'shield', 'healer', 'launcher'].includes(buildingType)) return { error: 'Invalid building type' };
  if (buildingType === 'launcher' && !['single', 'scatter', 'cluster'].includes(launcherType)) {
    return { error: 'Pick a launcher type: single, scatter or cluster' };
  }
  if (!isValidCell(gx, gy)) return { error: 'Invalid grid square' };
  if (occupiedCell(state, side, gx, gy)) return { error: 'Square occupied — pick an empty square' };
  if (buildingCountFor(state, playerId) >= MISSILE_CONFIG.maxBuildingsPerPlayer) {
    return { error: 'Building cap reached' };
  }
  const cost = buildCostFor(buildingType, launcherType);
  if ((state.resources[playerId] ?? 0) < cost) return { error: `Need ${cost} credits` };

  state.resources[playerId] -= cost;
  const id = uid('b');
  const stats = baseStatsFor(buildingType, launcherType, 1);
  const b = { id, type: buildingType, side, gx, gy, level: 1, ownerId: playerId, hp: stats.hp ?? MISSILE_CONFIG.buildingHpFallback, maxHp: stats.hp ?? MISSILE_CONFIG.buildingHpFallback };
  if (buildingType === 'economy') b.incomePerSec = stats.incomePerSec;
  if (buildingType === 'shield') { b.shieldHp = stats.maxShieldHp; b.maxShieldHp = stats.maxShieldHp; }
  if (buildingType === 'healer') { b.healPerSec = stats.healPerSec; }
  if (buildingType === 'launcher') {
    b.launcherType = launcherType;
    b.missileCost = stats.missileCost;
    b.missileDamage = stats.missileDamage;
    b.blast = stats.blast;
    b.missileSpeed = stats.missileSpeed;
    b.cooldownMs = stats.cooldownMs;
    b.lastFiredAt = 0;
    b.stock = 0;
    b.maxStock = MISSILE_CONFIG.maxStock;
  }
  state.buildings[id] = b;
  return { building: b };
}

function upgradeCostFor(b) {
  if (b.level >= MISSILE_CONFIG.maxLevel) return null;
  if (b.type === 'launcher') {
    // launcher upgrade ~ 80% of build cost * level
    const base = buildCostFor('launcher', b.launcherType);
    return Math.round(base * (0.7 + b.level * 0.5));
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
  const cost = upgradeCostFor(b);
  if ((state.resources[playerId] ?? 0) < cost) return { error: `Need ${cost} credits to upgrade` };
  state.resources[playerId] -= cost;
  b.level += 1;
  const stats = baseStatsFor(b.type, b.launcherType, b.level);
  b.maxHp = stats.hp ?? b.maxHp;
  b.hp = Math.min(b.maxHp, (b.hp ?? b.maxHp) + Math.round(b.maxHp * 0.4)); // heal chunk on upgrade
  if (b.type === 'economy') b.incomePerSec = stats.incomePerSec;
  if (b.type === 'shield') {
    const prevMax = b.maxShieldHp;
    b.maxShieldHp = stats.maxShieldHp;
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
  return { building: b };
}

// Build one full shot pattern (single missile / scatter pellets / cluster bus).
// Does NOT push to state or stagger — used by missileLaunch per banked shot.
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
    speed: launcher.missileSpeed || 0.5,
    createdAt: now,
    deployAt: now,
  });

  if (launcher.launcherType === 'single') {
    return [mk(targetGx, targetGy, to.x, to.y, launcher.missileDamage, launcher.blast)];
  }
  if (launcher.launcherType === 'scatter') {
    // 5 pellets: target + orthogonal neighbors (off-island neighbors are wasted)
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
  // cluster: bus flies to target, then sub-munitions hit neighboring cells
  const m = mk(targetGx, targetGy, to.x, to.y, launcher.missileDamage, launcher.blast);
  const per = m.damage / MISSILE_CONFIG.launchers.cluster.submunitions;
  const spread = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]];
  const subs = [];
  for (const [dx, dy] of spread) {
    if (subs.length >= MISSILE_CONFIG.launchers.cluster.submunitions) break;
    const gx = targetGx + dx, gy = targetGy + dy;
    if (!isValidCell(gx, gy)) continue;
    const w = cellToWorld(enemySide, gx, gy);
    subs.push({ gx, gy, x: w.x, y: w.y, damage: per });
  }
  m.subMissiles = subs;
  return [m];
}

// Pay to load one missile into a launcher's stockpile (max 3). Loading takes
// the launcher's reload — firing happens separately via missileLaunch.
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
  if (now - (launcher.lastFiredAt || 0) < (launcher.cooldownMs || 4000)) {
    const wait = Math.ceil(((launcher.cooldownMs || 4000) - (now - (launcher.lastFiredAt || 0))) / 1000);
    return { error: `Reloading… ${wait}s` };
  }
  if ((state.resources[playerId] ?? 0) < (launcher.missileCost || 0)) {
    return { error: `Need ${launcher.missileCost} credits to build a missile` };
  }
  state.resources[playerId] -= launcher.missileCost;
  launcher.stock = (launcher.stock ?? 0) + 1;
  launcher.lastFiredAt = now;
  return { building: launcher };
}

// Fire EVERYTHING stockpiled in a launcher as one volley. Banked shots deploy
// 300ms apart so they strike in quick succession. Stock is fully consumed.
export function missileLaunch(state, playerId, action) {
  if (state.winnerId) return { error: 'Game is over' };
  const side = missileSideForPlayer(state, playerId);
  if (!side) return { error: 'You are not in this match' };
  const { launcherId, targetGx, targetGy } = action || {};
  const launcher = state.buildings[launcherId];
  if (!launcher || launcher.type !== 'launcher') return { error: 'Launcher not found' };
  if (launcher.ownerId !== playerId) return { error: 'Not your launcher' };
  if (!isValidCell(targetGx, targetGy)) return { error: 'Invalid target square' };
  const stock = launcher.stock ?? 0;
  if (stock <= 0) return { error: 'No missiles stockpiled — build some first' };
  const now = Date.now();
  launcher.stock = 0;
  launcher.lastFiredAt = now;

  const enemySide = side === 'top' ? 'bottom' : 'top';
  const added = [];
  for (let i = 0; i < stock; i++) {
    const pattern = buildShotPattern(state, launcher, side, enemySide, targetGx, targetGy, now);
    for (const m of pattern) m.deployAt = now + i * 300;
    added.push(...pattern);
  }
  state.missiles.push(...added);
  return { missiles: added };
}

// Apply explosion damage centered on an enemy grid cell with Manhattan radius.
function applyExplosion(state, ownerId, enemySide, gx, gy, blast, damage) {
  const buildings = Object.values(state.buildings).filter(b => b.side === enemySide);
  const shields = buildings.filter(b => b.type === 'shield' && (b.shieldHp ?? 0) > 0);
  const shieldTiles = state.shieldTiles ?? MISSILE_CONFIG.shieldTiles;

  const coveringShield = (b) => {
    let best = null;
    let bestD = Infinity;
    for (const s of shields) {
      const d = cellDist(s.gx, s.gy, b.gx, b.gy);
      if (d <= shieldTiles && d < bestD) { best = s; bestD = d; }
    }
    return best;
  };

  const destroyed = [];
  for (const b of buildings) {
    const d = cellDist(b.gx, b.gy, gx, gy);
    if (d > blast) continue;
    // falloff: center full, edge 60%
    const falloff = blast === 0 ? 1 : 1 - (d / (blast + 1)) * 0.4;
    let dmg = damage * falloff;
    const shield = coveringShield(b);
    if (shield && b.type !== 'shield') {
      // Full block while the pool lasts: damage eats the shield pool first,
      // only overflow reaches the building. No bleed-through.
      const pool = shield.shieldHp ?? 0;
      if (pool >= dmg) { shield.shieldHp = pool - dmg; dmg = 0; }
      else { shield.shieldHp = 0; dmg = dmg - pool; }
    } else if (b.type === 'shield') {
      // direct hits damage shield pool first, then structure
      const pool = b.shieldHp ?? 0;
      if (pool >= dmg) { b.shieldHp = pool - dmg; dmg = 0; }
      else { b.shieldHp = 0; dmg = dmg - pool; }
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
  return destroyed;
}

// Advance simulation by dt seconds. Returns events for logging.
export function tickMissileCommand(state, now = Date.now()) {
  if (!state || state.winnerId) return { events: [] };
  const events = [];
  const last = state.lastEconomyTick || now;
  const dt = Math.max(0, Math.min(5, (now - last) / 1000));
  state.lastEconomyTick = now;

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
  const shields = Object.values(state.buildings).filter(b => b.type === 'shield');
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
      if (m.launcherType === 'cluster' && m.subMissiles?.length) {
        for (const s of m.subMissiles) {
          const destroyed = applyExplosion(state, m.ownerId, enemySide, s.gx, s.gy, m.blast, s.damage);
          if (destroyed.length) events.push({ type: 'destroyed', ids: destroyed });
        }
        events.push({ type: 'impact', gx: m.targetGx, gy: m.targetGy, kind: 'cluster' });
      } else {
        const destroyed = applyExplosion(state, m.ownerId, enemySide, m.targetGx, m.targetGy, m.blast, m.damage);
        if (destroyed.length) events.push({ type: 'destroyed', ids: destroyed });
        events.push({ type: 'impact', gx: m.targetGx, gy: m.targetGy, kind: m.launcherType });
      }
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
