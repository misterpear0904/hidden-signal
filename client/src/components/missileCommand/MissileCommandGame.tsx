// missileCommand/MissileCommandGame.tsx — SILO'D UI for Missile Command.
// Full-screen grid map with pan/zoom + touch support. Remove this folder to remove the game.
//
// Interaction model:
// - Tap an empty square on YOUR island → build popup with all options.
// - Tap any building → dialog with its stats + upgrade (own) / load / fire.
// - FIRE (volley) or ALL-type → targeting banner → tap an enemy square.

import { memo, useEffect, useRef, useState, useMemo } from 'react';
import type {
  RoomState,
  MissileBuilding,
  MissileInFlight,
  MissileLauncherType,
  MissileBuildAction,
  MissileLaunchAction,
  MissileTypeLaunchAction,
  MissileLoadAction,
  MissileKeepFireAction,
  MissileDesperationAction,
} from '../../types/game';
import { WORLD, TOP_RECT, BOTTOM_RECT, cellRect, BUILD_OPTIONS, BUILD_CATEGORIES, STATS, BUILDING_META, upgradeCostFor, sellRefundFor, SELL_SECONDS, SHIELD_COVER_CELLS, SHIELD_HEAVY_COVER_CELLS, HEALER_COVER_CELLS, CORE_INCOME_FALLBACK, MAX_STOCK, BUILD_SECONDS, LOAD_SECONDS } from './config';
import { visionOfTile, canSeeEnemyAtTile } from './fog';
import MissileCommandStats from './MissileCommandStats';
import { BUILD_ID } from '../../buildInfo';

interface Props {
  roomState: RoomState;
  myId: string;
  isHost: boolean;
  onBuild: (action: MissileBuildAction) => void;
  onUpgrade: (buildingId: string) => void;
  onSell: (buildingId: string) => void;
  onCancelSell: (buildingId: string) => void;
  onLoad: (action: MissileLoadAction) => void;
  onToggleAutobuild: (launcherId: string) => void;
  onToggleAllAutobuild: (enabled: boolean) => void;
  onLaunch: (action: MissileLaunchAction) => void;
  onLaunchType: (action: MissileTypeLaunchAction) => void;
  onSetKeepFire: (action: MissileKeepFireAction) => void;
  onFireDesperation: (action: MissileDesperationAction) => void;
  onClaimSupplyShip: () => void;
  onPlayAgain: () => void;
}

interface Cell { side: 'top' | 'bottom'; gx: number; gy: number; }
interface Flash { id: number; x: number; y: number; kind: string; expires: number; }

// A grid cell position inside a coverage area. Named type because an inline
// object literal in a generic argument confuses the .tsx parser.
type CoverCell = { gx: number; gy: number };

let flashId = 0;

function worldToCell(wx: number, wy: number, cols: number, rows: number): Cell | null {
  for (const [side, r] of [['top', TOP_RECT], ['bottom', BOTTOM_RECT]] as const) {
    if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) {
      const gx = Math.max(0, Math.min(cols - 1, Math.floor(((wx - r.x) / r.w) * cols)));
      const gy = Math.max(0, Math.min(rows - 1, Math.floor(((wy - r.y) / r.h) * rows)));
      return { side, gx, gy };
    }
  }
  return null;
}

// Static island grid layer — memoized so the ~180 cells skip re-render on
// every animation/economy tick. Only re-renders when occupancy, selection,
// the build cursor, or dimensions actually change (via string signatures).
const IslandGrid = memo(function IslandGrid({ side, cols, rows, isMine, occSig, selKey, buildKey }: {
  side: 'top' | 'bottom';
  cols: number;
  rows: number;
  isMine: boolean;
  occSig: string; // "gx,gy|..." of occupied cells on this island
  selKey: string | null; // "gx,gy" of selected building cell (this island)
  buildKey: string | null; // "gx,gy" of pending build cursor (this island)
}) {
  const occ = new Set(occSig ? occSig.split('|') : []);
  return (
    <g>
      {Array.from({ length: rows }).map((_, gy) =>
        Array.from({ length: cols }).map((_, gx) => {
          const r = cellRect(side, gx, gy, cols, rows);
          const key = `${gx},${gy}`;
          const occupied = occ.has(key);
          const isBuildCell = buildKey === key;
          const isSel = selKey === key;
          return (
            <rect
              key={`${gx}-${gy}`}
              x={r.x + 1.5} y={r.y + 1.5} width={r.w - 3} height={r.h - 3} rx={8}
              fill={
                isBuildCell ? 'rgba(74,222,128,0.35)'
                : isSel ? 'rgba(255,255,255,0.28)'
                : isMine ? ((gx + gy) % 2 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)')
                : ((gx + gy) % 2 === 0 ? 'rgba(0,0,0,0.10)' : 'rgba(0,0,0,0.18)')
              }
              stroke={isBuildCell ? '#4ade80' : isSel ? '#fff' : 'rgba(255,255,255,0.14)'}
              strokeWidth={isBuildCell || isSel ? 3 : 1}
              strokeDasharray={(!occupied && isMine) ? '7 6' : undefined}
            />
          );
        })
      )}
    </g>
  );
});

// Exact union outline of the covered cells: walks every outer edge of the
// Manhattan diamond, so the marching boundary hugs covered tiles exactly.
function coverageOutlinePath(side: 'top' | 'bottom', cells: Array<{ gx: number; gy: number }>, cols: number, rows: number): string {
  const set = new Set(cells.map(c => `${c.gx},${c.gy}`));
  let d = '';
  for (const c of cells) {
    const r = cellRect(side, c.gx, c.gy, cols, rows);
    const x = r.x + 2, y = r.y + 2, w = r.w - 4, h = r.h - 4;
    if (!set.has(`${c.gx},${c.gy - 1}`)) d += `M ${x} ${y} L ${x + w} ${y} `;
    if (!set.has(`${c.gx + 1},${c.gy}`)) d += `M ${x + w} ${y} L ${x + w} ${y + h} `;
    if (!set.has(`${c.gx},${c.gy + 1}`)) d += `M ${x} ${y + h} L ${x + w} ${y + h} `;
    if (!set.has(`${c.gx - 1},${c.gy}`)) d += `M ${x} ${y} L ${x} ${y + h} `;
  }
  return d;
}

// Every cell covered by a Manhattan range — drawn per tile, never ambiguous.
function coveredCells(gx: number, gy: number, range: number, cols: number, rows: number): Array<{ gx: number; gy: number }> {
  const out: Array<{ gx: number; gy: number }> = [];
  for (let dx = -range; dx <= range; dx++) {
    for (let dy = -range; dy <= range; dy++) {
      if (Math.abs(dx) + Math.abs(dy) > range) continue;
      const cx = gx + dx, cy = gy + dy;
      if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) continue;
      out.push({ gx: cx, gy: cy });
    }
  }
  return out;
}

