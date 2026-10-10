// missileCommand/MissileCommandGame.tsx — SILO'D UI for Missile Command.
// Full-screen grid map with pan/zoom + touch support. Remove this folder to remove the game.
//
// Interaction model:
// - Tap an empty square on YOUR island → build popup with all options.
// - Tap any building → dialog with its stats + upgrade (own) / load / fire.
// - FIRE (volley) or ALL-type → targeting banner → tap an enemy square.

import { memo, useEffect, useRef, useState } from 'react';
import type {
  RoomState,
  MissileBuilding,
  MissileInFlight,
  MissileLauncherType,
  MissileBuildAction,
  MissileLaunchAction,
  MissileTypeLaunchAction,
  MissileLoadAction,
} from '../../types/game';
import { WORLD, TOP_RECT, BOTTOM_RECT, cellRect, BUILD_OPTIONS, STATS, BUILDING_META, upgradeCostFor, SHIELD_COVER_CELLS, HEALER_COVER_CELLS, CORE_INCOME_FALLBACK, MAX_STOCK, BUILD_SECONDS, LOAD_SECONDS } from './config';
import { BUILD_ID } from '../../buildInfo';

interface Props {
  roomState: RoomState;
  myId: string;
  isHost: boolean;
  onBuild: (action: MissileBuildAction) => void;
  onUpgrade: (buildingId: string) => void;
  onLoad: (action: MissileLoadAction) => void;
  onToggleAutobuild: (launcherId: string) => void;
  onLaunch: (action: MissileLaunchAction) => void;
  onLaunchType: (action: MissileTypeLaunchAction) => void;
  onPlayAgain: () => void;
}

interface Cell { side: 'top' | 'bottom'; gx: number; gy: number; }
interface Flash { id: number; x: number; y: number; kind: string; expires: number; }

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

