// missileCommand/config.ts — SILO'D client config for Missile Command.
// Mirror of server tuning for display purposes. Remove this folder to remove the game.

import type { MissileBuildingType, MissileLauncherType } from '../../types/game';

export const WORLD = 1000;
// Island rects in world coords (must match server cellToWorld)
export const TOP_RECT = { x: 10, y: 10, w: 980, h: 410 };
export const BOTTOM_RECT = { x: 10, y: 580, w: 980, h: 410 };
export const WATER_Y = 500;

export function cellRect(side: 'top' | 'bottom', gx: number, gy: number, cols: number, rows: number) {
  const r = side === 'top' ? TOP_RECT : BOTTOM_RECT;
  const cw = r.w / cols;
  const ch = r.h / rows;
  return { x: r.x + gx * cw, y: r.y + gy * ch, w: cw, h: ch, cx: r.x + (gx + 0.5) * cw, cy: r.y + (gy + 0.5) * ch };
}

export interface BuildOption {
  key: string;
  label: string;
  emoji: string;
  cost: number;
  desc: string;
  buildingType: MissileBuildingType;
  launcherType?: MissileLauncherType;
}

export const BUILD_OPTIONS: BuildOption[] = [
  { key: 'economy', label: 'Generator', emoji: '💰', cost: 50, desc: '+2 credits/s at Lv1 (up to +20/s at Lv5). Upgrades snowball your economy.', buildingType: 'economy' },
  { key: 'shield', label: 'Shield Gen', emoji: '🛡️', cost: 40, desc: '300 shield HP at Lv1 (up to 2000). Aura ≈ 25 squares, fully blocks blasts while charged. Slowly self-repairs.', buildingType: 'shield' },
  { key: 'healer', label: 'Shield Healer', emoji: '💚', cost: 45, desc: 'Repairs 8 shield HP/s at Lv1 (up to 65/s). Heals ONE shield at a time — the weakest in its ≈ 13-square aura.', buildingType: 'healer' },
  { key: 'launcher_single', label: 'Single', emoji: '🎯', cost: 120, desc: '120 dmg for 30cr/missile. Stockpile up to 3, fire the volley at 1 square.', buildingType: 'launcher', launcherType: 'single' },
  { key: 'launcher_scatter', label: 'Scatter', emoji: '💥', cost: 150, desc: '5 × 35 dmg (175 total!) for 45cr/missile. Highest total damage — best shield-breaker.', buildingType: 'launcher', launcherType: 'scatter' },
];

// Coverage cell counts for Manhattan ranges (1 + 4 + 8 + ... + 4*range)
export const SHIELD_COVER_CELLS = 25; // range 3
export const HEALER_COVER_CELLS = 13; // range 2
export const CORE_INCOME_FALLBACK = 5;
export const MAX_STOCK = 3;

// Build durations (seconds) by target level — mirrors server buildMs.
export const BUILD_SECONDS: Record<number, number> = { 1: 3, 2: 5, 3: 10, 4: 20, 5: 30 };
// Missile build time (seconds) — mirrors server loadMs.
export const LOAD_SECONDS = 5;

// Level tables for display (mirror server/missileCommand.js)
export const STATS = {
  economy: { income: [0, 2, 5, 9, 14, 20], upgrade: [0, 60, 120, 220, 350, 0] },
  shield: { hp: [0, 300, 600, 1000, 1500, 2000], upgrade: [0, 50, 100, 180, 280, 0] },
  healer: { heal: [0, 8, 16, 28, 44, 65], upgrade: [0, 55, 110, 190, 290, 0] },
  single: { cost: [0, 30, 45, 65, 90, 120], dmg: [0, 120, 200, 300, 420, 560], cd: [0, 4, 3.8, 3.5, 3.2, 2.8] },
  scatter: { cost: [0, 45, 65, 90, 120, 155], dmg: [0, 35, 55, 80, 110, 145], cd: [0, 6, 5.7, 5.4, 5, 4.6] },
};

export function launcherUpgradeCost(buildCost: number, level: number): number {
  return Math.round(buildCost * (0.7 + level * 0.5));
}

export function upgradeCostFor(b: { type: MissileBuildingType; level: number; launcherType?: MissileLauncherType }): number | null {
  if (b.level >= 5) return null;
  if (b.type === 'launcher') {
    const base = BUILD_OPTIONS.find(o => o.launcherType === b.launcherType)?.cost ?? 150;
    return launcherUpgradeCost(base, b.level);
  }
  // upgrade table indexed by current level: cost to go level -> level+1
  if (b.type === 'economy') return STATS.economy.upgrade[b.level];
  if (b.type === 'shield') return STATS.shield.upgrade[b.level];
  if (b.type === 'healer') return STATS.healer.upgrade[b.level];
  return null;
}

export const BUILDING_META: Record<string, { emoji: string; name: string; color: string }> = {
  economy: { emoji: '💰', name: 'Generator', color: '#fbbf24' },
  shield: { emoji: '🛡️', name: 'Shield Gen', color: '#38bdf8' },
  healer: { emoji: '💚', name: 'Shield Healer', color: '#4ade80' },
  launcher: { emoji: '🚀', name: 'Launcher', color: '#fb7185' },
  core: { emoji: '⭐', name: 'Core', color: '#a78bfa' },
};