export default function MissileCommandGame({ roomState, myId, isHost, onBuild, onUpgrade, onSell, onCancelSell, onLoad, onToggleAutobuild, onToggleAllAutobuild, onLaunch, onLaunchType, onSetKeepFire, onFireDesperation, onClaimSupplyShip, onPlayAgain }: Props) {
  const mc = roomState.missileCommandState;
  const svgRef = useRef<SVGSVGElement>(null);

  const [targetLauncherId, setTargetLauncherId] = useState<string | null>(null);
  const [targetType, setTargetType] = useState<MissileLauncherType | null>(null);
  const [buildCell, setBuildCell] = useState<Cell | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: WORLD / 2, y: WORLD / 2 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  // "Armed" = next enemy-tile pick locks a keep-firing target instead of
  // firing a single volley. The lock itself lives in room state (server-owned).
  const [keepFireArmed, setKeepFireArmed] = useState(false);
  // Desperation targeting: true while picking the one-time strike's tile.
  const [targetDesperation, setTargetDesperation] = useState(false);
  const [dockVertical, setDockVertical] = useState(true);
  // Shield grid effects toggle (visual hex overlay on shield coverage)
  const [showShieldGrid, setShowShieldGrid] = useState(true);
  // Long-press for mobile build menu (tap selects, long-press opens build)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const LONG_PRESS_MS = 350; // ms to hold for build menu
  const fullscreenSupported = typeof document !== 'undefined' &&
    (document.fullscreenEnabled || (document as unknown as { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled);
  const [, setFrame] = useState(0);
  const [flashes, setFlashes] = useState<Flash[]>([]);
  // Motion sensitivity: kills CSS marching/beam flow (via media query below)
  // and gates the decorative SMIL nodes (particles, ripples, pulses).
  const reducedMotion = useMemo(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    []
  );
  // Slow clock for transient UI (fog expiry, countdowns, freighter): the rAF
  // frame loop below only ticks while missiles/flashes move, so without this
  // every countdown freezes whenever the sky is empty.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  // Long-press timer must not fire after unmount (stale setState on a dead
  // component when the game screen unmounts mid-press).
  useEffect(() => () => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
  }, []);
  // Last-seen supply claim (drives the claim toast below).
  const lastSupplySeenRef = useRef(0);
  const [supplyToast, setSupplyToast] = useState<string | null>(null);

  const gestureRef = useRef({
    // Per-pointer tracking: a stationary resting thumb must not cancel a
    // quick tap from another finger. A tap = this finger was quick + still
    // while every other active finger stayed still.
    pointers: new Map<number, { x: number; y: number; downX: number; downY: number; downT: number; moved: boolean; tol: number }>(),
    pinchDist: 0,
    pinchZoom: 1,
    // SVG client rect captured on the first move of a gesture. getBoundingClientRect
    // forces layout and this path runs ~60x/sec while panning, so it's read
    // once instead. Cleared when the last pointer lifts.
    rect: null as DOMRect | null,
  });
  // Mirrors flashes.length for the frame loop, so that loop can subscribe once
  // (a flashes.length dep would re-create the rAF chain on every flash).
  const flashesLenRef = useRef(0);
  // Set when a long-press has already handled a gesture, so the pointer-up
  // that follows must NOT also run tap logic (it would immediately close the
  // build menu the long-press just opened — the "flash then vanish" bug).
  const longPressFiredRef = useRef(false);
  const TAP_TOL = 12; // px total travel allowed for a touch tap
  const TAP_MAX_MS = 600;
  // Grid dims live up here (not after the loading guard below): coverCache
  // and the memo chain need them on every render, including mc==null
  // renders — the early return for missing state sits below ALL hooks.
  const cols = mc?.gridCols || 13;
  const rows = mc?.gridRows || 7;
  const prevMissilesRef = useRef<Map<string, MissileInFlight>>(new Map());
  const snapRef = useRef<{ missiles: MissileInFlight[]; at: number }>({ missiles: [], at: Date.now() });
  // Coverage is a pure function of (gx, gy, range, cols, rows) — but it's
  // recomputed 10x/sec in render before this existed. Cache keyed on the
  // inputs so only a moved/upgraded shield pays for it again.
  const coverCacheRef = useRef<Map<string, CoverCell[]>>(new Map());
  const coverCache = (gx: number, gy: number, range: number): CoverCell[] => {
    const key = `${gx},${gy},${range},${cols},${rows}`;
    let v = coverCacheRef.current.get(key);
    if (!v) {
      v = coveredCells(gx, gy, range, cols, rows);
      // Bound the cache so a long game can't grow it without limit.
      if (coverCacheRef.current.size > 512) coverCacheRef.current.clear();
      coverCacheRef.current.set(key, v);
    }
    return v;
  };

  // Keep the frame loop's liveness mirror current without re-subscribing it.
  flashesLenRef.current = flashes.length;

  // ── Missile impact flash detection ──
  useEffect(() => {
    if (!mc) return;
    const prev = prevMissilesRef.current;
    const now = new Map<string, MissileInFlight>();
    for (const m of mc.missiles) now.set(m.id, m);
    const cols = mc.gridCols, rows = mc.gridRows;
    const fresh: Flash[] = [];
    for (const [id, m] of prev) {
      if (!now.has(id)) {
        const ownerSide = mc.sides.top === m.ownerId ? 'top' : 'bottom';
        const enemySide = ownerSide === 'top' ? 'bottom' : 'top';
        const c = cellRect(enemySide, m.targetGx, m.targetGy, cols, rows);
        fresh.push({ id: ++flashId, x: c.cx, y: c.cy, kind: m.launcherType, expires: Date.now() + 700 });
      }
    }
    prevMissilesRef.current = now;
    if (fresh.length) setFlashes(f => [...f.slice(-14), ...fresh]);
  }, [mc]);

  // ── Snapshot missiles for smooth client-side interpolation ──
  useEffect(() => {
    if (mc) snapRef.current = { missiles: mc.missiles.map(m => ({ ...m })), at: Date.now() };
  }, [mc]);

  // ── Supply-claim toast: announce new claims once, then fade ──
  useEffect(() => {
    const s = mc?.lastSupply;
    if (!s || s.at <= lastSupplySeenRef.current) return;
    lastSupplySeenRef.current = s.at;
    const who = s.ownerId === myId ? 'You' : (roomState.players.find(p => p.id === s.ownerId)?.name ?? 'Enemy');
    const what = s.kind === 'credits'
      ? `+${s.detail.amount}cr`
      : s.kind === 'barrage'
        ? `${s.detail.tiles} missiles inbound`
        : `2x build speed for ${s.detail.seconds}s`;
    setSupplyToast(`🚢 ${who} claimed the freighter: ${what}!`);
  }, [mc, myId, roomState.players]);
  useEffect(() => {
    if (!supplyToast) return;
    const t = setTimeout(() => setSupplyToast(null), 4500);
    return () => clearTimeout(t);
  }, [supplyToast]);

  // Fog: an open enemy panel is a live feed — close it the moment vision
  // lapses, or it keeps streaming HP/stats through the fog.
  useEffect(() => {
    if (!selected || selected.ownerId === myId) return;
    if (fogOfWar && visionOf(selected.gx, selected.gy) !== 'live') setSelectedId(null);
  });

  // ── Frame loop: drives missile interpolation + flash expiry ──
  // Idle-aware: when nothing on screen moves we stop rendering entirely (no
  // idle CPU/GPU burn). While something IS moving, every frame is rendered —
  // missiles interpolate over ~10s and any throttle (this used to be 10fps)
  // reads as visible stepping.
  // Reads liveness through refs so the loop is subscribed exactly once
  // (a flashes.length dep would re-create the rAF chain on every flash).
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const busy = snapRef.current.missiles.length > 0 || flashesLenRef.current > 0;
      if (!busy) return;
      setFrame(f => f + 1);
      if (flashesLenRef.current > 0) {
        // No-op guard: filter() always returns a new array, which would
        // re-render every frame even when nothing expired.
        setFlashes(f => {
          if (!f.length) return f;
          const n = f.filter(fl => fl.expires > Date.now());
          return n.length === f.length ? f : n;
        });
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── Fullscreen state tracking ──
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      } else {
        void document.documentElement.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions);
      }
    } catch { /* unsupported — button stays put */ }
  }

  const shieldTiles = mc?.shieldTiles ?? 3;
  const healerTiles = mc?.healerTiles ?? 2;
  const coreIncome = mc?.coreIncomePerSec ?? CORE_INCOME_FALLBACK;

  const mySide = mc?.sides.top === myId ? 'top' : mc?.sides.bottom === myId ? 'bottom' : null;
  const myResources = Math.floor(mc?.resources?.[myId] ?? 0);
  const enemyId = mySide ? (mySide === 'top' ? mc?.sides.bottom : mc?.sides.top) : null;

  const buildings = useMemo(() => Object.values(mc?.buildings ?? {}), [mc?.buildings]);
  const byCell = useMemo(() => {
    const m = new Map<string, MissileBuilding>();
    for (const b of buildings) m.set(`${b.side}:${b.gx}:${b.gy}`, b);
    return m;
  }, [buildings]);
  // Cheap string signatures so the memoized grids skip re-renders on ticks.
  const occSigTop = useMemo(() => buildings.filter(b => b.side === 'top').map(b => `${b.gx},${b.gy}`).join('|'), [buildings]);
  const occSigBottom = useMemo(() => buildings.filter(b => b.side === 'bottom').map(b => `${b.gx},${b.gy}`).join('|'), [buildings]);
  const shieldBuildings = useMemo(() => buildings.filter(b => b.type === 'shield' || b.type === 'shield_heavy'), [buildings]);
  const selected: MissileBuilding | null = (selectedId && mc?.buildings?.[selectedId]) || null;
  const selCellKey = selected ? { side: selected.side, key: `${selected.gx},${selected.gy}` } : null;
  // Incoming influence for the selected OWN building: shields covering it,
  // plus (if it is a shield) healers in range of it. Only own buildings —
  // enemy influence would leak fog-hidden positions.
  const selectedInfluence = useMemo(() => {
    if (!selected || selected.ownerId !== myId) return null;
    const dist = (a: { gx: number; gy: number }, b: { gx: number; gy: number }) =>
      Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy);
    const shields = buildings.filter(s =>
      (s.type === 'shield' || s.type === 'shield_heavy') &&
      s.side === selected.side && s.id !== selected.id &&
      dist(s, selected) <= (s.shieldTiles ?? shieldTiles));
    const isShield = selected.type === 'shield' || selected.type === 'shield_heavy';
    const healers = isShield
      ? buildings.filter(h => h.type === 'healer' && h.side === selected.side && dist(h, selected) <= healerTiles)
      : [];
    if (!shields.length && !healers.length) return null;
    return { shields, healers };
  }, [selected, buildings, myId, shieldTiles, healerTiles]);
  const myBuildings = useMemo(() => buildings.filter(b => b.ownerId === myId), [buildings, myId]);
  const myCore = useMemo(() => buildings.find(b => b.type === 'core' && b.side === mySide), [buildings, mySide]);
  const enemyCore = useMemo(() => buildings.find(b => b.type === 'core' && b.side !== mySide), [buildings, mySide]);
  const myLaunchers = useMemo(() => myBuildings.filter(b => b.type === 'launcher'), [myBuildings]);
  const myEcoIncome = useMemo(() => myBuildings.filter(b => b.type === 'economy').reduce((s, b) => s + (b.incomePerSec ?? 0), 0), [myBuildings]);
  const myIncome = myEcoIncome + (myCore && (myCore.coreHp ?? 0) > 0 ? coreIncome : 0);
  const stockByType = useMemo<Record<MissileLauncherType, number>>(() => ({
    single: myLaunchers.filter(l => l.launcherType === 'single').reduce((s, l) => s + (l.stock ?? 0), 0),
    scatter: myLaunchers.filter(l => l.launcherType === 'scatter').reduce((s, l) => s + (l.stock ?? 0), 0),
  }), [myLaunchers]);
  // Once the dock gets crowded, shrink everything so every launcher stays
  // on screen (or at worst one short scroll) instead of eating the map.
  const dockCompact = myLaunchers.length > 5;
  // AUTO ALL aggregate: on only when every launcher auto-loads.
  const allAutobuild = myLaunchers.length > 0 && myLaunchers.every(l => l.autobuild);
  // Server-owned keep-firing lock for me, if any.
  const myKeepFire = mc?.keepFire?.[myId] ?? null;
  // Server-owned desperation flag for me. Unlocks at 50% core HP, one shot.
  const myDesperation = mc?.desperation?.[myId] ?? { unlocked: false, used: false };

  const enemyName = enemyId ? (roomState.players.find(p => p.id === enemyId)?.name ?? 'Enemy') : 'Enemy';
  // Null-safe: unknown/loader states report nothing rather than a false alarm.
  const enemyConnected = enemyId ? (roomState.players.find(p => p.id === enemyId)?.connected ?? true) : true;
  const winnerName = mc?.winnerId ? (roomState.players.find(p => p.id === mc.winnerId)?.name ?? '???') : null;
  // Island placards in the channel name each side by its owner, so you can
  // tell the two shores apart at a glance even when zoomed out.
  const topName = (roomState.players.find(p => p.id === mc?.sides?.top)?.name ?? 'PLAYER 1').toUpperCase();
  const bottomName = (roomState.players.find(p => p.id === mc?.sides?.bottom)?.name ?? 'PLAYER 2').toUpperCase();
  const iWon = mc?.winnerId === myId;
  const isTargeting = targetLauncherId !== null || targetType !== null || targetDesperation;
  // Fog of war
  const fogOfWar = mc?.fogOfWar ?? false;
  const getExplored = (pid: string) => (fogOfWar && mc?.exploredTiles) ? (mc.exploredTiles[pid] ?? {}) : {};
  const myExplored = myId ? getExplored(myId) : {};
  // Fog layer rebuilt when the explored set changes or the 500ms UI clock
  // ticks (fog reveals lapse) — 91 cells × 2 rects is the single biggest
  // node count in the whole SVG.
  const fogOfWarMemo = useMemo(() => {
    if (!fogOfWar || !mySide) return null;
    const enemySide = mySide === 'top' ? 'bottom' : 'top';
    const t = nowTick;
    // Three layers: never-seen tiles get opaque fog; remembered tiles get a
    // grey wash so the player keeps last-knowledge of the layout.
    const hidden: Array<{ gx: number; gy: number }> = [];
    const remembered: Array<{ gx: number; gy: number }> = [];
    for (let i = 0; i < cols * rows; i++) {
      const gx = i % cols;
      const gy = Math.floor(i / cols);
      const v = myExplored[`${gx},${gy}`];
      if (v === undefined) { hidden.push({ gx, gy }); continue; }
      if (v === 0 || v > t) continue; // live — no fog at all
      remembered.push({ gx, gy });    // -1 / lapsed
    }
    if (!hidden.length && !remembered.length) return null;
    const wash = (cells: Array<{ gx: number; gy: number }>, fill: string, opacity: number) =>
      cells.map(({ gx, gy }) => {
        const r = cellRect(enemySide, gx, gy, cols, rows);
        return (
          <rect key={`fog-${gx}-${gy}`} x={r.x} y={r.y} width={r.w} height={r.h} rx={4}
            fill={fill} stroke="rgba(255,255,255,0.05)" strokeWidth={0.5} opacity={opacity}
            pointerEvents="none" />
        );
      });
    return (
      <g key="fog-of-war" pointerEvents="none">
        {wash(hidden, 'rgba(0,0,0,0.88)', 1)}
        {/* Remembered: a grey wash over the buildings so they read as
            last-known rather than currently observed. */}
        {wash(remembered, 'rgba(70,84,104,0.5)', 0.8)}
      </g>
    );
  }, [fogOfWar, mySide, myExplored, cols, rows, nowTick]);
  // Loading guard sits BELOW every hook above (returning earlier would change
  // the hook count between renders and crash React once state arrives).
  if (!mc) {
    return (
      <div className="page text-center">
        <div className="spinner" />
        <p className="text-muted mt-16">Initializing Missile Command...</p>
      </div>
    );
  }
  const now = nowTick;
  // Vision state of an enemy tile — pure helpers in ./fog (unit-tested).
  // exploredTiles encoding: 0 = permanent, -1 = remembered, >0 = expiry ms
  const fogHistory = mc.fogHistory ?? false;
  const visionOpts = { fogOfWar, fogHistory, now };
  const visionOf = (gx: number, gy: number) => visionOfTile(myExplored, visionOpts, gx, gy);
  // Can I currently see an enemy tile? Stale tiles do NOT count — they're
  // memory, not vision, so aura/beam effects that depend on live sight must
  // not leak through them.
  const canSeeEnemyAt = (gx: number, gy: number) => canSeeEnemyAtTile(myExplored, visionOpts, gx, gy);

  // ── View transform ──
  const vbW = WORLD / zoom, vbH = WORLD / zoom;
  const vbX = Math.max(-100, Math.min(WORLD + 100 - vbW, center.x - vbW / 2));
  const vbY = Math.max(-100, Math.min(WORLD + 100 - vbH, center.y - vbH / 2));
  const clampZoom = (z: number) => Math.max(0.6, Math.min(3, z));

  // Letterbox-aware: SVG uses meet-fit, so content may not fill the element.
  function toWorld(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return { x: WORLD / 2, y: WORLD / 2 };
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / vbW, rect.height / vbH) || 1;
    const offX = rect.left + (rect.width - vbW * scale) / 2;
    const offY = rect.top + (rect.height - vbH * scale) / 2;
    return { x: vbX + (clientX - offX) / scale, y: vbY + (clientY - offY) / scale };
  }

  function cancelTargeting() {
    setTargetLauncherId(null);
    setTargetType(null);
    setTargetDesperation(false);
  }

  // Normalized-x of the supply freighter at time `t` (mirrors the server's
  // shipXAt so both agree where the ship is).
  function shipPosAt(ship: { fromX: number; toX: number; y: number; startAt: number; endAt: number }, t: number) {
    const f = Math.max(0, Math.min(1, (t - ship.startAt) / Math.max(1, ship.endAt - ship.startAt)));
    return { x: (ship.fromX + (ship.toX - ship.fromX) * f) * WORLD, y: ship.y * WORLD };
  }

  function handleTap(wx: number, wy: number, isTouch: boolean) {
    if (!mySide) return;
    // Neutral supply freighter first: tapping it claims the payout for
    // whoever taps first. Generous radius — it's a small moving target.
    const freighter = mc?.supplyShip;
    if (freighter) {
      const sp = shipPosAt(freighter, Date.now());
      if (Math.hypot(wx - sp.x, wy - sp.y) < 55) {
        onClaimSupplyShip();
        return;
      }
    }
    const cell = worldToCell(wx, wy, cols, rows);
    if (!cell) { setBuildCell(null); setSelectedId(null); return; }

    // 1. Targeting → strike enemy square (single launcher, whole type, or
    //    the one-time desperation strike). Tapping your own side backs out
    //    of targeting instead of leaving you stuck (use ✖ to cancel too).
    if (targetLauncherId || targetType || targetDesperation) {
      if (cell.side !== mySide) {
        if (targetDesperation) onFireDesperation({ targetGx: cell.gx, targetGy: cell.gy });
        else if (targetLauncherId) onLaunch({ launcherId: targetLauncherId, targetGx: cell.gx, targetGy: cell.gy });
        else if (targetType) {
          // Keep-fire armed → lock this tile; the server re-fires here on
          // every missile load until cleared. Otherwise it's a one-off volley.
          if (keepFireArmed) {
            onSetKeepFire({ armed: true, targetGx: cell.gx, targetGy: cell.gy, launcherType: targetType });
            setKeepFireArmed(false);
          } else {
            onLaunchType({ launcherType: targetType, targetGx: cell.gx, targetGy: cell.gy });
          }
        }
        cancelTargeting();
      } else {
        cancelTargeting();
      }
      return;
    }

    // 2. On touch, opening anything on your own island is LONG-PRESS only.
    //    A plain tap just closes whatever was open — applied to buildings and
    //    empty cells alike, so the gesture never depends on what's under the
    //    finger (previously tap opened buildings while long-press opened empty
    //    cells, so each gesture was dead for half the island).
    if (isTouch) {
      setBuildCell(null);
      setSelectedId(null);
      return;
    }

    // 3. Mouse/pen — tap to open.
    const b = byCell.get(`${cell.side}:${cell.gx}:${cell.gy}`);
    if (b) {
      // Fog: an enemy building without live vision can't be inspected —
      // its panel would show live HP/stats through the fog.
      if (b.ownerId !== myId && visionOf(b.gx, b.gy) !== 'live') {
        setBuildCell(null);
        setSelectedId(null);
        return;
      }
      setBuildCell(null);
      setSelectedId(b.id);
      return;
    }
    if (cell.side === mySide) {
      setSelectedId(null);
      setBuildCell(cell);
    } else {
      setBuildCell(null);
      setSelectedId(null);
    }
  }

  // ── Pointer gestures: 1-finger tap/drag-pan, 2-finger pinch ──
  // preventDefault() on down kills ghost (emulated mouse) clicks, text
  // selection and long-press callouts on touch — taps stay single taps.
  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    const g = gestureRef.current;
    // A new gesture starts clean — any previous long-press has been consumed.
    longPressFiredRef.current = false;
    g.pointers.set(e.pointerId, {
      x: e.clientX, y: e.clientY,
      downX: e.clientX, downY: e.clientY,
      downT: Date.now(), moved: false,
      tol: e.pointerType === 'touch' ? TAP_TOL : 10,
    });
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    if (g.pointers.size === 2) {
      // Pinch starting — any pending long-press must not fire.
      if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
      const [a, b] = [...g.pointers.values()];
      g.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      g.pinchZoom = zoom;
    }
    // Start long-press timer for mobile build menu. Guarded to a SINGLE
    // pointer: with two fingers down this is a pinch, and firing mid-pinch
    // would pop the build menu open while the user is zooming.
    if (e.pointerType === 'touch' && g.pointers.size === 1) {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      // Capture coordinates NOW — the React synthetic event may be recycled
      // by the time the timer fires 350ms later.
      const cx = e.clientX, cy = e.clientY;
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        // Consume the gesture so the pointer-up that follows can't also
        // fire a tap and close the menu we're about to open.
        longPressFiredRef.current = true;
        const w = toWorld(cx, cy);
        const cell = worldToCell(w.x, w.y, cols, rows);
        if (!cell || cell.side !== mySide) return;
        // Long-press opens WHATEVER is on the cell — a building's panel or,
        // on an empty square, the build menu. Same gesture for both, so it
        // never depends on what happens to be under the finger.
        const b = byCell.get(`${cell.side}:${cell.gx}:${cell.gy}`);
        if (b) {
          setBuildCell(null);
          setSelectedId(b.id);
        } else {
          setSelectedId(null);
          setBuildCell(cell);
        }
      }, LONG_PRESS_MS);
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    const g = gestureRef.current;
    const p = g.pointers.get(e.pointerId);
    if (!p) return;
    const prevX = p.x, prevY = p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (Math.hypot(p.x - p.downX, p.y - p.downY) > p.tol) p.moved = true;
    // Cancel long-press if finger moves beyond tolerance
    if (p.moved && longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    const svg = svgRef.current;
    // Cached per gesture — getBoundingClientRect() forces layout, and this
    // runs ~60x/sec while panning. The layout can't change mid-gesture.
    const rect = g.rect ?? svg?.getBoundingClientRect() ?? undefined;
    if (!g.rect && rect) g.rect = rect;
    if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.pinchDist > 0) setZoom(clampZoom((g.pinchZoom * d) / g.pinchDist));
      if (rect) {
        const dx = (e.clientX - prevX) / 2, dy = (e.clientY - prevY) / 2;
        setCenter(c => ({ x: c.x - (dx / rect.width) * vbW, y: c.y - (dy / rect.height) * vbH }));
      }
      return;
    }
    if (p.moved && rect) {
      const dx = e.clientX - prevX, dy = e.clientY - prevY;
      setCenter(c => ({ x: c.x - (dx / rect.width) * vbW, y: c.y - (dy / rect.height) * vbH }));
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    // Clear long-press timer on any pointer up
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    const g = gestureRef.current;
    const me = g.pointers.get(e.pointerId);
    g.pointers.delete(e.pointerId);
    // Gesture over — drop the cached rect so the next one re-measures.
    if (g.pointers.size === 0) g.rect = null;
    // A long-press already acted on this gesture (opened the build menu).
    // Its pointer-up must not also count as a tap, or the menu closes itself.
    if (longPressFiredRef.current) { longPressFiredRef.current = false; return; }
    if (!me || me.moved || Date.now() - me.downT >= TAP_MAX_MS) return;
    // Tap only if every REMAINING finger is also still (resting thumbs OK,
    // real pinches involve two moving fingers).
    const othersStill = [...g.pointers.values()].every(p => !p.moved);
    if (!othersStill && g.pointers.size > 0) return;
    const w = toWorld(e.clientX, e.clientY);
    handleTap(w.x, w.y, e.pointerType === 'touch');
  }

  function startTargeting(launcherId: string) {
    setTargetLauncherId(launcherId);
    setTargetType(null);
    setTargetDesperation(false);
    setSelectedId(null);
    setBuildCell(null);
  }
  function startTypeTargeting(t: MissileLauncherType) {
    setTargetType(t);
    setTargetLauncherId(null);
    setTargetDesperation(false);
    setSelectedId(null);
    setBuildCell(null);
  }
  function startDesperationTargeting() {
    setTargetDesperation(true);
    setTargetType(null);
    setTargetLauncherId(null);
    setKeepFireArmed(false);
    setSelectedId(null);
    setBuildCell(null);
  }
  // Locked → clear the server lock. Unlocked → arm the next tile pick.
  function toggleKeepFire() {
    if (myKeepFire) {
      onSetKeepFire({ armed: false });
      setKeepFireArmed(false);
    } else {
      setKeepFireArmed(v => !v);
    }
  }

  const upgradeCost = selected ? upgradeCostFor(selected) : null;
  const buildCellBuilding = buildCell ? byCell.get(`${buildCell.side}:${buildCell.gx}:${buildCell.gy}`) : undefined;
  const myCorePct = myCore ? Math.max(0, (myCore.coreHp! / myCore.maxCoreHp!) * 100) : 0;
  const enemyCorePct = enemyCore ? Math.max(0, (enemyCore.coreHp! / enemyCore.maxCoreHp!) * 100) : 0;

  const overlayBox: React.CSSProperties = {
    background: 'rgba(4,8,18,0.88)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    // NOTE: no backdrop-filter here — blur is a heavy mobile-GPU tax and
    // these bars are always on screen. Modals keep their glass blur.
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1, display: 'flex', flexDirection: 'column',
      background: '#0a1628', overflow: 'hidden',
      userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
      touchAction: 'none',
      WebkitTapHighlightColor: 'transparent',
    }}
    onContextMenu={(e) => e.preventDefault()}
    >
      <style>{`
        @keyframes mc-pulse { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
        .mc-beam { animation: mc-beam-flow 0.7s linear infinite; }
        @keyframes mc-beam-flow { to { stroke-dashoffset: -18; } }
        .mc-march { animation: mc-march-flow 1.1s linear infinite; }
        @keyframes mc-march-flow { to { stroke-dashoffset: -38; } }
        @media (prefers-reduced-motion: reduce) {
          .mc-beam, .mc-march { animation: none !important; }
        }
        .mc-dock::-webkit-scrollbar { display: none; }
      `}</style>

      {/* ── Full-screen canvas ── */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', contain: 'layout paint' }}>
        <svg
          ref={svgRef}
          viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
          style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: 'pointer' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={(e) => setZoom(z => clampZoom(z * (e.deltaY > 0 ? 0.9 : 1.1)))}
          onContextMenu={(e) => e.preventDefault()}
        >
          <defs>
            <linearGradient id="mc-water" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0c2340" />
              <stop offset="50%" stopColor="#0a3a5c" />
              <stop offset="100%" stopColor="#0c2340" />
            </linearGradient>
            <linearGradient id="mc-top" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3f6212" />
              <stop offset="100%" stopColor="#4d7c0f" />
            </linearGradient>
            <linearGradient id="mc-bottom" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#155e75" />
              <stop offset="100%" stopColor="#0e7490" />
            </linearGradient>
            {/* Shield visuals — gradients, hex patterns, glow filters */}
            <linearGradient id="shieldGrad-Regular" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.35" />
              <stop offset="50%" stop-color="#0ea5e9" stop-opacity="0.2" />
              <stop offset="100%" stop-color="#0369a1" stop-opacity="0.15" />
            </linearGradient>
            <linearGradient id="shieldGrad-Heavy" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#60a5fa" stop-opacity="0.4" />
              <stop offset="50%" stop-color="#2563eb" stop-opacity="0.25" />
              <stop offset="100%" stop-color="#1e3a8a" stop-opacity="0.2" />
            </linearGradient>
            <linearGradient id="shieldGrad-Regular-Low" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#fbbf24" stop-opacity="0.3" />
              <stop offset="100%" stop-color="#f59e0b" stop-opacity="0.15" />
            </linearGradient>
            <linearGradient id="shieldGrad-Heavy-Low" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#f43f5e" stop-opacity="0.35" />
              <stop offset="100%" stop-color="#991b1b" stop-opacity="0.2" />
            </linearGradient>
            <linearGradient id="coreGrad-Regular" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#7dd3fc" />
              <stop offset="50%" stop-color="#0ea5e9" />
              <stop offset="100%" stop-color="#0369a1" />
            </linearGradient>
            <linearGradient id="coreGrad-Heavy" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#93c5fd" />
              <stop offset="50%" stop-color="#3b82f6" />
              <stop offset="100%" stop-color="#1e40af" />
            </linearGradient>
            <radialGradient id="pulseGrad-Regular" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#7dd3fc" stop-opacity="0.6" />
              <stop offset="70%" stop-color="#38bdf8" stop-opacity="0.2" />
              <stop offset="100%" stop-color="#0ea5e9" stop-opacity="0" />
            </radialGradient>
            <radialGradient id="pulseGrad-Heavy" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#93c5fd" stop-opacity="0.6" />
              <stop offset="70%" stop-color="#60a5fa" stop-opacity="0.2" />
              <stop offset="100%" stop-color="#2563eb" stop-opacity="0" />
            </radialGradient>
            <linearGradient id="healerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#4ade80" stop-opacity="0.45" />
              <stop offset="100%" stop-color="#16a34a" stop-opacity="0.25" />
            </linearGradient>
            <pattern id="hexPattern" patternUnits="userSpaceOnUse" width="24" height="21">
              <path d="M12,0 L24,5.25 L24,15.75 L12,21 L0,15.75 L0,5.25 Z" fill="none" stroke="rgba(56,189,248,0.35)" strokeWidth="1" />
            </pattern>
            <pattern id="hexPattern-Heavy" patternUnits="userSpaceOnUse" width="24" height="21">
              <path d="M12,0 L24,5.25 L24,15.75 L12,21 L0,15.75 L0,5.25 Z" fill="none" stroke="rgba(96,165,250,0.4)" strokeWidth="1.2" />
            </pattern>
            <filter id="glow-Regular" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="glow-Heavy" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Ocean */}
          <rect x={-100} y={-100} width={WORLD + 200} height={WORLD + 200} fill="url(#mc-water)" />
          {[420, 460, 500, 540, 580].map(y => (
            <line key={y} x1={-100} y1={y} x2={WORLD + 100} y2={y} stroke="rgba(56,189,248,0.15)" strokeWidth={2} strokeDasharray="24 18" />
          ))}

          {/* Island bases */}
          <rect x={TOP_RECT.x} y={TOP_RECT.y} width={TOP_RECT.w} height={TOP_RECT.h} rx={40} fill="url(#mc-top)" stroke={mySide === 'top' ? '#a3e635' : '#fb7185'} strokeWidth={mySide === 'top' ? 5 : 3} />
          <rect x={BOTTOM_RECT.x} y={BOTTOM_RECT.y} width={BOTTOM_RECT.w} height={BOTTOM_RECT.h} rx={40} fill="url(#mc-bottom)" stroke={mySide === 'bottom' ? '#22d3ee' : '#fb7185'} strokeWidth={mySide === 'bottom' ? 5 : 3} />
          {/* Island placards sit in the water between the two islands (the old
              labels were drawn on top of the grid cells and hid buildings).
              Each one hugs its own shore with a notch pointing at it. */}
          <IslandPlacard
            y={TOP_RECT.y + TOP_RECT.h + 42} name={topName} mine={mySide === 'top'} dir="up"
            color={mySide === 'top' ? '#a3e635' : '#fb7185'}
          />
          <IslandPlacard
            y={BOTTOM_RECT.y - 42} name={bottomName} mine={mySide === 'bottom'} dir="down"
            color={mySide === 'bottom' ? '#22d3ee' : '#fb7185'}
          />

          {/* Grid cells (memoized per island — skips most re-renders) */}
          <IslandGrid
            side="top" cols={cols} rows={rows} isMine={mySide === 'top'}
            occSig={occSigTop} selKey={selCellKey?.side === 'top' ? selCellKey.key : null}
            buildKey={buildCell?.side === 'top' ? `${buildCell.gx},${buildCell.gy}` : null}
          />
          <IslandGrid
            side="bottom" cols={cols} rows={rows} isMine={mySide === 'bottom'}
            occSig={occSigBottom} selKey={selCellKey?.side === 'bottom' ? selCellKey.key : null}
            buildKey={buildCell?.side === 'bottom' ? `${buildCell.gx},${buildCell.gy}` : null}
          />

          {/* Shield coverage — hex tiles with animated gradients, pulsing borders.
              A shield's aura is only drawn when I can actually see the
              generator, so fogged enemy shields don't reveal their own
              coverage — that would be free scouting information. */}
          {shieldBuildings.map(b => {
            const isMine = b.ownerId === myId;
            if (!isMine && visionOf(b.gx, b.gy) === 'hidden') return null; // never seen
            const stale = !isMine && visionOf(b.gx, b.gy) === 'stale';
            const pct = (b.shieldHp ?? 0) / (b.maxShieldHp ?? 1);
            const isSel = selected?.id === b.id;
            const isHeavy = b.type === 'shield_heavy';
            // Skip the coverage math entirely when the grid is off or the
            // shield is drained — coverCache is pure but not free.
            const cells = (showShieldGrid && pct > 0) ? coverCache(b.gx, b.gy, b.shieldTiles ?? shieldTiles) : [];
            const gradId = pct <= 0.15 ? (isHeavy ? 'shieldGrad-Heavy-Low' : 'shieldGrad-Regular-Low')
                            : (isHeavy ? 'shieldGrad-Heavy' : 'shieldGrad-Regular');
            const hexPatternId = isHeavy ? 'hexPattern-Heavy' : 'hexPattern';
            const glowFilter = isHeavy ? 'glow-Heavy' : 'glow-Regular';
            const edgeColor = isHeavy ? '#60a5fa' : '#38bdf8';
            const edgeColorEnemy = isHeavy ? '#f43f5e' : '#fb7185';
            return (
              <g key={`sh-${b.id}`} pointerEvents="none"
                filter={stale ? 'saturate(0.4)' : (showShieldGrid && pct > 0 && isSel ? `url(#${glowFilter})` : undefined)}
                opacity={stale ? 0.5 : 1}>
                {showShieldGrid && cells.map(c => {
                  const r = cellRect(b.side, c.gx, c.gy, cols, rows);
                  return (
                    <g key={`${c.gx}-${c.gy}`}>
                      <rect x={r.x + 2} y={r.y + 2} width={r.w - 4} height={r.h - 4} rx={7}
                        fill={`url(#${gradId})`} />
                      <rect x={r.x + 2} y={r.y + 2} width={r.w - 4} height={r.h - 4} rx={7}
                        fill={`url(#${hexPatternId})`} opacity={isSel ? 1 : pct > 0.15 ? 0.7 : 0.35} />
                      <rect x={r.x + 2} y={r.y + 2} width={r.w - 4} height={r.h - 4} rx={7}
                        fill="none"
                        stroke={!isMine ? edgeColorEnemy : edgeColor}
                        strokeWidth={isSel ? 2.5 : pct > 0.15 ? 1.2 : 0.8}
                        strokeDasharray={pct <= 0.15 ? '5 7' : undefined}
                        opacity={pct <= 0.15 ? 0.6 : isSel ? 1 : 0.7} />
                    </g>
                  );
                })}
                {showShieldGrid && isSel && pct > 0 && (
                  <path d={coverageOutlinePath(b.side, cells, cols, rows)}
                    fill="none" stroke={edgeColor} strokeWidth={3.5} strokeDasharray="14 5" className="mc-march" strokeLinejoin="round" />
                )}
              </g>
            );
          })}

          {/* Shield Healer coverage — only while selected, full spotlight */}
          {selected?.type === 'healer' && selected.ownerId === myId && (() => {
            const cells = coverCache(selected.gx, selected.gy, healerTiles);
            return (
              <g key={`he-${selected.id}`} pointerEvents="none">
                {cells.map(c => {
                  const r = cellRect(selected.side, c.gx, c.gy, cols, rows);
                  return (
                    <g key={`${c.gx}-${c.gy}`}>
                      <rect x={r.x + 2} y={r.y + 2} width={r.w - 4} height={r.h - 4} rx={7}
                        fill="url(#healerGrad)" />
                      {showShieldGrid && (
                        <rect x={r.x + 2} y={r.y + 2} width={r.w - 4} height={r.h - 4} rx={7}
                          fill="url(#hexPattern)" opacity={0.7} />
                      )}
                      <rect x={r.x + 2} y={r.y + 2} width={r.w - 4} height={r.h - 4} rx={7}
                        fill="none" stroke="#86efac" strokeWidth={2.5} />
                    </g>
                  );
                })}
                <path d={coverageOutlinePath(selected.side, cells, cols, rows)}
                  fill="none" stroke="#86efac" strokeWidth={3.5} strokeDasharray="14 5" className="mc-march" strokeLinejoin="round" />
              </g>
            );
          })()}

          {/* Fog of War overlay on enemy island.
              Memoized: recomputes when the explored set changes (4Hz with
              server ticks) rather than on every 10fps frame tick. */}
          {fogOfWarMemo}
          {/* Enemy core marker: INTENTIONALLY always drawn. Cores are
              permanently revealed to both sides by design (the server seeds
              both core tiles as explored for both players and never redacts
              core buildings), so this leaks nothing the fog is hiding. */}
          {fogOfWar && enemyCore && (() => {
            const r = cellRect(enemyCore.side, enemyCore.gx, enemyCore.gy, cols, rows);
            return (
              <g key="fog-core-marker" pointerEvents="none">
                <circle cx={r.cx} cy={r.cy} r={Math.min(r.w, r.h) * 0.18} fill="rgba(251,113,133,0.3)" stroke="#fb7185" strokeWidth={2} />
                <text x={r.cx} y={r.cy + 4} textAnchor="middle" dominantBaseline="central" fontSize={10} fill="#fb7185" fontWeight={800}>⭐</text>
              </g>
            );
          })()}

          {/* Heal effect (visible to BOTH players): beam + pulses + ripple.
              Under fog, an enemy healer's beam gives away its exact tile, so
              it's only drawn once I have vision of that healer. */}
          {buildings.filter(b => b.type === 'healer' && b.healTargetId && (b.ownerId === myId || canSeeEnemyAt(b.gx, b.gy))).map(h => {
            const t = mc.buildings[h.healTargetId!];
            if (!t) return null;
            const hr = cellRect(h.side, h.gx, h.gy, cols, rows);
            const tr = cellRect(t.side, t.gx, t.gy, cols, rows);
            const mx = (hr.cx + tr.cx) / 2, my = (hr.cy + tr.cy) / 2;
            const path = `M ${hr.cx} ${hr.cy} L ${tr.cx} ${tr.cy}`;
            return (
              <g key={`beam-${h.id}`} pointerEvents="none">
                {/* Base glow beam */}
                <line x1={hr.cx} y1={hr.cy} x2={tr.cx} y2={tr.cy}
                  stroke="#4ade80" strokeWidth={14} strokeLinecap="round" opacity={0.15} filter="url(#glow-Regular)" />
                {/* Animated dashed beam */}
                <line x1={hr.cx} y1={hr.cy} x2={tr.cx} y2={tr.cy}
                  stroke="#86efac" strokeWidth={5} strokeLinecap="round"
                  strokeDasharray="12 10" className="mc-beam" opacity={0.95} />
                {/* Energy particles traveling along beam */}
                {!reducedMotion && (
                  <>
                    <circle r={5} fill="#bbf7d0" opacity={0.95}>
                      <animateMotion dur="1s" repeatCount="indefinite" path={path} />
                    </circle>
                    <circle r={4} fill="#4ade80" opacity={0.95}>
                      <animateMotion dur="1s" begin="-0.33s" repeatCount="indefinite" path={path} />
                    </circle>
                    <circle r={3.5} fill="#86efac" opacity={0.95}>
                      <animateMotion dur="1s" begin="-0.66s" repeatCount="indefinite" path={path} />
                    </circle>
                  </>
                )}
                {/* Target ripple rings */}
                <circle cx={tr.cx} cy={tr.cy} r={8} fill="none" stroke="#4ade80" strokeWidth={3} filter="url(#glow-Regular)">
                  {!reducedMotion && (
                    <>
                      <animate attributeName="r" values="8;28" dur="1.2s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.9;0" dur="1.2s" repeatCount="indefinite" />
                    </>
                  )}
                </circle>
                <circle cx={tr.cx} cy={tr.cy} r={8} fill="none" stroke="#86efac" strokeWidth={2}>
                  {!reducedMotion && (
                    <>
                      <animate attributeName="r" values="8;28" dur="1.2s" begin="-0.6s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.7;0" dur="1.2s" begin="-0.6s" repeatCount="indefinite" />
                    </>
                  )}
                </circle>
                {/* Midpoint energy burst */}
                <circle cx={mx} cy={my} r={16} fill="rgba(6,40,20,0.85)" stroke="#4ade80" strokeWidth={2} filter="url(#glow-Regular)">
                  {!reducedMotion && (
                    <>
                      <animate attributeName="r" values="16;22" dur="0.8s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.85;0.5" dur="0.8s" repeatCount="indefinite" />
                    </>
                  )}
                </circle>
                <text x={mx} y={my} textAnchor="middle" dominantBaseline="central" fontSize={16} fontWeight={900}>💚</text>
              </g>
            );
          })}

          {/* Incoming influence for the selected own building: dashed links +
              corner rings on each shield covering it and each healer in range.
              Own island only, so no fog positions can leak. */}
          {selectedInfluence && selected && (() => {
            const sr = cellRect(selected.side, selected.gx, selected.gy, cols, rows);
            const link = (
              b: MissileBuilding,
              color: string,
              label: string,
            ) => {
              const r = cellRect(b.side, b.gx, b.gy, cols, rows);
              return (
                <g key={`inf-${b.id}`} pointerEvents="none">
                  <line x1={r.cx} y1={r.cy} x2={sr.cx} y2={sr.cy}
                    stroke={color} strokeWidth={2.5} strokeDasharray="8 6" opacity={0.9} />
                  <rect x={r.x - 2} y={r.y - 2} width={r.w + 4} height={r.h + 4} rx={11}
                    fill="none" stroke={color} strokeWidth={2.5} strokeDasharray="7 5" />
                  <circle cx={r.cx} cy={r.cy} r={Math.min(r.w, r.h) * 0.52} fill="none"
                    stroke={color} strokeWidth={1.5} opacity={0.55}>
                    {!reducedMotion && (
                      <>
                        <animate attributeName="r" values={`${Math.min(r.w, r.h) * 0.52};${Math.min(r.w, r.h) * 0.68}`} dur="1.4s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.55;0" dur="1.4s" repeatCount="indefinite" />
                      </>
                    )}
                  </circle>
                  <text x={(r.cx + sr.cx) / 2} y={(r.cy + sr.cy) / 2 - 8} textAnchor="middle"
                    fontSize={15} fontWeight={900} stroke="rgba(0,0,0,0.85)" strokeWidth={3}
                    paintOrder="stroke">{label}</text>
                </g>
              );
            };
            return (
              <g key="influence" pointerEvents="none">
                {selectedInfluence.shields.map(s => link(s, '#7dd3fc', '🛡️'))}
                {selectedInfluence.healers.map(h => link(h, '#86efac', '💚'))}
              </g>
            );
          })()}

          {/* Missiles in flight (interpolated, fanned by lane).
              Kept to 3 lean nodes each (trail, head, target) with no CSS
              animations so big scatter volleys stay smooth. */}
          {snapRef.current.missiles.map(m => {
            const elapsed = Math.min(12, (now - snapRef.current.at) / 1000);
            const sx = m.currentX * WORLD, sy = m.currentY * WORLD;
            const tx = m.targetX * WORLD, ty = m.targetY * WORLD;
            const dx = tx - sx, dy = ty - sy;
            const d = Math.hypot(dx, dy) || 1;
            const step = (m.speed || 0.1) * WORLD * elapsed;
            const t = Math.min(1, step / d);
            // Lane offset perpendicular to travel: volleys fan out instead of
            // stacking pixel-perfect (which looked like glitching).
            const lane = m.lane ?? 0;
            const ox = (-dy / d) * lane * 14;
            const oy = (dx / d) * lane * 14;
            const px = sx + dx * t + ox, py = sy + dy * t + oy;
            const col = m.desperation ? '#f43f5e' : m.launcherType === 'single' ? '#fbbf24' : '#fb7185';
            // NOTE: deployAt is stamped with the SERVER clock but `now` is the
            // CLIENT clock — skew can briefly misplace banked volleys, and
            // "launch all" ripples launchers 300ms apart, so fresh missiles
            // legitimately sit at their launcher until their wave deploys.
            // Fade out over the last 15% of the flight. Without this the
            // client reaches the target before the server's next 250ms tick
            // removes it, so the missile freezes on the tile for one tick and
            // then blinks out.
            const arrival = t > 0.85 ? Math.max(0, 1 - (t - 0.85) / 0.15) : 1;
            const tc = cellRect(m.ownerId === mc.sides.top ? 'bottom' : 'top', m.targetGx, m.targetGy, cols, rows);
            return (
              <g key={m.id} pointerEvents="none" opacity={arrival}>
                <line x1={sx + ox} y1={sy + oy} x2={px} y2={py} stroke={col} strokeWidth={m.desperation ? 5 : 3} opacity={0.5} />
                <text x={px} y={py} textAnchor="middle" dominantBaseline="central" fontSize={m.desperation ? 30 : 22}>{m.desperation ? '☢️' : '🚀'}</text>
                <rect x={tc.x + 2} y={tc.y + 2} width={tc.w - 4} height={tc.h - 4} rx={8}
                  fill="none" stroke={col} strokeWidth={m.desperation ? 3.5 : 2} strokeDasharray="6 5" opacity={0.8} />
              </g>
            );
          })}

          {/* Neutral supply freighter crossing the channel. First tap claims
              it — position interpolated from the server's sailing schedule. */}
          {mc.supplyShip && (() => {
            const sp = shipPosAt(mc.supplyShip, now);
            return (
              <g key={`freighter-${mc.supplyShip.id}`} pointerEvents="none">
                <line
                  x1={sp.x - (mc.supplyShip.dir > 0 ? 70 : -70)} y1={sp.y}
                  x2={sp.x} y2={sp.y}
                  stroke="rgba(255,255,255,0.35)" strokeWidth={4} strokeLinecap="round"
                />
                <circle cx={sp.x} cy={sp.y} r={30} fill="rgba(251,191,36,0.12)" stroke="#fbbf24" strokeWidth={2} strokeDasharray="8 6" />
                <text x={sp.x} y={sp.y} textAnchor="middle" dominantBaseline="central" fontSize={32}>🚢</text>
              </g>
            );
          })()}

          {/* Keep-firing lock: where my missiles will keep landing. Both
              players can see it — it's an automated, self-firing gun. */}
          {myKeepFire && mySide && (() => {
            const lockSide = mySide === 'top' ? 'bottom' : 'top';
            const r = cellRect(lockSide, myKeepFire.targetGx, myKeepFire.targetGy, cols, rows);
            return (
              <g pointerEvents="none">
                <rect x={r.x + 2} y={r.y + 2} width={r.w - 4} height={r.h - 4} rx={8}
                  fill="rgba(74,222,128,0.10)" stroke="#4ade80" strokeWidth={3} strokeDasharray="10 6" />
                <text x={r.x + r.w / 2} y={r.y + r.h / 2} textAnchor="middle" dominantBaseline="central"
                  fontSize={r.h * 0.42}>🔒</text>
              </g>
            );
          })()}

          {/* Impact flashes */}
          {flashes.map(f => (
            <g key={f.id} opacity={Math.max(0, (f.expires - now) / 700)} pointerEvents="none">
              <circle cx={f.x} cy={f.y} r={44} fill={f.kind === 'single' ? '#fbbf24' : '#fb7185'} opacity={0.5} />
              <circle cx={f.x} cy={f.y} r={20} fill="#fff" opacity={0.8} />
              <text x={f.x} y={f.y} textAnchor="middle" dominantBaseline="central" fontSize={30}>💥</text>
            </g>
          ))}

          {/* Buildings */}
          {buildings.map(b => {
            const meta = BUILDING_META[b.type];
            const r = cellRect(b.side, b.gx, b.gy, cols, rows);
            const isMine = b.ownerId === myId;
            const isSel = selectedId === b.id;
            const hpPct = b.type === 'core' ? (b.coreHp! / b.maxCoreHp!) : (b.hp! / b.maxHp!);
            const shieldPct = (b.type === 'shield' || b.type === 'shield_heavy') ? (b.shieldHp! / b.maxShieldHp!) : 1;
            const emoji = b.type === 'launcher' ? (b.launcherType === 'single' ? '🎯' : '💥') : b.type === 'core' ? '⭐' : meta.emoji;
            // Fog of war: hide enemy buildings I have no vision of (cores always show).
            const vis = isMine ? 'live' : visionOf(b.gx, b.gy);
            if (vis === 'hidden') return null;
            // A remembered (lapsed) tile is drawn dim + desaturated so it
            // reads as "this is what I last knew", not "this is live".
            const stale = vis === 'stale';
            return (
              <g key={b.id} pointerEvents="none" opacity={stale ? 0.55 : 1}
                filter={stale ? 'saturate(0.35)' : undefined}>
                {isSel && (
                  <rect x={r.x - 2} y={r.y - 2} width={r.w + 4} height={r.h + 4} rx={12}
                    fill="none" stroke="#fff" strokeWidth={3.5} strokeDasharray="10 7" />
                )}
                    {isSel && ((b.type === 'shield' || b.type === 'shield_heavy') || b.type === 'healer') && (
                      <g pointerEvents="none">
                        <circle cx={r.cx} cy={r.cy} r={Math.min(r.w, r.h) * 0.42} fill="none"
                          stroke={(b.type === 'shield' || b.type === 'shield_heavy') ? '#7dd3fc' : '#86efac'} strokeWidth={3}>
                          {!reducedMotion && (
                            <>
                              <animate attributeName="r" values={`${Math.min(r.w, r.h) * 0.42};${Math.min(r.w, r.h) * 0.62}`} dur="1.2s" repeatCount="indefinite" />
                              <animate attributeName="opacity" values="0.9;0" dur="1.2s" repeatCount="indefinite" />
                            </>
                          )}
                        </circle>
                        <circle cx={r.cx} cy={r.cy} r={Math.min(r.w, r.h) * 0.42} fill="none"
                          stroke="#ffffff" strokeWidth={1.5}>
                          {!reducedMotion && (
                            <>
                              <animate attributeName="r" values={`${Math.min(r.w, r.h) * 0.42};${Math.min(r.w, r.h) * 0.62}`} dur="1.2s" begin="-0.6s" repeatCount="indefinite" />
                              <animate attributeName="opacity" values="0.7;0" dur="1.2s" begin="-0.6s" repeatCount="indefinite" />
                            </>
                          )}
                        </circle>
                      </g>
                    )}
                {/* Shield generator: animated energy core + pulsing rings */}
                {(b.type === 'shield' || b.type === 'shield_heavy') && (
                  <g pointerEvents="none">
                    {/* Outer pulse rings (only when charged) */}
                    {shieldPct > 0 && (
                      <>
                        <circle cx={r.cx} cy={r.cy + 2} r={Math.min(r.w, r.h) * 0.38} fill="none"
                          stroke={b.type === 'shield_heavy' ? '#60a5fa' : '#38bdf8'} strokeWidth={1.5} opacity={0.6}>
                          {!reducedMotion && (
                            <>
                              <animate attributeName="r" values={`${Math.min(r.w, r.h) * 0.38};${Math.min(r.w, r.h) * 0.52}`} dur="2s" repeatCount="indefinite" />
                              <animate attributeName="opacity" values="0.6;0" dur="2s" repeatCount="indefinite" />
                            </>
                          )}
                        </circle>
                        <circle cx={r.cx} cy={r.cy + 2} r={Math.min(r.w, r.h) * 0.38} fill="none"
                          stroke={b.type === 'shield_heavy' ? '#93c5fd' : '#7dd3fc'} strokeWidth={1} opacity={0.4}>
                          {!reducedMotion && (
                            <>
                              <animate attributeName="r" values={`${Math.min(r.w, r.h) * 0.38};${Math.min(r.w, r.h) * 0.52}`} dur="2s" begin="-1s" repeatCount="indefinite" />
                              <animate attributeName="opacity" values="0.4;0" dur="2s" begin="-1s" repeatCount="indefinite" />
                            </>
                          )}
                        </circle>
                      </>
                    )}
                    {/* Energy core with radial gradient */}
                    <circle cx={r.cx} cy={r.cy + 2} r={Math.min(r.w, r.h) * 0.32}
                      fill={`url(#${b.type === 'shield_heavy' ? 'coreGrad-Heavy' : 'coreGrad-Regular'})`}
                      stroke={shieldPct <= 0.15 ? '#f43f5e' : (isMine ? meta.color : '#fb7185')} strokeWidth={2.5} />
                    {/* Inner glow pulse */}
                    <circle cx={r.cx} cy={r.cy + 2} r={Math.min(r.w, r.h) * 0.28} fill="none"
                      stroke={b.type === 'shield_heavy' ? '#93c5fd' : '#7dd3fc'} strokeWidth={1.5} opacity={0.7}>
                      {!reducedMotion && (
                        <>
                          <animate attributeName="r" values={`${Math.min(r.w, r.h) * 0.28};${Math.min(r.w, r.h) * 0.35}`} dur="1.5s" repeatCount="indefinite" />
                          <animate attributeName="opacity" values="0.7;0.2" dur="1.5s" repeatCount="indefinite" />
                        </>
                      )}
                    </circle>
                    {/* Emoji overlay */}
                    <text x={r.cx} y={r.cy + 2} textAnchor="middle" dominantBaseline="central" fontSize={26}>{emoji}</text>
                  </g>
                )}
                {!(b.type === 'shield' || b.type === 'shield_heavy') && (
                  <g pointerEvents="none">
                    <circle cx={r.cx} cy={r.cy + 2} r={Math.min(r.w, r.h) * 0.32} fill={isMine ? 'rgba(0,0,0,0.55)' : 'rgba(120,0,0,0.55)'} stroke={isMine ? meta.color : '#fb7185'} strokeWidth={2.5} />
                    <text x={r.cx} y={r.cy + 2} textAnchor="middle" dominantBaseline="central" fontSize={26}>{emoji}</text>
                  </g>
                )}
                {(b.type === 'shield' || b.type === 'shield_heavy') && shieldPct <= 0.1 && (
                  <text x={r.cx} y={r.cy - 14} textAnchor="middle" dominantBaseline="central"
                    fontSize={18} fontWeight={800} fill="#f43f5e"
                    stroke="rgba(0,0,0,0.9)" strokeWidth={3.5} paintOrder="stroke">
                    ⚠️
                  </text>
                )}
                {b.type !== 'core' && (
                  <text x={r.cx} y={r.y + r.h - 7} textAnchor="middle" fontSize={16} fontWeight={900}
                    stroke="rgba(0,0,0,0.85)" strokeWidth={3} paintOrder="stroke" letterSpacing={1}>
                    <tspan fill="#fbbf24">{'★'.repeat(b.level)}</tspan>
                    <tspan fill="rgba(255,255,255,0.35)">{'☆'.repeat(5 - b.level)}</tspan>
                  </text>
                )}
                {/* HP bar */}
                <rect x={r.x + 6} y={r.y + 4} width={r.w - 12} height={6} rx={3} fill="rgba(0,0,0,0.65)" />
                <rect x={r.x + 6} y={r.y + 4} width={(r.w - 12) * Math.max(0, Math.min(1, hpPct))} height={6} rx={3}
                  fill={hpPct > 0.5 ? '#4ade80' : hpPct > 0.25 ? '#fbbf24' : '#f43f5e'} />
                {/* Shield pool bar — segmented energy bar */}
                {(b.type === 'shield' || b.type === 'shield_heavy') && (
                  <g>
                    <rect x={r.x + 6} y={r.y + 12} width={r.w - 12} height={8} rx={4} fill="rgba(0,0,0,0.7)" stroke="rgba(255,255,255,0.1)" strokeWidth={0.5} />
                    {/* Segments */}
                    {[1,2,3,4,5,6,7,8].map((seg, i) => {
                      const segPct = (i + 1) / 8;
                      const active = shieldPct >= segPct - 0.05;
                      const isHeavy = b.type === 'shield_heavy';
                      return (
                        <rect key={seg} x={r.x + 7 + i * ((r.w - 14) / 8)} y={r.y + 13}
                          width={(r.w - 14) / 8 - 1.5} height={6} rx={2}
                          fill={active
                            ? (isHeavy
                                ? (segPct <= 0.3 ? '#60a5fa' : segPct <= 0.6 ? '#3b82f6' : '#2563eb')
                                : (segPct <= 0.3 ? '#38bdf8' : segPct <= 0.6 ? '#0ea5e9' : '#0369a1'))
                            : 'rgba(255,255,255,0.08)'}
                          opacity={active ? 1 : 0.3}
                          filter={!reducedMotion && active && shieldPct > segPct - 0.05 && shieldPct < segPct + 0.05 && shieldPct < 0.99 ? 'url(#glow-Regular)' : undefined}>
                          {active && !reducedMotion && shieldPct > segPct - 0.05 && shieldPct < segPct + 0.05 && shieldPct < 0.99 && (
                            <animate attributeName="opacity" values="1;0.6" dur="0.8s" repeatCount="indefinite" />
                          )}
                        </rect>
                      );
                    })}
                  </g>
                )}
                {/* stock badge + missile build progress for own launchers */}
                {b.type === 'launcher' && isMine && (((b.loadingUntil ?? 0) > now) || (b.stock ?? 0) > 0) && (() => {
                  const loading = (b.loadingUntil ?? 0) > now;
                  const loadPct = loading ? Math.min(1, Math.max(0, 1 - (b.loadingUntil! - now) / (LOAD_SECONDS * 1000))) : 0;
                  return (
                    <g>
                      {!loading && (b.stock ?? 0) > 0 && (
                        <text x={r.x + r.w - 8} y={r.y + 18} textAnchor="end" fontSize={15}>
                          {`🚀${b.stock ?? 0}`}
                        </text>
                      )}
                      {loading && (
                        <g>
                          <rect x={r.x + 6} y={r.y + 12} width={r.w - 12} height={5} rx={2.5} fill="rgba(0,0,0,0.65)" />
                          <rect x={r.x + 6} y={r.y + 12} width={(r.w - 12) * loadPct} height={5} rx={2.5}
                            fill="#fbbf24" />
                        </g>
                      )}
                    </g>
                  );
                })()}
              </g>
            );
          })}

          {/* Construction sites & upgrade progress. Enemy activity is only
              shown with live vision — otherwise a 🚧 telegraphs exactly what
              and where the opponent is building through the fog. */}
          {Object.values(mc.pending ?? {}).map(p => {
            const isMine = p.ownerId === myId;
            if (!isMine && visionOf(p.gx, p.gy) !== 'live') return null;
            const r = cellRect(p.side, p.gx, p.gy, cols, rows);
            const secsLeft = Math.max(0, (p.completeAt - now) / 1000);
            if (p.kind === 'build') {
              const meta = BUILDING_META[p.type];
              return (
                <g key={p.id} pointerEvents="none">
                  <rect x={r.x + 2} y={r.y + 2} width={r.w - 4} height={r.h - 4} rx={10}
                    fill={isMine ? 'rgba(251,191,36,0.12)' : 'rgba(251,113,133,0.12)'}
                    stroke={isMine ? '#fbbf24' : '#fb7185'} strokeWidth={2.5} strokeDasharray="8 6" />
                  <text x={r.cx} y={r.cy - 2} textAnchor="middle" dominantBaseline="central" fontSize={24}>🚧</text>
                  <text x={r.cx} y={r.y + r.h - 10} textAnchor="middle" fontSize={13} fontWeight={900} fill="#fbbf24"
                    stroke="rgba(0,0,0,0.8)" strokeWidth={3} paintOrder="stroke">
                    {meta.emoji} {secsLeft.toFixed(0)}s
                  </text>
                </g>
              );
            }
            if (p.kind === 'sell') {
              return (
                <g key={p.id} pointerEvents="none">
                  <rect x={r.x + 4} y={r.y + 4} width={Math.min(150, r.w - 8)} height={22} rx={11}
                    fill="rgba(0,0,0,0.7)" stroke="#fbbf24" strokeWidth={1.5} />
                  <text x={r.x + 12} y={r.y + 15} fontSize={13} fontWeight={800} fill="#fcd34d">
                    💰 +{p.refund ?? 0}cr {secsLeft.toFixed(0)}s
                  </text>
                </g>
              );
            }
            return (
              <g key={p.id} pointerEvents="none">
                <rect x={r.x + 4} y={r.y + 4} width={Math.min(150, r.w - 8)} height={22} rx={11}
                  fill="rgba(0,0,0,0.7)" stroke="#a78bfa" strokeWidth={1.5} />
                <text x={r.x + 12} y={r.y + 15} fontSize={13} fontWeight={800} fill="#c4b5fd">
                  ⏳ Lv{p.targetLevel} {secsLeft.toFixed(0)}s
                </text>
              </g>
            );
          })}
        </svg>

        {/* ── Top HUD overlay ── */}
        <div style={{ position: 'absolute', top: 8, left: 8, right: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'stretch', pointerEvents: 'none' }}>
          <div style={{ ...overlayBox, pointerEvents: 'auto', padding: '6px 12px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div className="text-xs" style={{ fontWeight: 800, color: 'var(--amber-400)', fontSize: '1.05rem', lineHeight: 1.1 }}>💰 {myResources}</div>
            <div className="text-xs text-muted" style={{ fontSize: '0.65rem' }}>+{myIncome}/s • {roomState.code}{((mc.buildSurge?.[myId] ?? 0) > now) && <span style={{ color: '#4ade80', fontWeight: 800 }}> • ⚡2x {Math.ceil(((mc.buildSurge?.[myId] ?? 0) - now) / 1000)}s</span>}</div>
          </div>
          <div style={{ ...overlayBox, pointerEvents: 'auto', padding: '6px 10px', flex: 1, minWidth: 120 }}>
            <div className="text-xs" style={{ fontWeight: 800, fontSize: '0.65rem' }}>⭐ YOU {mySide === 'top' ? '🔼' : '🔽'} {myCore ? `${Math.ceil(myCore.coreHp!)}/${myCore.maxCoreHp}` : ''}</div>
            <div style={{ height: 6, background: 'rgba(255,255,255,0.12)', borderRadius: 3, overflow: 'hidden', marginTop: 3 }}>
              <div style={{ width: `${myCorePct}%`, height: '100%', background: 'linear-gradient(90deg,#4ade80,#22d3ee)' }} />
            </div>
          </div>
          <div style={{ ...overlayBox, pointerEvents: 'auto', padding: '6px 10px', flex: 1, minWidth: 120 }}>
            <div className="text-xs" style={{ fontWeight: 800, fontSize: '0.65rem' }}>⭐ {enemyName.toUpperCase()} {enemyCore ? `${Math.ceil(enemyCore.coreHp!)}/${enemyCore.maxCoreHp}` : ''}{enemyConnected === false && <span style={{ color: 'var(--amber-400)' }}> • ⚠ disconnected</span>}</div>
            <div style={{ height: 6, background: 'rgba(255,255,255,0.12)', borderRadius: 3, overflow: 'hidden', marginTop: 3 }}>
              <div style={{ width: `${enemyCorePct}%`, height: '100%', background: 'linear-gradient(90deg,#fb7185,#f43f5e)' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, pointerEvents: 'auto' }}>
            <button type="button" onClick={() => setShowShieldGrid(v => !v)} title={showShieldGrid ? 'Hide shield grid effects' : 'Show shield grid effects'}
              style={{ ...overlayBox, width: 40, height: 40, color: '#fff', fontSize: '1.1rem', fontWeight: 800, background: showShieldGrid ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.05)', border: showShieldGrid ? '1px solid rgba(74,222,128,0.4)' : 'var(--border)' }}>
              🔷
            </button>
            <button type="button" onClick={() => setHelpOpen(true)} title="How to play"
              style={{ ...overlayBox, width: 40, height: 40, color: '#fff', fontSize: '1.2rem', fontWeight: 800 }}>?</button>
            {fullscreenSupported && (
              <button type="button" onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                style={{ ...overlayBox, width: 40, height: 40, color: '#fff', fontSize: '1.1rem', fontWeight: 800 }}>
                {isFullscreen ? '🗗' : '⛶'}
              </button>
            )}
            <button type="button" onClick={() => setZoom(z => clampZoom(z * 1.25))} title="Zoom in"
              style={{ ...overlayBox, width: 40, height: 40, color: '#fff', fontSize: '1.2rem', fontWeight: 800 }}>+</button>
            <button type="button" onClick={() => setZoom(z => clampZoom(z * 0.8))} title="Zoom out"
              style={{ ...overlayBox, width: 40, height: 40, color: '#fff', fontSize: '1.2rem', fontWeight: 800 }}>−</button>
          </div>
        </div>

        {/* ── Targeting banner ── */}
        {supplyToast && !isTargeting && (
          <div style={{ position: 'absolute', top: 74, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none', display: 'flex', gap: 8, alignItems: 'center', background: 'rgba(0,0,0,0.72)', border: '1px solid rgba(74,222,128,0.6)', borderRadius: 12, padding: '8px 12px', whiteSpace: 'nowrap' }}>
            <span style={{ fontWeight: 800, color: '#4ade80', fontSize: '0.9rem' }}>{supplyToast}</span>
          </div>
        )}
        {isTargeting && (
          <div style={{ position: 'absolute', top: 74, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'auto', display: 'flex', gap: 8, alignItems: 'center', background: 'rgba(0,0,0,0.72)', border: '1px solid rgba(251,191,36,0.6)', borderRadius: 12, padding: '8px 12px', whiteSpace: 'nowrap' }}>
            <span style={{ fontWeight: 800, color: '#fbbf24', fontSize: '0.9rem', animation: 'mc-pulse 1s infinite' }}>
              🎯 TAP ENEMY SQUARE{targetType ? ` — ALL ${targetType.toUpperCase()}` : ''}
              {keepFireArmed && targetType ? ' · 🔒 WILL LOCK' : ''}
              {targetDesperation ? ' · ☢️ DESPERATION — ONE SHOT' : ''}
            </span>
            <button type="button" onClick={cancelTargeting}
              style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid var(--border)', borderRadius: 8, color: '#fff', fontWeight: 800, padding: '4px 10px' }}>✖</button>
          </div>
        )}

        {/* ── Launcher dock (toggleable horizontal/vertical) ── */}
        <div
          data-testid="launcher-dock"
          style={{
            position: 'absolute',
            // Horizontal: spans the bottom edge. Vertical: a column pinned to
            // the right side, starting below the top HUD (resource bars +
            // help/zoom buttons) so the two never overlap. `bottom` is always
            // 8 — omitting it in horizontal mode made the dock fall to its
            // static position, which sits past the overflow:hidden parent and
            // clips it away entirely.
            left: dockVertical ? undefined : 8,
            right: 8,
            top: dockVertical ? 76 : undefined,
            bottom: 8,
            width: dockVertical ? 160 : undefined,
            display: 'flex',
            flexDirection: dockVertical ? 'column' : 'row',
            gap: 6,
            pointerEvents: 'none',
          }}>
          {/* ── Keep-firing toggle (arms a locked target tile) ── */}
          <div style={{ display: 'flex', gap: 6, pointerEvents: 'auto', justifyContent: dockVertical ? 'center' : 'flex-end', flexDirection: dockVertical ? 'column' : 'row' }}>
            <button
              type="button"
              onClick={toggleKeepFire}
              title={
                myKeepFire
                  ? `Keep-firing is ON — every loaded missile hits (${myKeepFire.targetGx + 1}, ${myKeepFire.targetGy + 1}). Tap to stop.`
                  : keepFireArmed
                    ? 'Tap an enemy square to lock it as a keep-firing target'
                    : 'Tap to arm keep-firing, then pick an enemy square to lock it'
              }
              style={{
                padding: dockCompact ? '5px 9px' : '7px 13px', borderRadius: 999, fontWeight: 800,
                fontSize: dockCompact ? '0.68rem' : '0.74rem', color: '#fff',
                display: 'flex', alignItems: 'center', gap: 5,
                background: myKeepFire
                  ? 'rgba(74,222,128,0.24)'
                  : keepFireArmed ? 'rgba(251,191,36,0.22)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${myKeepFire ? 'rgba(74,222,128,0.75)' : keepFireArmed ? 'rgba(251,191,36,0.7)' : 'var(--border)'}`,
                animation: myKeepFire ? 'mc-pulse 1.2s infinite' : undefined,
                whiteSpace: 'nowrap',
              }}
            >
              <span>{myKeepFire ? '🔁 ON' : keepFireArmed ? '🎯 ARMED' : '🔁 KEEP FIRING'}</span>
              {myKeepFire && (
                <span style={{ opacity: 0.85, fontVariantNumeric: 'tabular-nums' }}>
                  ({myKeepFire.targetGx + 1},{myKeepFire.targetGy + 1}) {myKeepFire.launcherType === 'single' ? '🎯' : '💥'}
                </span>
              )}
            </button>
            {/* ── Desperation strike: one-time comeback warhead, unlocked at
                50% core HP. Shown always so the unlock condition is visible;
                greyed until armed, gone once spent. */}
            {!myDesperation.used && (
              <button
                type="button"
                onClick={() => { if (myDesperation.unlocked) startDesperationTargeting(); }}
                disabled={!myDesperation.unlocked}
                title={
                  myDesperation.unlocked
                    ? '☢️ Fire the desperation strike — 2000 dmg over a wide blast. ONE SHOT, pick the tile well.'
                    : '🔒 Unlocks when your core drops to 50% HP'
                }
                style={{
                  padding: dockCompact ? '5px 9px' : '7px 13px', borderRadius: 999, fontWeight: 800,
                  fontSize: dockCompact ? '0.68rem' : '0.74rem', color: '#fff',
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: myDesperation.unlocked ? 'rgba(244,63,94,0.24)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${myDesperation.unlocked ? 'rgba(244,63,94,0.7)' : 'var(--border)'}`,
                  animation: myDesperation.unlocked ? 'mc-pulse 1.2s infinite' : undefined,
                  whiteSpace: 'nowrap',
                  opacity: myDesperation.unlocked ? 1 : 0.55,
                  cursor: myDesperation.unlocked ? 'pointer' : 'not-allowed',
                }}
              >
                <span>{myDesperation.unlocked ? (targetDesperation ? '☢️ AIMING…' : '☢️ DESPERATION') : '🔒 DESPERATION'}</span>
              </button>
            )}
            {/* ── AUTO ALL: one tap flips every launcher's auto-load ── */}
            {myLaunchers.length > 0 && (
              <button
                type="button"
                onClick={() => onToggleAllAutobuild(!allAutobuild)}
                title={allAutobuild ? 'AUTO ALL ON — tap to stop auto-loading everywhere' : 'AUTO ALL OFF — tap to auto-load on every launcher'}
                style={{
                  padding: dockCompact ? '5px 9px' : '7px 13px', borderRadius: 999, fontWeight: 800,
                  fontSize: dockCompact ? '0.68rem' : '0.74rem', color: '#fff',
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: allAutobuild ? 'rgba(74,222,128,0.24)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${allAutobuild ? 'rgba(74,222,128,0.75)' : 'var(--border)'}`,
                  whiteSpace: 'nowrap',
                }}
              >
                <span>{allAutobuild ? '🤖 AUTO ALL' : '🤖 auto all'}</span>
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, pointerEvents: 'auto', justifyContent: dockVertical ? 'center' : 'flex-end', flexWrap: 'wrap', flexDirection: dockVertical ? 'column' : 'row' }}>
            {(['single', 'scatter'] as const).map(t => {
              const n = stockByType[t];
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => startTypeTargeting(t)}
                  title={n > 0 ? `Fire every loaded ${t} launcher at one square` : `No loaded ${t} launchers — load some first`}
                  style={{
                    padding: dockCompact ? '5px 9px' : '8px 14px', borderRadius: 999, fontWeight: 700, fontSize: dockCompact ? '0.68rem' : '0.75rem', color: '#fff',
                    background: n > 0 ? 'rgba(244,63,94,0.16)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${n > 0 ? 'rgba(244,63,94,0.45)' : 'var(--border)'}`,
                    opacity: n > 0 ? 0.95 : 0.55,
                  }}
                >
                  🔥 ALL {t === 'single' ? '🎯' : '💥'} ×{n}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setDockVertical(v => !v)}
              title={dockVertical ? 'Switch to horizontal dock (bottom)' : 'Switch to vertical dock (side)'}
              style={{
                padding: '8px 10px', borderRadius: 8, fontWeight: 700, fontSize: '0.7rem', color: '#fff',
                background: dockVertical ? 'rgba(74,222,128,0.2)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${dockVertical ? 'rgba(74,222,128,0.6)' : 'var(--border)'}`,
              }}
            >
              {dockVertical ? '↔️ Horizontal' : '↕️ Vertical'}
            </button>
          </div>
          <div className="mc-dock" style={{ display: 'flex', gap: dockCompact ? 3 : 6, overflowX: dockVertical ? 'hidden' : 'auto', overflowY: dockVertical ? 'auto' : 'hidden', pointerEvents: 'auto', scrollbarWidth: 'none', flexDirection: dockVertical ? 'column' : 'row', flexWrap: dockVertical ? 'nowrap' : 'wrap', alignItems: dockVertical ? 'stretch' : 'center', minHeight: dockVertical ? 'auto' : undefined, maxHeight: dockVertical ? '100%' : undefined }}>
            {myLaunchers.map(l => {
              const stock = l.stock ?? 0;
              const maxStock = l.maxStock ?? MAX_STOCK;
              const hasStock = stock > 0;
              const loadUntil = l.loadingUntil ?? 0;
              const loading = loadUntil > now;
              const loadSecsLeft = loading ? Math.max(0, (loadUntil - now) / 1000) : 0;
              const loadPct = loading ? Math.min(1, Math.max(0, 1 - (loadUntil - now) / (LOAD_SECONDS * 1000))) : 0;
              const stockFull = stock >= maxStock;
              const broke = myResources < (l.missileCost ?? 0);
              const loadLabel = stockFull ? 'FULL' : loading ? `${loadSecsLeft.toFixed(0)}s` : broke ? 'NO CR' : `＋${l.missileCost}cr`;
              return (
                <div
                  key={l.id}
                  style={{
                    minWidth: dockCompact ? 96 : 132,
                    background: 'rgba(4,8,18,0.88)',
                    border: `1px solid ${hasStock ? 'rgba(251,113,133,0.5)' : 'var(--border)'}`,
                    borderRadius: dockCompact ? 8 : 10,
                    padding: dockCompact ? 3 : 5,
                  }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => { if (hasStock) startTargeting(l.id); else setSelectedId(l.id); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { if (hasStock) startTargeting(l.id); else setSelectedId(l.id); } }}
                    title={hasStock ? 'Tap to pick a target and fire the volley' : 'Tap to open and load missiles'}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 4, color: '#fff', fontSize: dockCompact ? '0.66rem' : '0.72rem', fontWeight: 700, cursor: 'pointer' }}
                  >
                    <span style={{ fontSize: dockCompact ? '0.95rem' : '1.1rem' }}>{l.launcherType === 'single' ? '🎯' : '💥'}</span>
                    <span style={{ flex: 1, textAlign: 'left', whiteSpace: 'nowrap' }}>Lv{l.level}•{'●'.repeat(stock)}{'○'.repeat(Math.max(0, maxStock - stock))}</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onToggleAutobuild(l.id); }}
                      title={l.autobuild ? 'AUTO ON — tap to stop' : 'AUTO OFF — tap to auto-load'}
                      aria-label={l.autobuild ? 'Disable auto-load' : 'Enable auto-load'}
                      style={{ padding: dockCompact ? '1px 5px' : '2px 7px', borderRadius: 6, fontSize: dockCompact ? '0.6rem' : '0.66rem', fontWeight: 800, color: '#fff', background: l.autobuild ? 'rgba(74,222,128,0.25)' : 'rgba(255,255,255,0.06)', border: `1px solid ${l.autobuild ? 'rgba(74,222,128,0.6)' : 'var(--border)'}` }}
                    >
                      {l.autobuild ? 'A' : 'a'}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => onLoad({ launcherId: l.id })}
                    title={stockFull ? 'Stockpile full' : loading ? `Building… ${loadSecsLeft.toFixed(1)}s left` : broke ? `Need ${l.missileCost}cr` : `Build 1 missile (~${LOAD_SECONDS}s)`}
                    style={{ width: '100%', marginTop: 3, padding: dockCompact ? '3px 2px' : '5px 4px', borderRadius: 7, fontWeight: 800, fontSize: dockCompact ? '0.62rem' : '0.68rem', background: 'rgba(74,222,128,0.2)', border: '1px solid rgba(74,222,128,0.5)', color: '#fff' }}
                  >
                    {loading ? `🔨 ${loadSecsLeft.toFixed(0)}s` : loadLabel}
                  </button>
                  {loading && (
                    <div style={{ height: 2, background: 'rgba(255,255,255,0.1)', borderRadius: 2, marginTop: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${loadPct * 100}%`, background: 'linear-gradient(90deg,#4ade80,#22d3ee)' }} />
                    </div>
                  )}
                </div>
              );
            })}
            {myLaunchers.length === 0 && (
              <div className="text-xs text-muted" style={{ ...overlayBox, padding: '8px 12px', fontSize: '0.75rem' }}>
                👆 Tap an empty square on your island to build a launcher!
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Build popup ── */}
      {buildCell && !buildCellBuilding && (
        <Modal onClose={() => setBuildCell(null)} title={`🔨 Build (${buildCell.gx + 1}, ${buildCell.gy + 1})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {BUILD_CATEGORIES.map(cat => {
              const options = BUILD_OPTIONS.filter(o => o.category === cat.key);
              return (
                <div key={cat.key} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 4, borderBottom: '1px solid var(--border)', fontWeight: 800, fontSize: '0.85rem', color: 'var(--muted-foreground)' }}>
                    <span style={{ fontSize: '1.1rem' }}>{cat.icon}</span>
                    {cat.label}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                    {options.map(o => {
                      const afford = myResources >= o.cost;
                      return (
                        <button
                          key={o.key}
                          type="button"
                          onClick={() => { onBuild({ buildingType: o.buildingType, launcherType: o.launcherType, gx: buildCell.gx, gy: buildCell.gy }); setBuildCell(null); }}
                          disabled={!afford}
                          style={{
                            padding: '12px 8px', borderRadius: 'var(--radius-lg)', textAlign: 'center',
                            background: afford ? 'rgba(74,222,128,0.08)' : 'rgba(255,255,255,0.03)',
                            border: `2px solid ${afford ? 'rgba(74,222,128,0.4)' : 'var(--border)'}`,
                            color: '#fff', opacity: afford ? 1 : 0.55,
                          }}
                        >
                          <div style={{ fontSize: '1.8rem' }}>{o.emoji}</div>
                          <div style={{ fontWeight: 800, fontSize: '0.85rem', margin: '4px 0' }}>{o.label}</div>
                          <div style={{ fontWeight: 800, fontSize: '0.8rem', color: afford ? 'var(--amber-400)' : 'var(--rose-400)', marginBottom: 4 }}>{o.cost} credits • ⏱ 3s</div>
                          <div className="text-xs text-muted" style={{ lineHeight: 1.35 }}>{o.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {/* ── Building dialog (compact sheet — keeps the map visible) ── */}
      {selected && (
        <Modal compact onClose={() => setSelectedId(null)} title={`${BUILDING_META[selected.type].emoji} ${BUILDING_META[selected.type].name}${selected.type !== 'core' ? ` — Level ${selected.level}/5` : ''}`}>
          <BuildingPanel
            b={selected}
            isMine={selected.ownerId === myId}
            myResources={myResources}
            upgradeCost={upgradeCost}
            coreIncome={coreIncome}
            pendingUp={Object.values(mc.pending ?? {}).find(p => p.kind === 'upgrade' && p.upgradeOf === selected.id) ?? null}
            pendingSell={Object.values(mc.pending ?? {}).find(p => p.kind === 'sell' && p.sellOf === selected.id) ?? null}
            coverCount={selectedInfluence?.shields.length ?? 0}
            healerCount={selectedInfluence?.healers.length ?? 0}
            onUpgrade={() => { onUpgrade(selected.id); setSelectedId(null); }}
            onSell={() => onSell(selected.id)}
            onCancelSell={() => onCancelSell(selected.id)}
            onLoad={() => onLoad({ launcherId: selected.id })}
            onToggleAutobuild={() => onToggleAutobuild(selected.id)}
            onFire={() => startTargeting(selected.id)}
          />
        </Modal>
      )}

      {/* ── Help modal ── */}
      {helpOpen && (
        <Modal onClose={() => setHelpOpen(false)} title="❓ How to play">
          <div className="text-sm text-muted" style={{ lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>👆 <b>Tap an empty square</b> on your island to build (Generator +2/s, Shield 300 HP, Shield Healer 8/s). On touch screens, <b>long-press</b> instead — a quick tap only closes panels.</div>
            <div>🏠 <b>Tap any building</b> for stats, upgrades &amp; fire control. Gold ★ show its level.</div>
            <div>⭐ Your <b>Core pays +{coreIncome}/s</b> — destroy the enemy Core (4000 HP) to win!</div>
            <div>🛡️ Shields <b>fully block</b> blasts while charged (≈ 25 covered squares). Empty covered squares still drain the shield. Hide Generators inside!</div>
            <div>💚 Shield Healers fix <b>one shield at a time</b> (weakest first — green beam shows it).</div>
            <div>🚢 If supply ships are on, a freighter crosses the channel — <b>tap it first</b> for credits, a missile rain, or 2x build speed. Rewards scale up when behind!</div>
            <div>🚀 <b>Load up to {MAX_STOCK} missiles</b> per launcher ({LOAD_SECONDS}s each, ＋ or AUTO), then <b>FIRE the volley</b> — or <b>🔥 ALL</b> of one type at once! 🤖 AUTO ALL flips every launcher at once.</div>
            <div>💥 <b>Scatter does the most total damage</b> — best shield-breaker. Single is precise.</div>
            <div>⏱ Buildings take time: <b>3s → 5s → 10s → 20s → 30s</b> by level. Build many in parallel!</div>
            <div>🖱 <b>Drag</b> to pan, <b>wheel/pinch</b> to zoom.</div>
            <div className="text-xs" style={{ opacity: 0.5 }}>build {BUILD_ID.slice(0, 8)}</div>
          </div>
        </Modal>
      )}

      {/* ── End overlay ── */}
      {roomState.phase === 'missile-command-end' && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div className="glass p-24 text-center animate-fade-up" style={{ borderRadius: 'var(--radius-xl)', maxWidth: 560, width: '100%', maxHeight: '88vh', overflowY: 'auto', border: `2px solid ${iWon ? 'rgba(74,222,128,0.5)' : 'rgba(244,63,94,0.5)'}` }}>
            <div style={{ fontSize: '3rem' }}>{mc.winReason === 'draw' ? '🤝' : iWon ? '🏆' : '💥'}</div>
            <h2 className="heading-lg">{mc.winReason === 'draw' ? 'DRAW — both Cores destroyed!' : iWon ? 'VICTORY! Enemy Core destroyed!' : `${winnerName ?? 'Enemy'} wins — your Core was destroyed`}</h2>
            <p className="text-muted text-sm">Your final credits: {myResources}</p>
            <div style={{ marginTop: 12 }}>
              <MissileCommandStats mc={mc} players={roomState.players} myId={myId} />
            </div>
            {isHost && (
              <button type="button" className="btn btn-primary mt-16" onClick={onPlayAgain}>🔄 Back to Lobby</button>
            )}
            {!isHost && <p className="text-xs text-muted mt-16">Waiting for host to return to lobby…</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// A name placard floating in the channel between the two islands. `dir` is
// which shore it belongs to, so the little notch points at that island.
function IslandPlacard({ y, name, mine, dir, color }: {
  y: number; name: string; mine: boolean; dir: 'up' | 'down'; color: string;
}) {
  const FS = 25;
  const H = 44;
  const label = mine ? `🏠 ${name} · YOU` : `⚔ ${name}`;
  // Rough text metrics — enough to size the pill without measuring the DOM.
  const W = Math.max(240, label.length * FS * 0.58 + 44);
  const cx = WORLD / 2;
  const baseY = dir === 'up' ? y - H / 2 : y + H / 2;
  const tipY = dir === 'up' ? baseY - 20 : baseY + 20;
  return (
    <g pointerEvents="none">
      <polygon
        points={`${cx - 14},${baseY} ${cx + 14},${baseY} ${cx},${tipY}`}
        fill="rgba(4,10,22,0.85)" stroke={color} strokeWidth={2} strokeLinejoin="round"
      />
      <rect
        x={cx - W / 2} y={y - H / 2} width={W} height={H} rx={H / 2}
        fill="rgba(4,10,22,0.85)" stroke={color} strokeWidth={2.5}
      />
      <text
        x={cx} y={y} textAnchor="middle" dominantBaseline="central"
        fill={color} fontSize={FS} fontWeight={800}
        stroke="rgba(0,0,0,0.75)" strokeWidth={3.5} paintOrder="stroke"
      >
        {label}
      </text>
    </g>
  );
}

function Modal({ title, onClose, children, compact }: { title: string; onClose: () => void; children: React.ReactNode; compact?: boolean }) {
  // Escape closes too (mobile hardware back / desktop keyboards).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      onClick={onClose}
      style={{
        // Transparent scrim: still catches outside clicks to close, but does
        // NOT dim the map — you keep reading the board while inspecting a
        // tile or building. The sheet's own border/blur carries the depth.
        position: 'fixed', inset: 0, zIndex: 500, background: 'transparent',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 12,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass animate-fade-up"
        style={{
          // Compact sheets (building dialog) stay small so most of the map
          // stays visible; full sheets (build menu, help) keep their size.
          width: '100%', maxWidth: compact ? 400 : 560,
          maxHeight: compact ? '46vh' : '82vh', overflowY: 'auto',
          borderRadius: 'var(--radius-xl)', padding: compact ? 14 : 20,
          background: 'rgba(13,18,32,0.97)',
          border: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: compact ? 8 : 12 }}>
          <span style={{ fontWeight: 800, fontSize: compact ? '0.95rem' : '1.05rem' }}>{title}</span>
          <button type="button" onClick={onClose} aria-label="Close dialog"
            style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', color: '#fff', fontSize: '1rem', fontWeight: 800 }}>
            ✖
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function BuildingPanel({ b, isMine, myResources, upgradeCost, coreIncome, pendingUp, pendingSell, coverCount, healerCount, onUpgrade, onSell, onCancelSell, onLoad, onToggleAutobuild, onFire }: {
  b: MissileBuilding;
  isMine: boolean;
  myResources: number;
  upgradeCost: number | null;
  coreIncome: number;
  pendingUp: { targetLevel: number; completeAt: number } | null;
  pendingSell: { completeAt: number; refund?: number } | null;
  coverCount?: number;
  healerCount?: number;
  onUpgrade: () => void;
  onSell: () => void;
  onCancelSell: () => void;
  onLoad: () => void;
  onToggleAutobuild: () => void;
  onFire: () => void;
}) {
  const rows: Array<[string, string]> = [];
  if (isMine && (coverCount || healerCount)) {
    const bits: string[] = [];
    if (coverCount) bits.push(`🛡️ ×${coverCount} covering`);
    if (healerCount) bits.push(`💚 ×${healerCount} in heal range`);
    rows.push(['🔗 Protection', bits.join(' • ') + ' — highlighted on the map']);
  }
  if (b.type === 'economy') {
    rows.push(['💰 Income', `+${b.incomePerSec}/s${b.level < 5 ? ` (Lv${b.level + 1} → +${STATS.economy.income[b.level + 1]}/s)` : ' (MAX)'}`]);
    rows.push(['❤ Structure', `${Math.ceil(b.hp ?? 0)} / ${b.maxHp} HP`]);
    rows.push(['📍 Square', `(${b.gx + 1}, ${b.gy + 1}) — 1×1`]);
  } else if (b.type === 'shield' || b.type === 'shield_heavy') {
    const heavy = b.type === 'shield_heavy';
    const range = b.shieldTiles ?? (heavy ? 2 : 3);
    const table = heavy ? STATS.shield_heavy.hp : STATS.shield.hp;
    rows.push(['🛡️ Shield pool', `${Math.ceil(b.shieldHp ?? 0)} / ${b.maxShieldHp}${b.level < 5 ? ` (Lv${b.level + 1} → ${table[b.level + 1]})` : ' (MAX)'}`]);
    rows.push(['📏 Coverage', `≈ ${range === 2 ? SHIELD_HEAVY_COVER_CELLS : SHIELD_COVER_CELLS} squares (range ${range}, no diagonals)`]);
    rows.push(['🧱 Blocking', 'Full block while charged — overflow only. Even empty squares drain it.']);
    rows.push(['🔗 Overlap', 'Fullest % pool absorbs first, overflow spills to the next fullest.']);
    rows.push(['💚 Self-repair', `+${+(STATS.healer.heal[b.level] / 8).toFixed(1)}/s (1/8 of healer)`]);
    rows.push(['❤ Structure', `${Math.ceil(b.hp ?? 0)} / ${b.maxHp} HP`]);
  } else if (b.type === 'healer') {
    rows.push(['💚 Heal rate', `${b.healPerSec}/s${b.level < 5 ? ` (Lv${b.level + 1} → ${STATS.healer.heal[b.level + 1]}/s)` : ' (MAX)'}`]);
    rows.push(['🎯 Repairs', 'ONE shield at a time — weakest % in range']);
    rows.push(['📏 Coverage', `≈ ${HEALER_COVER_CELLS} squares (range 2, no diagonals)`]);
    rows.push(['❤ Structure', `${Math.ceil(b.hp ?? 0)} / ${b.maxHp} HP`]);
  } else if (b.type === 'launcher') {
    const key = b.launcherType === 'single' ? 'single' : 'scatter';
    const tbl = STATS[key];
    const blastTxt = b.launcherType === 'single'
      ? '1 square per missile'
      : 'plus of 5 squares — HIGHEST total damage, best shield-breaker';
    const stock = b.stock ?? 0;
    const maxStock = b.maxStock ?? MAX_STOCK;
    const loading = (b.loadingUntil ?? 0) > Date.now();
    rows.push(['📦 Stockpile', `${'●'.repeat(stock)}${'○'.repeat(Math.max(0, maxStock - stock))} ${stock}/${maxStock} loaded${loading ? ' (+1 building…)' : ''}`]);
    rows.push(['🚀 Missile', `${b.launcherType} — ${b.missileDamage} dmg / ${b.missileCost}cr each`]);
    rows.push(['💥 Blast', blastTxt]);
    rows.push(['🔨 Build time', `${LOAD_SECONDS}s per missile (one at a time)`]);
    if (b.level < 5) rows.push(['⬆ Next level', `dmg ${tbl.dmg[b.level + 1]} • ${tbl.cost[b.level + 1]}cr/missile`]);
  } else if (b.type === 'core') {
    rows.push(['⭐ Core HP', `${Math.ceil(b.coreHp ?? 0)} / ${b.maxCoreHp}`]);
    rows.push(['💰 Income', `+${coreIncome}/s baseline economy`]);
    rows.push(['💚 Regen', `+${b.coreRegenPerSec}/s (slow — keep shields up!)`]);
  }
  const loadUntil = (b.loadingUntil ?? 0);
  const loading = b.type === 'launcher' && loadUntil > Date.now();
  const loadSecsLeft = loading ? Math.max(0, (loadUntil - Date.now()) / 1000) : 0;
  const loadPct = loading ? Math.min(1, Math.max(0, 1 - (loadUntil - Date.now()) / (LOAD_SECONDS * 1000))) : 0;
  const stock = b.stock ?? 0;
  const maxStock = b.maxStock ?? MAX_STOCK;
  const stockFull = stock >= maxStock;
  const broke = myResources < (b.missileCost ?? 0);
  const upSecs = pendingUp ? Math.max(0, (pendingUp.completeAt - Date.now()) / 1000) : 0;
  const nextUpSecs = b.level < 5 ? (BUILD_SECONDS[b.level + 1] ?? 5) : 0;
  return (
    <div>
      {!isMine && <div className="badge badge-rose" style={{ marginBottom: 8 }}>ENEMY BUILDING</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 }}>
        {rows.map(([k, v], i) => (
          <div key={i} className="text-sm" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 10, fontSize: '0.82rem' }}>
            <span className="text-muted">{k}</span><span style={{ fontWeight: 700, textAlign: 'right' }}>{v}</span>
          </div>
        ))}
      </div>
      {isMine && b.type !== 'core' && (
        <button
          type="button"
          className={`btn btn-full ${!pendingUp && upgradeCost !== null && myResources >= upgradeCost ? 'btn-primary' : 'btn-secondary'}`}
          disabled={!!pendingUp || upgradeCost === null || myResources < upgradeCost}
          onClick={onUpgrade}
          style={{ marginBottom: 8, padding: '10px' }}
        >
          {pendingUp
            ? `⏳ Upgrading to Lv${pendingUp.targetLevel}… ${upSecs.toFixed(0)}s left`
            : upgradeCost === null ? '⭐ MAX LEVEL' : `⬆ Upgrade to Lv${b.level + 1} (${upgradeCost}cr, ${nextUpSecs}s)`}
        </button>
      )}
      {isMine && b.type !== 'core' && (
        pendingSell ? (
          <div style={{ marginBottom: 8, padding: '10px 12px', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.4)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '0.85rem', marginBottom: 6 }}>
              <span>💰 Demolishing… +{pendingSell.refund ?? sellRefundFor(b)}cr</span>
              <span>{Math.max(0, (pendingSell.completeAt - Date.now()) / 1000).toFixed(0)}s</span>
            </div>
            <button type="button" onClick={onCancelSell}
              style={{ width: '100%', padding: '8px', borderRadius: 8, fontWeight: 800, fontSize: '0.8rem', color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)' }}>
              Keep building
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-full btn-secondary"
            disabled={!!pendingUp}
            title={pendingUp ? 'Finish the upgrade first (or wait for it to complete)' : `Demolish over ${SELL_SECONDS}s for 70% back (+${sellRefundFor(b)}cr)`}
            onClick={onSell}
            style={{ marginBottom: 8, padding: '10px', opacity: pendingUp ? 0.5 : 1 }}
          >
            {`💰 Sell (+${sellRefundFor(b)}cr, ${SELL_SECONDS}s)`}
          </button>
        )
      )}
      {isMine && b.type === 'launcher' && (
        loading ? (
          <div style={{ marginBottom: 8, padding: '12px 14px', background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.4)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '0.9rem', marginBottom: 6 }}>
              <span>🔨 Building missile…</span>
              <span>{loadSecsLeft.toFixed(1)}s</span>
            </div>
            <div style={{ height: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${loadPct * 100}%`, background: 'linear-gradient(90deg,#4ade80,#22d3ee)', transition: 'width 0.2s linear' }} />
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-full btn-secondary"
            onClick={onLoad}
            style={{ marginBottom: 8, padding: '10px' }}
            title={stockFull ? 'Stockpile full' : broke ? `Need ${b.missileCost}cr` : `Build 1 missile for ${b.missileCost}cr (~${LOAD_SECONDS}s)`}
          >
            {stockFull ? `📦 Stockpile full (${maxStock}/${maxStock})` : broke ? `🔨 Build missile — need ${b.missileCost}cr` : `🔨 Build missile (${b.missileCost}cr)`}
          </button>
        )
      )}
      {isMine && b.type === 'launcher' && (
        <button
          type="button"
          onClick={onToggleAutobuild}
          title={b.autobuild ? 'AUTO ON — tap to stop auto-loading missiles' : 'AUTO OFF — tap to auto-load whenever affordable'}
          style={{
            width: '100%', marginBottom: 8, padding: '10px 12px', borderRadius: 'var(--radius-md)',
            fontWeight: 800, fontSize: '0.9rem', color: '#fff',
            background: b.autobuild ? 'rgba(74,222,128,0.18)' : 'rgba(255,255,255,0.04)',
            border: `2px solid ${b.autobuild ? 'rgba(74,222,128,0.6)' : 'var(--border)'}`,
          }}
        >
          {b.autobuild ? 'AUTO: ON (tap to stop)' : 'AUTO: OFF (tap to auto-load)'}
        </button>
      )}
      {isMine && b.type === 'launcher' && (
        <button type="button" className="btn btn-full btn-rose" onClick={onFire} disabled={stock <= 0} style={{ padding: '10px', opacity: stock <= 0 ? 0.5 : 1 }}>
          {stock <= 0 ? '🎯 No missiles — build some first' : `🎯 FIRE VOLLEY ×${stock}`}
        </button>
      )}
    </div>
  );
}