export default function MissileCommandGame({ roomState, myId, isHost, onBuild, onUpgrade, onLoad, onToggleAutobuild, onLaunch, onLaunchType, onPlayAgain }: Props) {
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
  const fullscreenSupported = typeof document !== 'undefined' &&
    (document.fullscreenEnabled || (document as unknown as { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled);
  const [, setFrame] = useState(0);
  const [flashes, setFlashes] = useState<Flash[]>([]);

  const gestureRef = useRef({
    // Per-pointer tracking: a stationary resting thumb must not cancel a
    // quick tap from another finger. A tap = this finger was quick + still
    // while every other active finger stayed still.
    pointers: new Map<number, { x: number; y: number; downX: number; downY: number; downT: number; moved: boolean; tol: number }>(),
    pinchDist: 0,
    pinchZoom: 1,
  });
  const TAP_TOL = 32; // px total travel allowed for a touch tap
  const TAP_MAX_MS = 600;
  const prevMissilesRef = useRef<Map<string, MissileInFlight>>(new Map());
  const snapRef = useRef<{ missiles: MissileInFlight[]; at: number }>({ missiles: [], at: Date.now() });

  const mcMissiles = mc?.missiles ?? [];

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
  }, [mc, mcMissiles]);

  // ── Snapshot missiles for smooth client-side interpolation ──
  useEffect(() => {
    if (mc) snapRef.current = { missiles: mc.missiles.map(m => ({ ...m })), at: Date.now() };
  }, [mc, mcMissiles]);

  // ── Throttled frame loop (~10fps; server ticks at 4Hz) ──
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last > 100) {
        last = t;
        setFrame(f => f + 1);
        setFlashes(f => (f.length ? f.filter(fl => fl.expires > Date.now()) : f));
      }
      raf = requestAnimationFrame(loop);
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

  if (!mc) {
    return (
      <div className="page text-center">
        <div className="spinner" />
        <p className="text-muted mt-16">Initializing Missile Command...</p>
      </div>
    );
  }

  const cols = mc.gridCols || 13;
  const rows = mc.gridRows || 7;
  const shieldTiles = mc.shieldTiles ?? 3;
  const healerTiles = mc.healerTiles ?? 2;
  const coreIncome = mc.coreIncomePerSec ?? CORE_INCOME_FALLBACK;

  const mySide = mc.sides.top === myId ? 'top' : mc.sides.bottom === myId ? 'bottom' : null;
  const myResources = Math.floor(mc.resources[myId] ?? 0);
  const enemyId = mySide ? (mySide === 'top' ? mc.sides.bottom : mc.sides.top) : null;

  const buildings = Object.values(mc.buildings);
  const byCell = new Map<string, MissileBuilding>();
  for (const b of buildings) byCell.set(`${b.side}:${b.gx}:${b.gy}`, b);
  // Cheap string signatures so the memoized grids skip re-renders on ticks.
  let occSigTop = '', occSigBottom = '';
  for (const b of buildings) {
    if (b.side === 'top') occSigTop += `${b.gx},${b.gy}|`;
    else occSigBottom += `${b.gx},${b.gy}|`;
  }
  const selected: MissileBuilding | null = (selectedId && mc.buildings[selectedId]) || null;
  const selCellKey = selected ? { side: selected.side, key: `${selected.gx},${selected.gy}` } : null;
  const myBuildings = buildings.filter(b => b.ownerId === myId);
  const myCore = buildings.find(b => b.type === 'core' && b.side === mySide);
  const enemyCore = buildings.find(b => b.type === 'core' && b.side !== mySide);
  const myEcoIncome = myBuildings.filter(b => b.type === 'economy').reduce((s, b) => s + (b.incomePerSec ?? 0), 0);
  const myIncome = myEcoIncome + (myCore && (myCore.coreHp ?? 0) > 0 ? coreIncome : 0);
  const myLaunchers = myBuildings.filter(b => b.type === 'launcher');
  const stockByType: Record<MissileLauncherType, number> = {
    single: myLaunchers.filter(l => l.launcherType === 'single').reduce((s, l) => s + (l.stock ?? 0), 0),
    scatter: myLaunchers.filter(l => l.launcherType === 'scatter').reduce((s, l) => s + (l.stock ?? 0), 0),
  };

  const enemyName = enemyId ? (roomState.players.find(p => p.id === enemyId)?.name ?? 'Enemy') : 'Enemy';
  const winnerName = mc.winnerId ? (roomState.players.find(p => p.id === mc.winnerId)?.name ?? '???') : null;
  const iWon = mc.winnerId === myId;
  const isTargeting = targetLauncherId !== null || targetType !== null;

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
  }

  function handleTap(wx: number, wy: number) {
    if (!mySide) return;
    const cell = worldToCell(wx, wy, cols, rows);
    if (!cell) { setBuildCell(null); setSelectedId(null); return; }

    // 1. Targeting → strike enemy square (single launcher or whole type)
    if (targetLauncherId || targetType) {
      if (cell.side !== mySide) {
        if (targetLauncherId) onLaunch({ launcherId: targetLauncherId, targetGx: cell.gx, targetGy: cell.gy });
        else if (targetType) onLaunchType({ launcherType: targetType, targetGx: cell.gx, targetGy: cell.gy });
        cancelTargeting();
      }
      return;
    }

    // 2. Building tapped → open dialog
    const b = byCell.get(`${cell.side}:${cell.gx}:${cell.gy}`);
    if (b) {
      setBuildCell(null);
      setSelectedId(b.id);
      return;
    }

    // 3. Empty own square → build popup. Enemy empties do nothing.
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
    g.pointers.set(e.pointerId, {
      x: e.clientX, y: e.clientY,
      downX: e.clientX, downY: e.clientY,
      downT: Date.now(), moved: false,
      tol: e.pointerType === 'touch' ? TAP_TOL : 10,
    });
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()];
      g.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      g.pinchZoom = zoom;
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    const g = gestureRef.current;
    const p = g.pointers.get(e.pointerId);
    if (!p) return;
    const prevX = p.x, prevY = p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (Math.hypot(p.x - p.downX, p.y - p.downY) > p.tol) p.moved = true;
    const svg = svgRef.current;
    const rect = svg?.getBoundingClientRect();
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
    const g = gestureRef.current;
    const me = g.pointers.get(e.pointerId);
    g.pointers.delete(e.pointerId);
    if (me && !me.moved && Date.now() - me.downT < TAP_MAX_MS) {
      // Tap only if every REMAINING finger is also still (resting thumbs OK,
      // real pinches involve two moving fingers).
      if ([...g.pointers.values()].every(p => !p.moved)) {
        const w = toWorld(e.clientX, e.clientY);
        handleTap(w.x, w.y);
      }
    }
  }

  function startTargeting(launcherId: string) {
    setTargetLauncherId(launcherId);
    setTargetType(null);
    setSelectedId(null);
    setBuildCell(null);
  }
  function startTypeTargeting(t: MissileLauncherType) {
    setTargetType(t);
    setTargetLauncherId(null);
    setSelectedId(null);
    setBuildCell(null);
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
    }}
    onContextMenu={(e) => e.preventDefault()}
    >
      <style>{`
        @keyframes mc-pulse { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
        .mc-beam { animation: mc-beam-flow 0.7s linear infinite; }
        @keyframes mc-beam-flow { to { stroke-dashoffset: -18; } }
        .mc-march { animation: mc-march-flow 1.1s linear infinite; }
        @keyframes mc-march-flow { to { stroke-dashoffset: -38; } }
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
          </defs>

          {/* Ocean */}
          <rect x={-100} y={-100} width={WORLD + 200} height={WORLD + 200} fill="url(#mc-water)" />
          {[420, 460, 500, 540, 580].map(y => (
            <line key={y} x1={-100} y1={y} x2={WORLD + 100} y2={y} stroke="rgba(56,189,248,0.15)" strokeWidth={2} strokeDasharray="24 18" />
          ))}

          {/* Island bases */}
          <rect x={TOP_RECT.x} y={TOP_RECT.y} width={TOP_RECT.w} height={TOP_RECT.h} rx={40} fill="url(#mc-top)" stroke={mySide === 'top' ? '#a3e635' : '#fb7185'} strokeWidth={mySide === 'top' ? 5 : 3} />
          <rect x={BOTTOM_RECT.x} y={BOTTOM_RECT.y} width={BOTTOM_RECT.w} height={BOTTOM_RECT.h} rx={40} fill="url(#mc-bottom)" stroke={mySide === 'bottom' ? '#22d3ee' : '#fb7185'} strokeWidth={mySide === 'bottom' ? 5 : 3} />
          <text x={WORLD / 2} y={44} textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize={24} fontWeight={800}>
            {mySide === 'top' ? '🏠 YOUR ISLAND' : `⚔ ${enemyName.toUpperCase()}'S ISLAND`} 🔼
          </text>
          <text x={WORLD / 2} y={962} textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize={24} fontWeight={800}>
            {mySide === 'bottom' ? '🏠 YOUR ISLAND' : `⚔ ${enemyName.toUpperCase()}'S ISLAND`} 🔽
          </text>

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

          {/* Shield coverage — every covered tile highlighted.
              Selected shields go full spotlight: brighter tiles + marching
              boundary + pulsing glow on the generator itself. */}
          {buildings.filter(b => b.type === 'shield').map(b => {
            const isMine = b.ownerId === myId;
            const pct = (b.shieldHp ?? 0) / (b.maxShieldHp ?? 1);
            const isSel = selected?.id === b.id;
            const tint = isMine ? '56,189,248' : '251,113,133';
            const edge = isMine ? '#7dd3fc' : '#fda4af';
            const cells = coveredCells(b.gx, b.gy, shieldTiles, cols, rows);
            return (
              <g key={`sh-${b.id}`} pointerEvents="none">
                {cells.map(c => {
                  const r = cellRect(b.side, c.gx, c.gy, cols, rows);
                  return (
                    <rect key={`${c.gx}-${c.gy}`} x={r.x + 2} y={r.y + 2} width={r.w - 4} height={r.h - 4} rx={7}
                      fill={`rgba(${tint},${pct <= 0 ? 0.04 : isSel ? 0.45 : 0.16})`}
                      stroke={`rgba(${tint},${pct <= 0 ? 0.3 : isSel ? 1 : 0.7})`} strokeWidth={isSel ? 2.5 : 1.5}
                      strokeDasharray={pct <= 0 ? '5 7' : undefined} />
                  );
                })}
                {isSel && pct > 0 && (
                  <path d={coverageOutlinePath(b.side, cells, cols, rows)}
                    fill="none" stroke={edge} strokeWidth={3.5} strokeDasharray="14 5" className="mc-march" strokeLinejoin="round" />
                )}
              </g>
            );
          })}

          {/* Shield Healer coverage — only while selected, full spotlight */}
          {buildings.filter(b => b.type === 'healer' && b.ownerId === myId && selected?.id === b.id).map(b => {
            const cells = coveredCells(b.gx, b.gy, healerTiles, cols, rows);
            return (
              <g key={`he-${b.id}`} pointerEvents="none">
                {cells.map(c => {
                  const r = cellRect(b.side, c.gx, c.gy, cols, rows);
                  return (
                    <rect key={`${c.gx}-${c.gy}`} x={r.x + 2} y={r.y + 2} width={r.w - 4} height={r.h - 4} rx={7}
                      fill="rgba(74,222,128,0.45)"
                      stroke="rgba(74,222,128,1)" strokeWidth={2.5} />
                  );
                })}
                <path d={coverageOutlinePath(b.side, cells, cols, rows)}
                  fill="none" stroke="#86efac" strokeWidth={3.5} strokeDasharray="14 5" className="mc-march" strokeLinejoin="round" />
              </g>
            );
          })}

          {/* Heal effect (visible to BOTH players): beam + pulses + ripple */}
          {buildings.filter(b => b.type === 'healer' && b.healTargetId).map(h => {
            const t = mc.buildings[h.healTargetId!];
            if (!t) return null;
            const hr = cellRect(h.side, h.gx, h.gy, cols, rows);
            const tr = cellRect(t.side, t.gx, t.gy, cols, rows);
            const mx = (hr.cx + tr.cx) / 2, my = (hr.cy + tr.cy) / 2;
            const path = `M ${hr.cx} ${hr.cy} L ${tr.cx} ${tr.cy}`;
            return (
              <g key={`beam-${h.id}`} pointerEvents="none">
                <line x1={hr.cx} y1={hr.cy} x2={tr.cx} y2={tr.cy}
                  stroke="#4ade80" strokeWidth={9} strokeLinecap="round" opacity={0.22} />
                <line x1={hr.cx} y1={hr.cy} x2={tr.cx} y2={tr.cy}
                  stroke="#bbf7d0" strokeWidth={3.5} strokeLinecap="round"
                  strokeDasharray="10 8" className="mc-beam" opacity={0.95} />
                <circle r={6} fill="#4ade80" opacity={0.95}>
                  <animateMotion dur="1.1s" repeatCount="indefinite" path={path} />
                </circle>
                <circle r={6} fill="#bbf7d0" opacity={0.95}>
                  <animateMotion dur="1.1s" begin="-0.55s" repeatCount="indefinite" path={path} />
                </circle>
                <circle cx={tr.cx} cy={tr.cy} r={10} fill="none" stroke="#4ade80" strokeWidth={3}>
                  <animate attributeName="r" values="10;30" dur="1.3s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.8;0" dur="1.3s" repeatCount="indefinite" />
                </circle>
                <circle cx={tr.cx} cy={tr.cy} r={10} fill="none" stroke="#bbf7d0" strokeWidth={2}>
                  <animate attributeName="r" values="10;30" dur="1.3s" begin="-0.65s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.6;0" dur="1.3s" begin="-0.65s" repeatCount="indefinite" />
                </circle>
                <circle cx={mx} cy={my} r={14} fill="rgba(6,40,20,0.85)" stroke="#4ade80" strokeWidth={2} />
                <text x={mx} y={my} textAnchor="middle" dominantBaseline="central" fontSize={15} fontWeight={900}>💚</text>
              </g>
            );
          })}

          {/* Missiles in flight (interpolated, fanned by lane).
              Kept to 3 lean nodes each (trail, head, target) with no CSS
              animations so big scatter volleys stay smooth. */}
          {snapRef.current.missiles.map(m => {
            const elapsed = Math.min(12, (Date.now() - snapRef.current.at) / 1000);
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
            const col = m.launcherType === 'single' ? '#fbbf24' : '#fb7185';
            const armed = (m.deployAt ?? 0) <= Date.now();
            const tc = cellRect(m.ownerId === mc.sides.top ? 'bottom' : 'top', m.targetGx, m.targetGy, cols, rows);
            return (
              <g key={m.id} pointerEvents="none" opacity={armed ? 1 : 0.45}>
                <line x1={sx + ox} y1={sy + oy} x2={px} y2={py} stroke={col} strokeWidth={3} opacity={0.5} />
                <text x={px} y={py} textAnchor="middle" dominantBaseline="central" fontSize={armed ? 22 : 15}>{armed ? '🚀' : '⏳'}</text>
                <rect x={tc.x + 2} y={tc.y + 2} width={tc.w - 4} height={tc.h - 4} rx={8}
                  fill="none" stroke={col} strokeWidth={2} strokeDasharray="6 5" opacity={0.8} />
              </g>
            );
          })}

          {/* Impact flashes */}
          {flashes.map(f => (
            <g key={f.id} opacity={Math.max(0, (f.expires - Date.now()) / 700)} pointerEvents="none">
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
            const shieldPct = b.type === 'shield' ? (b.shieldHp! / b.maxShieldHp!) : 1;
            const emoji = b.type === 'launcher' ? (b.launcherType === 'single' ? '🎯' : '💥') : b.type === 'core' ? '⭐' : meta.emoji;
            return (
              <g key={b.id} pointerEvents="none">
                {isSel && (
                  <rect x={r.x - 2} y={r.y - 2} width={r.w + 4} height={r.h + 4} rx={12}
                    fill="none" stroke="#fff" strokeWidth={3.5} strokeDasharray="10 7" />
                )}
                    {isSel && (b.type === 'shield' || b.type === 'healer') && (
                      <g pointerEvents="none">
                        <circle cx={r.cx} cy={r.cy} r={Math.min(r.w, r.h) * 0.42} fill="none"
                          stroke={b.type === 'shield' ? '#7dd3fc' : '#86efac'} strokeWidth={3}>
                          <animate attributeName="r" values={`${Math.min(r.w, r.h) * 0.42};${Math.min(r.w, r.h) * 0.62}`} dur="1.2s" repeatCount="indefinite" />
                          <animate attributeName="opacity" values="0.9;0" dur="1.2s" repeatCount="indefinite" />
                        </circle>
                        <circle cx={r.cx} cy={r.cy} r={Math.min(r.w, r.h) * 0.42} fill="none"
                          stroke="#ffffff" strokeWidth={1.5}>
                          <animate attributeName="r" values={`${Math.min(r.w, r.h) * 0.42};${Math.min(r.w, r.h) * 0.62}`} dur="1.2s" begin="-0.6s" repeatCount="indefinite" />
                          <animate attributeName="opacity" values="0.7;0" dur="1.2s" begin="-0.6s" repeatCount="indefinite" />
                        </circle>
                      </g>
                    )}
                <circle cx={r.cx} cy={r.cy + 2} r={Math.min(r.w, r.h) * 0.32} fill={isMine ? 'rgba(0,0,0,0.55)' : 'rgba(120,0,0,0.55)'} stroke={isMine ? meta.color : '#fb7185'} strokeWidth={2.5} />
                <text x={r.cx} y={r.cy + 2} textAnchor="middle" dominantBaseline="central" fontSize={b.type === 'core' ? 34 : 26}>{emoji}</text>
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
                {/* Shield pool bar */}
                {b.type === 'shield' && (
                  <g>
                    <rect x={r.x + 6} y={r.y + 12} width={r.w - 12} height={6} rx={3} fill="rgba(0,0,0,0.65)" />
                    <rect x={r.x + 6} y={r.y + 12} width={(r.w - 12) * Math.max(0, Math.min(1, shieldPct))} height={6} rx={3} fill="#38bdf8" />
                  </g>
                )}
                {/* stock / loading badge for own launchers */}
                {b.type === 'launcher' && isMine && (((b.loadingUntil ?? 0) > Date.now()) || (b.stock ?? 0) > 0) && (
                  <text x={r.x + r.w - 8} y={r.y + 18} textAnchor="end" fontSize={15}>
                    {(b.loadingUntil ?? 0) > Date.now() ? '⏳' : `🚀${b.stock ?? 0}`}
                  </text>
                )}
              </g>
            );
          })}

          {/* Construction sites & upgrade progress */}
          {Object.values(mc.pending ?? {}).map(p => {
            const r = cellRect(p.side, p.gx, p.gy, cols, rows);
            const secsLeft = Math.max(0, (p.completeAt - Date.now()) / 1000);
            const isMine = p.ownerId === myId;
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
            <div className="text-xs text-muted" style={{ fontSize: '0.65rem' }}>+{myIncome}/s • {roomState.code}</div>
          </div>
          <div style={{ ...overlayBox, pointerEvents: 'auto', padding: '6px 10px', flex: 1, minWidth: 120 }}>
            <div className="text-xs" style={{ fontWeight: 800, fontSize: '0.65rem' }}>⭐ YOU {mySide === 'top' ? '🔼' : '🔽'} {myCore ? `${Math.ceil(myCore.coreHp!)}/${myCore.maxCoreHp}` : ''}</div>
            <div style={{ height: 6, background: 'rgba(255,255,255,0.12)', borderRadius: 3, overflow: 'hidden', marginTop: 3 }}>
              <div style={{ width: `${myCorePct}%`, height: '100%', background: 'linear-gradient(90deg,#4ade80,#22d3ee)' }} />
            </div>
          </div>
          <div style={{ ...overlayBox, pointerEvents: 'auto', padding: '6px 10px', flex: 1, minWidth: 120 }}>
            <div className="text-xs" style={{ fontWeight: 800, fontSize: '0.65rem' }}>⭐ {enemyName.toUpperCase()} {enemyCore ? `${Math.ceil(enemyCore.coreHp!)}/${enemyCore.maxCoreHp}` : ''}</div>
            <div style={{ height: 6, background: 'rgba(255,255,255,0.12)', borderRadius: 3, overflow: 'hidden', marginTop: 3 }}>
              <div style={{ width: `${enemyCorePct}%`, height: '100%', background: 'linear-gradient(90deg,#fb7185,#f43f5e)' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, pointerEvents: 'auto' }}>
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
        {isTargeting && (
          <div style={{ position: 'absolute', top: 74, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'auto', display: 'flex', gap: 8, alignItems: 'center', background: 'rgba(0,0,0,0.72)', border: '1px solid rgba(251,191,36,0.6)', borderRadius: 12, padding: '8px 12px', whiteSpace: 'nowrap' }}>
            <span style={{ fontWeight: 800, color: '#fbbf24', fontSize: '0.9rem', animation: 'mc-pulse 1s infinite' }}>
              🎯 TAP ENEMY SQUARE{targetType ? ` — ALL ${targetType.toUpperCase()}` : ''}
            </span>
            <button type="button" onClick={cancelTargeting}
              style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid var(--border)', borderRadius: 8, color: '#fff', fontWeight: 800, padding: '4px 10px' }}>✖</button>
          </div>
        )}

        {/* ── Bottom launcher dock ── */}
        <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8, display: 'flex', flexDirection: 'column', gap: 6, pointerEvents: 'none' }}>
          <div style={{ display: 'flex', gap: 6, pointerEvents: 'auto', justifyContent: 'flex-end' }}>
            {(['single', 'scatter'] as const).map(t => {
              const n = stockByType[t];
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => startTypeTargeting(t)}
                  title={n > 0 ? `Fire every loaded ${t} launcher at one square` : `No loaded ${t} launchers — load some first`}
                  style={{
                    padding: '5px 10px', borderRadius: 999, fontWeight: 700, fontSize: '0.7rem', color: '#fff',
                    background: n > 0 ? 'rgba(244,63,94,0.16)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${n > 0 ? 'rgba(244,63,94,0.45)' : 'var(--border)'}`,
                    opacity: n > 0 ? 0.95 : 0.55,
                  }}
                >
                  🔥 ALL {t === 'single' ? '🎯' : '💥'} ×{n}
                </button>
              );
            })}
          </div>
          <div className="mc-dock" style={{ display: 'flex', gap: 6, overflowX: 'auto', pointerEvents: 'auto', scrollbarWidth: 'none' }}>
            {myLaunchers.map(l => {
              const stock = l.stock ?? 0;
              const maxStock = l.maxStock ?? MAX_STOCK;
              const hasStock = stock > 0;
              const loadUntil = l.loadingUntil ?? 0;
              const loading = loadUntil > Date.now();
              const loadSecsLeft = loading ? Math.max(0, (loadUntil - Date.now()) / 1000) : 0;
              const loadPct = loading ? Math.min(1, Math.max(0, 1 - (loadUntil - Date.now()) / (LOAD_SECONDS * 1000))) : 0;
              const stockFull = stock >= maxStock;
              const broke = myResources < (l.missileCost ?? 0);
              const loadLabel = stockFull ? 'FULL' : loading ? `${loadSecsLeft.toFixed(0)}s` : broke ? 'NO CR' : `＋${l.missileCost}cr`;
              return (
                <div key={l.id} style={{ minWidth: 148, background: 'rgba(4,8,18,0.88)', border: `1px solid ${hasStock ? 'rgba(251,113,133,0.5)' : 'var(--border)'}`, borderRadius: 12, padding: 6 }}>
                  <button
                    type="button"
                    onClick={() => { if (hasStock) startTargeting(l.id); else setSelectedId(l.id); }}
                    title={hasStock ? 'Tap to pick a target and fire the volley' : 'Tap to open and load missiles'}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, color: '#fff', fontSize: '0.78rem', fontWeight: 700 }}
                  >
                    <span style={{ fontSize: '1.25rem' }}>{l.launcherType === 'single' ? '🎯' : '💥'}</span>
                    <span style={{ flex: 1, textAlign: 'left' }}>Lv{l.level} • {'●'.repeat(stock)}{'○'.repeat(Math.max(0, maxStock - stock))}{l.autobuild ? ' • AUTO' : ''}</span>
                    <span>{hasStock ? `FIRE` : 'OPEN'}</span>
                  </button>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    <button
                      type="button"
                      onClick={() => onLoad({ launcherId: l.id })}
                      title={stockFull ? 'Stockpile full' : loading ? `Building… ${loadSecsLeft.toFixed(1)}s left` : broke ? `Need ${l.missileCost}cr` : `Build 1 missile (~${LOAD_SECONDS}s)`}
                      style={{ flex: 1, padding: '6px 4px', borderRadius: 8, fontWeight: 800, fontSize: '0.72rem', background: 'rgba(74,222,128,0.2)', border: '1px solid rgba(74,222,128,0.5)', color: '#fff' }}
                    >
                      {loading ? `🔨 ${loadSecsLeft.toFixed(0)}s` : loadLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleAutobuild(l.id)}
                      title={l.autobuild ? 'AUTO ON — tap to stop' : 'AUTO OFF — tap to auto-load'}
                      style={{ padding: '6px 8px', borderRadius: 8, fontSize: '0.7rem', fontWeight: 800, color: '#fff', background: l.autobuild ? 'rgba(74,222,128,0.25)' : 'rgba(255,255,255,0.06)', border: `1px solid ${l.autobuild ? 'rgba(74,222,128,0.6)' : 'var(--border)'}` }}
                    >
                      {l.autobuild ? 'AUTO' : 'auto'}
                    </button>
                  </div>
                  {loading && (
                    <div style={{ height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {BUILD_OPTIONS.map(o => {
              const afford = myResources >= o.cost;
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => { onBuild({ buildingType: o.buildingType, launcherType: o.launcherType, gx: buildCell.gx, gy: buildCell.gy }); setBuildCell(null); }}
                  disabled={!afford}
                  style={{
                    padding: '14px 10px', borderRadius: 'var(--radius-lg)', textAlign: 'center',
                    background: afford ? 'rgba(74,222,128,0.08)' : 'rgba(255,255,255,0.03)',
                    border: `2px solid ${afford ? 'rgba(74,222,128,0.4)' : 'var(--border)'}`,
                    color: '#fff', opacity: afford ? 1 : 0.55,
                  }}
                >
                  <div style={{ fontSize: '2rem' }}>{o.emoji}</div>
                  <div style={{ fontWeight: 800, fontSize: '0.9rem', margin: '4px 0' }}>{o.label}</div>
                  <div style={{ fontWeight: 800, fontSize: '0.85rem', color: afford ? 'var(--amber-400)' : 'var(--rose-400)', marginBottom: 4 }}>{o.cost} credits • ⏱ 3s</div>
                  <div className="text-xs text-muted" style={{ lineHeight: 1.4 }}>{o.desc}</div>
                </button>
              );
            })}
          </div>
        </Modal>
      )}

      {/* ── Building dialog ── */}
      {selected && (
        <Modal onClose={() => setSelectedId(null)} title={`${BUILDING_META[selected.type].emoji} ${BUILDING_META[selected.type].name}${selected.type !== 'core' ? ` — Level ${selected.level}/5` : ''}`}>
          <BuildingPanel
            b={selected}
            isMine={selected.ownerId === myId}
            myResources={myResources}
            upgradeCost={upgradeCost}
            coreIncome={coreIncome}
            pendingUp={Object.values(mc.pending ?? {}).find(p => p.kind === 'upgrade' && p.upgradeOf === selected.id) ?? null}
            onUpgrade={() => { onUpgrade(selected.id); setSelectedId(null); }}
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
            <div>👆 <b>Tap an empty square</b> on your island to build (Generator +2/s, Shield 300 HP, Shield Healer 8/s).</div>
            <div>🏠 <b>Tap any building</b> for stats, upgrades &amp; fire control. Gold ★ show its level.</div>
            <div>⭐ Your <b>Core pays +{coreIncome}/s</b> — destroy the enemy Core (2000 HP) to win!</div>
            <div>🛡️ Shields <b>fully block</b> blasts while charged (≈ 25 covered squares). Empty covered squares still drain the shield. Hide Generators inside!</div>
            <div>💚 Shield Healers fix <b>one shield at a time</b> (weakest first — green beam shows it).</div>
            <div>🚀 <b>Load up to {MAX_STOCK} missiles</b> per launcher ({LOAD_SECONDS}s each, ＋ or AUTO), then <b>FIRE the volley</b> — or <b>🔥 ALL</b> of one type at once!</div>
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
          <div className="glass p-24 text-center animate-fade-up" style={{ borderRadius: 'var(--radius-xl)', maxWidth: 420, width: '100%', border: `2px solid ${iWon ? 'rgba(74,222,128,0.5)' : 'rgba(244,63,94,0.5)'}` }}>
            <div style={{ fontSize: '3rem' }}>{iWon ? '🏆' : '💥'}</div>
            <h2 className="heading-lg">{iWon ? 'VICTORY! Enemy Core destroyed!' : `${winnerName ?? 'Enemy'} wins — your Core was destroyed`}</h2>
            <p className="text-muted text-sm">Your final credits: {myResources}</p>
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

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
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
        position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 12,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass animate-fade-up"
        style={{
          width: '100%', maxWidth: 560, maxHeight: '82vh', overflowY: 'auto',
          borderRadius: 'var(--radius-xl)', padding: 20, background: 'rgba(13,18,32,0.97)',
          border: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontWeight: 800, fontSize: '1.05rem' }}>{title}</span>
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

function BuildingPanel({ b, isMine, myResources, upgradeCost, coreIncome, pendingUp, onUpgrade, onLoad, onToggleAutobuild, onFire }: {
  b: MissileBuilding;
  isMine: boolean;
  myResources: number;
  upgradeCost: number | null;
  coreIncome: number;
  pendingUp: { targetLevel: number; completeAt: number } | null;
  onUpgrade: () => void;
  onLoad: () => void;
  onToggleAutobuild: () => void;
  onFire: () => void;
}) {
  const rows: Array<[string, string]> = [];
  if (b.type === 'economy') {
    rows.push(['💰 Income', `+${b.incomePerSec}/s${b.level < 5 ? ` (Lv${b.level + 1} → +${STATS.economy.income[b.level + 1]}/s)` : ' (MAX)'}`]);
    rows.push(['❤ Structure', `${Math.ceil(b.hp ?? 0)} / ${b.maxHp} HP`]);
    rows.push(['📍 Square', `(${b.gx + 1}, ${b.gy + 1}) — 1×1`]);
  } else if (b.type === 'shield') {
    rows.push(['🛡️ Shield pool', `${Math.ceil(b.shieldHp ?? 0)} / ${b.maxShieldHp}${b.level < 5 ? ` (Lv${b.level + 1} → ${STATS.shield.hp[b.level + 1]})` : ' (MAX)'}`]);
    rows.push(['📏 Coverage', `≈ ${SHIELD_COVER_CELLS} squares (range 3, no diagonals)`]);
    rows.push(['🧱 Blocking', 'Full block while charged — overflow only. Even empty squares drain it.']);
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
        {rows.map(([k, v], i) => (
          <div key={i} className="text-sm" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 10 }}>
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
          style={{ marginBottom: 8, padding: '14px' }}
        >
          {pendingUp
            ? `⏳ Upgrading to Lv${pendingUp.targetLevel}… ${upSecs.toFixed(0)}s left`
            : upgradeCost === null ? '⭐ MAX LEVEL' : `⬆ Upgrade to Lv${b.level + 1} (${upgradeCost}cr, ${nextUpSecs}s)`}
        </button>
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
            style={{ marginBottom: 8, padding: '14px' }}
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
            width: '100%', marginBottom: 8, padding: '12px 14px', borderRadius: 'var(--radius-md)',
            fontWeight: 800, fontSize: '0.9rem', color: '#fff',
            background: b.autobuild ? 'rgba(74,222,128,0.18)' : 'rgba(255,255,255,0.04)',
            border: `2px solid ${b.autobuild ? 'rgba(74,222,128,0.6)' : 'var(--border)'}`,
          }}
        >
          {b.autobuild ? 'AUTO: ON (tap to stop)' : 'AUTO: OFF (tap to auto-load)'}
        </button>
      )}
      {isMine && b.type === 'launcher' && (
        <button type="button" className="btn btn-full btn-rose" onClick={onFire} disabled={stock <= 0} style={{ padding: '14px', opacity: stock <= 0 ? 0.5 : 1 }}>
          {stock <= 0 ? '🎯 No missiles — build some first' : `🎯 FIRE VOLLEY ×${stock}`}
        </button>
      )}
    </div>
  );
}
