// missileCommand/MissileCommandGame.tsx — SILO'D UI for Missile Command.
// Grid-based SVG map with pan/zoom + touch support. Remove this folder to remove the game.
//
// Interaction model:
// - Tap an empty square on YOUR island → build popup with all options.
// - Tap any building → dialog with its stats + upgrade (own) / fire (own launcher).
// - Fire → targeting banner → tap an enemy square to strike.

import { useEffect, useRef, useState } from 'react';
import type {
  RoomState,
  MissileBuilding,
  MissileInFlight,
  MissileBuildAction,
  MissileLaunchAction,
  MissileLoadAction,
} from '../../types/game';
import { WORLD, WATER_Y, TOP_RECT, BOTTOM_RECT, cellRect, BUILD_OPTIONS, STATS, BUILDING_META, upgradeCostFor, SHIELD_COVER_CELLS, HEALER_COVER_CELLS, CORE_INCOME_FALLBACK, MAX_STOCK } from './config';

interface Props {
  roomState: RoomState;
  myId: string;
  isHost: boolean;
  onBuild: (action: MissileBuildAction) => void;
  onUpgrade: (buildingId: string) => void;
  onLoad: (action: MissileLoadAction) => void;
  onLaunch: (action: MissileLaunchAction) => void;
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

// Coverage bars (Manhattan range, no diagonals): one rounded bar per covered
// row, so the aura only ever touches tiles that actually get coverage.
function coverageRows(side: 'top' | 'bottom', gx: number, gy: number, range: number, cols: number, rows: number) {
  const r = side === 'top' ? TOP_RECT : BOTTOM_RECT;
  const cw = r.w / cols, ch = r.h / rows;
  const out: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (let dy = -range; dy <= range; dy++) {
    const yy = gy + dy;
    if (yy < 0 || yy >= rows) continue;
    const span = range - Math.abs(dy);
    const x0 = Math.max(0, gx - span), x1 = Math.min(cols - 1, gx + span);
    out.push({ x: r.x + x0 * cw + 3, y: r.y + yy * ch + 3, w: (x1 - x0 + 1) * cw - 6, h: ch - 6 });
  }
  return out;
}

export default function MissileCommandGame({ roomState, myId, isHost, onBuild, onUpgrade, onLoad, onLaunch, onPlayAgain }: Props) {
  const mc = roomState.missileCommandState;
  const svgRef = useRef<SVGSVGElement>(null);

  const [targetLauncherId, setTargetLauncherId] = useState<string | null>(null);
  const [buildCell, setBuildCell] = useState<Cell | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: WORLD / 2, y: WORLD / 2 });
  const [, setFrame] = useState(0);
  const [flashes, setFlashes] = useState<Flash[]>([]);

  const gestureRef = useRef({
    pointers: new Map<number, { x: number; y: number }>(),
    downPos: null as { x: number; y: number } | null,
    moved: false,
    pinchDist: 0,
    pinchZoom: 1,
  });
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

  // ── Animation frame: re-render flight + expire flashes ──
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setFrame(f => f + 1);
      setFlashes(f => (f.length ? f.filter(fl => fl.expires > Date.now()) : f));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

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
  const enemySide = mySide === 'top' ? 'bottom' : 'top';
  const myResources = Math.floor(mc.resources[myId] ?? 0);
  const enemyId = mySide ? (mySide === 'top' ? mc.sides.bottom : mc.sides.top) : null;

  const buildings = Object.values(mc.buildings);
  const byCell = new Map<string, MissileBuilding>();
  for (const b of buildings) byCell.set(`${b.side}:${b.gx}:${b.gy}`, b);
  const myBuildings = buildings.filter(b => b.ownerId === myId);
  const myCore = buildings.find(b => b.type === 'core' && b.side === mySide);
  const enemyCore = buildings.find(b => b.type === 'core' && b.side === enemySide);
  const myEcoIncome = myBuildings.filter(b => b.type === 'economy').reduce((s, b) => s + (b.incomePerSec ?? 0), 0);
  const myIncome = myEcoIncome + (myCore && (myCore.coreHp ?? 0) > 0 ? coreIncome : 0);
  const enemyBuildingCount = enemyId ? buildings.filter(b => b.ownerId === enemyId && b.type !== 'core').length : 0;
  const selected: MissileBuilding | null = (selectedId && mc.buildings[selectedId]) || null;

  const enemyName = enemyId ? (roomState.players.find(p => p.id === enemyId)?.name ?? 'Enemy') : 'Enemy';
  const winnerName = mc.winnerId ? (roomState.players.find(p => p.id === mc.winnerId)?.name ?? '???') : null;
  const iWon = mc.winnerId === myId;
  const isTargeting = targetLauncherId !== null;

  // ── View transform ──
  const vbW = WORLD / zoom, vbH = WORLD / zoom;
  const vbX = Math.max(-100, Math.min(WORLD + 100 - vbW, center.x - vbW / 2));
  const vbY = Math.max(-100, Math.min(WORLD + 100 - vbH, center.y - vbH / 2));
  const clampZoom = (z: number) => Math.max(0.6, Math.min(3, z));

  function toWorld(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return { x: WORLD / 2, y: WORLD / 2 };
    const rect = svg.getBoundingClientRect();
    return {
      x: vbX + ((clientX - rect.left) / rect.width) * vbW,
      y: vbY + ((clientY - rect.top) / rect.height) * vbH,
    };
  }

  function handleTap(wx: number, wy: number) {
    if (!mySide) return;
    const cell = worldToCell(wx, wy, cols, rows);
    if (!cell) { setBuildCell(null); setSelectedId(null); return; }

    // 1. Targeting → strike enemy square
    if (isTargeting && targetLauncherId) {
      if (cell.side !== mySide) {
        onLaunch({ launcherId: targetLauncherId, targetGx: cell.gx, targetGy: cell.gy });
        setTargetLauncherId(null);
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
  function onPointerDown(e: React.PointerEvent) {
    const g = gestureRef.current;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (g.pointers.size === 1) {
      g.downPos = { x: e.clientX, y: e.clientY };
      g.moved = false;
    } else if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()];
      g.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      g.pinchZoom = zoom;
      g.moved = true;
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    const g = gestureRef.current;
    if (!g.pointers.has(e.pointerId)) return;
    const prev = g.pointers.get(e.pointerId)!;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const svg = svgRef.current;
    const rect = svg?.getBoundingClientRect();
    if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.pinchDist > 0) setZoom(clampZoom((g.pinchZoom * d) / g.pinchDist));
      if (rect) {
        const dx = (e.clientX - prev.x) / 2, dy = (e.clientY - prev.y) / 2;
        setCenter(c => ({ x: c.x - (dx / rect.width) * vbW, y: c.y - (dy / rect.height) * vbH }));
      }
      return;
    }
    if (g.downPos) {
      const total = Math.hypot(e.clientX - g.downPos.x, e.clientY - g.downPos.y);
      if (total > 10) g.moved = true;
      if (g.moved && rect) {
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        setCenter(c => ({ x: c.x - (dx / rect.width) * vbW, y: c.y - (dy / rect.height) * vbH }));
      }
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    const g = gestureRef.current;
    g.pointers.delete(e.pointerId);
    if (g.pointers.size === 0) {
      if (!g.moved && g.downPos) {
        const w = toWorld(e.clientX, e.clientY);
        handleTap(w.x, w.y);
      }
      g.downPos = null;
      g.moved = false;
    }
  }

  function startTargeting(launcherId: string) {
    setTargetLauncherId(launcherId);
    setSelectedId(null);
    setBuildCell(null);
  }

  const upgradeCost = selected ? upgradeCostFor(selected) : null;
  const buildCellBuilding = buildCell ? byCell.get(`${buildCell.side}:${buildCell.gx}:${buildCell.gy}`) : undefined;

  return (
    <div className="page-top" style={{ padding: '12px' }}>
      <style>{`
        @keyframes mc-pulse { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
        .mc-beam { animation: mc-beam-flow 0.7s linear infinite; }
        @keyframes mc-beam-flow { to { stroke-dashoffset: -18; } }
        @media (max-width: 700px) {
          .mc-side { flex-direction: column !important; }
          .mc-map-wrap { min-height: 52vh !important; }
        }
      `}</style>
      <div className="container-full animate-fade-up" style={{ maxWidth: 1200 }}>
        {/* ── HUD ── */}
        <div className="glass p-16" style={{ borderRadius: 'var(--radius-xl)', marginBottom: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '1.5rem' }}>🚀</span>
              <div>
                <h1 className="heading-md" style={{ margin: 0 }}>Missile Command <span className="badge badge-amber" style={{ marginLeft: 6 }}>1v1 {mySide === 'top' ? '🔼 TOP' : mySide === 'bottom' ? '🔽 BOTTOM' : ''}</span></h1>
                <p className="text-xs text-muted" style={{ margin: 0 }}>Room {roomState.code} • Tap a square to build • Destroy the enemy ⭐ Core to win</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ padding: '8px 14px', borderRadius: 'var(--radius-lg)', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.35)' }}>
                <div className="text-xs text-muted" style={{ fontWeight: 700 }}>💰 YOUR CREDITS</div>
                <div style={{ fontWeight: 800, fontSize: '1.2rem', color: 'var(--amber-400)' }}>{myResources} <span className="text-xs text-muted">(+{myIncome}/s)</span></div>
              </div>
              <div style={{ padding: '8px 14px', borderRadius: 'var(--radius-lg)', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
                <div className="text-xs text-muted" style={{ fontWeight: 700 }}>⚔ ENEMY: {enemyName}</div>
                <div style={{ fontWeight: 700, fontSize: '1rem' }}>🏠 {enemyBuildingCount} building{enemyBuildingCount === 1 ? '' : 's'} <span className="text-xs text-muted">(econ hidden)</span></div>
              </div>
            </div>
          </div>
          {/* Core HP bars */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
            {[
              { core: myCore, color: 'linear-gradient(90deg,#4ade80,#22d3ee)', name: `⭐ YOUR CORE ${mySide === 'top' ? '🔼' : '🔽'}` },
              { core: enemyCore, color: 'linear-gradient(90deg,#fb7185,#f43f5e)', name: `⭐ ${enemyName.toUpperCase()}'S CORE` },
            ].map((row, i) => {
              const pct = row.core ? Math.max(0, (row.core.coreHp! / row.core.maxCoreHp!) * 100) : 0;
              return (
                <div key={i} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 'var(--radius-md)', padding: '8px 10px', border: '1px solid var(--border)' }}>
                  <div className="text-xs" style={{ fontWeight: 700, marginBottom: 4 }}>{row.name}</div>
                  <div style={{ height: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: row.color, transition: 'width 0.3s' }} />
                  </div>
                  <div className="text-xs text-muted" style={{ marginTop: 2 }}>{row.core ? `${Math.ceil(row.core.coreHp!)} / ${row.core.maxCoreHp} HP` : '—'}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mc-side" style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
          {/* ── Map ── */}
          <div className="glass mc-map-wrap" style={{ flex: 1, borderRadius: 'var(--radius-xl)', overflow: 'hidden', position: 'relative', minHeight: '60vh', touchAction: 'none' }}>
            <svg
              ref={svgRef}
              viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
              style={{ width: '100%', height: '100%', minHeight: '60vh', display: 'block', touchAction: 'none', cursor: 'pointer' }}
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

              {/* Grid cells */}
              {(['top', 'bottom'] as const).map(side => (
                <g key={side}>
                  {Array.from({ length: rows }).map((_, gy) =>
                    Array.from({ length: cols }).map((_, gx) => {
                      const r = cellRect(side, gx, gy, cols, rows);
                      const occ = byCell.get(`${side}:${gx}:${gy}`);
                      const isBuildCell = buildCell?.side === side && buildCell.gx === gx && buildCell.gy === gy;
                      const isSel = selected && selected.side === side && selected.gx === gx && selected.gy === gy;
                      return (
                        <rect
                          key={`${gx}-${gy}`}
                          x={r.x + 1.5} y={r.y + 1.5} width={r.w - 3} height={r.h - 3} rx={8}
                          fill={
                            isBuildCell ? 'rgba(74,222,128,0.35)'
                            : isSel ? 'rgba(255,255,255,0.28)'
                            : side === mySide ? ((gx + gy) % 2 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)')
                            : ((gx + gy) % 2 === 0 ? 'rgba(0,0,0,0.10)' : 'rgba(0,0,0,0.18)')
                          }
                          stroke={isBuildCell ? '#4ade80' : isSel ? '#fff' : 'rgba(255,255,255,0.14)'}
                          strokeWidth={isBuildCell || isSel ? 3 : 1}
                          strokeDasharray={(!occ && side === mySide) ? '7 6' : undefined}
                        />
                      );
                    })
                  )}
                </g>
              ))}

              {/* Shield coverage auras — exact covered tiles only */}
              {buildings.filter(b => b.type === 'shield').map(b => {
                const isMine = b.ownerId === myId;
                const pct = (b.shieldHp ?? 0) / (b.maxShieldHp ?? 1);
                const isSel = selected?.id === b.id;
                const tint = isMine ? '56,189,248' : '251,113,133';
                return (
                  <g key={`sh-${b.id}`} pointerEvents="none">
                    {coverageRows(b.side, b.gx, b.gy, shieldTiles, cols, rows).map((rc, i) => (
                      <rect key={i} x={rc.x} y={rc.y} width={rc.w} height={rc.h} rx={rc.h / 2}
                        fill={`rgba(${tint},${isSel ? 0.22 : 0.09})`}
                        stroke={`rgba(${tint},${isSel ? 0.8 : 0.35})`} strokeWidth={isSel ? 2 : 1}
                        strokeDasharray={pct <= 0 ? '5 7' : undefined}
                        opacity={pct <= 0 ? 0.4 : 1} />
                    ))}
                  </g>
                );
              })}

              {/* Shield Healer coverage auras — exact covered tiles only */}
              {buildings.filter(b => b.type === 'healer' && b.ownerId === myId).map(b => {
                const isSel = selected?.id === b.id;
                return (
                  <g key={`he-${b.id}`} pointerEvents="none">
                    {coverageRows(b.side, b.gx, b.gy, healerTiles, cols, rows).map((rc, i) => (
                      <rect key={i} x={rc.x} y={rc.y} width={rc.w} height={rc.h} rx={rc.h / 2}
                        fill={`rgba(74,222,128,${isSel ? 0.22 : 0.08})`}
                        stroke={`rgba(74,222,128,${isSel ? 0.8 : 0.35})`} strokeWidth={isSel ? 2 : 1} />
                    ))}
                  </g>
                );
              })}

              {/* Heal beams: healer → weakest shield in range */}
              {buildings.filter(b => b.type === 'healer' && b.ownerId === myId && b.healTargetId).map(h => {
                const t = mc.buildings[h.healTargetId!];
                if (!t) return null;
                const hr = cellRect(h.side, h.gx, h.gy, cols, rows);
                const tr = cellRect(t.side, t.gx, t.gy, cols, rows);
                const mx = (hr.cx + tr.cx) / 2, my = (hr.cy + tr.cy) / 2;
                return (
                  <g key={`beam-${h.id}`} pointerEvents="none">
                    <line x1={hr.cx} y1={hr.cy} x2={tr.cx} y2={tr.cy}
                      stroke="#4ade80" strokeWidth={4} strokeLinecap="round"
                      strokeDasharray="10 8" className="mc-beam" opacity={0.9} />
                    <circle cx={mx} cy={my} r={14} fill="rgba(74,222,128,0.3)" stroke="#4ade80" strokeWidth={2} />
                    <text x={mx} y={my} textAnchor="middle" dominantBaseline="central" fontSize={15} fontWeight={900}>💚</text>
                  </g>
                );
              })}

              {/* Missiles in flight (interpolated)} */}
              {snapRef.current.missiles.map(m => {
                const elapsed = Math.min(3, (Date.now() - snapRef.current.at) / 1000);
                const sx = m.currentX * WORLD, sy = m.currentY * WORLD;
                const tx = m.targetX * WORLD, ty = m.targetY * WORLD;
                const dx = tx - sx, dy = ty - sy;
                const d = Math.hypot(dx, dy) || 1;
                const step = (m.speed || 0.5) * WORLD * elapsed;
                const t = Math.min(1, step / d);
                const px = sx + dx * t, py = sy + dy * t;
                const col = m.launcherType === 'single' ? '#fbbf24' : m.launcherType === 'scatter' ? '#fb7185' : '#c084fc';
                const tc = cellRect(m.ownerId === mc.sides.top ? 'bottom' : 'top', m.targetGx, m.targetGy, cols, rows);
                return (
                  <g key={m.id} pointerEvents="none">
                    <line x1={sx} y1={sy} x2={px} y2={py} stroke={col} strokeWidth={3} opacity={0.5} />
                    <circle cx={px} cy={py} r={11} fill={col} opacity={0.3} />
                    <text x={px} y={py} textAnchor="middle" dominantBaseline="central" fontSize={22}>🚀</text>
                    <rect x={tc.x + 2} y={tc.y + 2} width={tc.w - 4} height={tc.h - 4} rx={8}
                      fill="none" stroke={col} strokeWidth={2.5} strokeDasharray="6 5" style={{ animation: 'mc-pulse 0.8s infinite' }} />
                  </g>
                );
              })}

              {/* Impact flashes */}
              {flashes.map(f => (
                <g key={f.id} opacity={Math.max(0, (f.expires - Date.now()) / 700)} pointerEvents="none">
                  <circle cx={f.x} cy={f.y} r={44} fill={f.kind === 'single' ? '#fbbf24' : f.kind === 'scatter' ? '#fb7185' : '#c084fc'} opacity={0.5} />
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
                const emoji = b.type === 'launcher' ? (b.launcherType === 'single' ? '🎯' : b.launcherType === 'scatter' ? '💥' : '☄️') : b.type === 'core' ? '⭐' : meta.emoji;
                return (
                  <g key={b.id} pointerEvents="none">
                    {isSel && (
                      <rect x={r.x - 2} y={r.y - 2} width={r.w + 4} height={r.h + 4} rx={12}
                        fill="none" stroke="#fff" strokeWidth={3.5} strokeDasharray="10 7" />
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
                    {b.type === 'launcher' && isMine && (
                      <text x={r.x + r.w - 8} y={r.y + 18} textAnchor="end" fontSize={15}>
                        {Date.now() - (b.lastFiredAt ?? 0) < (b.cooldownMs ?? 4000) ? '⏳' : '✅'}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Banners */}
              {isTargeting && (
                <text x={WORLD / 2} y={WATER_Y} textAnchor="middle" fill="#fbbf24" fontSize={30} fontWeight={800} style={{ animation: 'mc-pulse 1s infinite' }}>
                  🎯 TAP AN ENEMY SQUARE TO STRIKE
                </text>
              )}
            </svg>

            {/* Zoom controls */}
            <div style={{ position: 'absolute', right: 10, top: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { label: '+', fn: () => setZoom(z => clampZoom(z * 1.25)) },
                { label: '−', fn: () => setZoom(z => clampZoom(z * 0.8)) },
                { label: '⤢', fn: () => { setZoom(1); setCenter({ x: WORLD / 2, y: WORLD / 2 }); } },
              ].map((b, i) => (
                <button key={i} type="button" onClick={b.fn} style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(0,0,0,0.6)', border: '1px solid var(--border)', color: '#fff', fontSize: '1.2rem', fontWeight: 800 }}>{b.label}</button>
              ))}
            </div>
            <div className="text-xs" style={{ position: 'absolute', left: 10, bottom: 8, color: 'rgba(255,255,255,0.65)', background: 'rgba(0,0,0,0.5)', padding: '2px 8px', borderRadius: 8 }}>
              👆 tap square: build / inspect • drag: pan • wheel / pinch: zoom
            </div>
          </div>

          {/* ── Side panel ── */}
          <div style={{ width: 300, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="glass p-16" style={{ borderRadius: 'var(--radius-xl)' }}>
              <div className="text-xs text-muted" style={{ fontWeight: 800, letterSpacing: '0.06em', marginBottom: 8 }}>📖 HOW TO PLAY</div>
              <div className="text-xs text-muted" style={{ lineHeight: 1.6 }}>
                👆 <b>Tap an empty square</b> on your island to build (Generator +2/s, Shield 150 HP, Shield Healer 8/s).<br />
                🏠 <b>Tap any building</b> for stats, upgrades &amp; fire control.<br />
                ⭐ Your <b>Core pays +{coreIncome}/s</b> baseline — defend it!<br />
                🛡️ Shields <b>fully block</b> blasts while charged (≈ 13 squares, dashed blue). Hide Generators inside!<br />
                💚 Shield Healers fix <b>one shield at a time</b> (weakest first — green beam).<br />
                🚀 <b>Load up to {MAX_STOCK} missiles</b> per launcher, then <b>FIRE the whole volley</b> at the ⭐ Core!
              </div>
              {isTargeting && (
                <button type="button" className="btn btn-sm btn-secondary btn-full" style={{ marginTop: 8 }} onClick={() => setTargetLauncherId(null)}>
                  ✖ Cancel targeting
                </button>
              )}
            </div>

            {/* My launchers quick-fire */}
            <div className="glass p-16" style={{ borderRadius: 'var(--radius-xl)' }}>
              <div className="text-xs text-muted" style={{ fontWeight: 800, letterSpacing: '0.06em', marginBottom: 8 }}>🚀 MY LAUNCHERS ({myBuildings.filter(b => b.type === 'launcher').length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                {myBuildings.filter(b => b.type === 'launcher').map(l => {
                  const stock = l.stock ?? 0;
                  const maxStock = l.maxStock ?? MAX_STOCK;
                  const hasStock = stock > 0;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => { if (hasStock) startTargeting(l.id); else setSelectedId(l.id); }}
                      title={hasStock ? 'Tap to pick a target and fire the volley' : 'Tap to open and load missiles'}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10,
                        background: hasStock ? 'rgba(251,113,133,0.12)' : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${hasStock ? 'rgba(251,113,133,0.5)' : 'var(--border)'}`,
                        color: '#fff', fontSize: '0.8rem', fontWeight: 600,
                      }}
                    >
                      <span style={{ fontSize: '1.2rem' }}>{l.launcherType === 'single' ? '🎯' : l.launcherType === 'scatter' ? '💥' : '☄️'}</span>
                      <span style={{ flex: 1, textAlign: 'left' }}>
                        Lv{l.level} {l.launcherType} • {'●'.repeat(stock)}{'○'.repeat(Math.max(0, maxStock - stock))}
                      </span>
                      <span>{hasStock ? `FIRE ×${stock}` : 'LOAD ▸'}</span>
                    </button>
                  );
                })}
                {myBuildings.filter(b => b.type === 'launcher').length === 0 && (
                  <p className="text-xs text-muted">No launchers yet — tap an empty square on your island to build one!</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Build popup ── */}
        {buildCell && !buildCellBuilding && (
          <Modal onClose={() => setBuildCell(null)} title={`🔨 Build — ${buildCell.side === mySide ? 'your island' : 'enemy island'} (${buildCell.gx + 1}, ${buildCell.gy + 1})`}>
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
                    <div style={{ fontWeight: 800, fontSize: '0.85rem', color: afford ? 'var(--amber-400)' : 'var(--rose-400)', marginBottom: 4 }}>{o.cost} credits</div>
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
              onUpgrade={() => { onUpgrade(selected.id); setSelectedId(null); }}
              onLoad={() => onLoad({ launcherId: selected.id })}
              onFire={() => startTargeting(selected.id)}
            />
          </Modal>
        )}

        {/* ── End overlay ── */}
        {roomState.phase === 'missile-command-end' && (
          <div className="glass p-24 text-center animate-fade-up" style={{ borderRadius: 'var(--radius-xl)', marginTop: 12, border: `2px solid ${iWon ? 'rgba(74,222,128,0.5)' : 'rgba(244,63,94,0.5)'}` }}>
            <div style={{ fontSize: '3rem' }}>{iWon ? '🏆' : '💥'}</div>
            <h2 className="heading-lg">{iWon ? 'VICTORY! Enemy Core destroyed!' : `${winnerName ?? 'Enemy'} wins — your Core was destroyed`}</h2>
            <p className="text-muted text-sm">Your final credits: {myResources}</p>
            {isHost && (
              <button type="button" className="btn btn-primary mt-16" onClick={onPlayAgain}>🔄 Back to Lobby</button>
            )}
            {!isHost && <p className="text-xs text-muted mt-16">Waiting for host to return to lobby…</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
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

function BuildingPanel({ b, isMine, myResources, upgradeCost, coreIncome, onUpgrade, onLoad, onFire }: {
  b: MissileBuilding;
  isMine: boolean;
  myResources: number;
  upgradeCost: number | null;
  coreIncome: number;
  onUpgrade: () => void;
  onLoad: () => void;
  onFire: () => void;
}) {
  const rows: Array<[string, string]> = [];
  if (b.type === 'economy') {
    rows.push(['💰 Income', `+${b.incomePerSec}/s${b.level < 5 ? ` (Lv${b.level + 1} → +${STATS.economy.income[b.level + 1]}/s)` : ' (MAX)'}`]);
    rows.push(['❤ Structure', `${Math.ceil(b.hp ?? 0)} / ${b.maxHp} HP`]);
    rows.push(['📍 Square', `(${b.gx + 1}, ${b.gy + 1}) — 1×1`]);
  } else if (b.type === 'shield') {
    rows.push(['🛡️ Shield pool', `${Math.ceil(b.shieldHp ?? 0)} / ${b.maxShieldHp}`]);
    rows.push(['📏 Coverage', `≈ ${SHIELD_COVER_CELLS} squares (range 2, no diagonals)`]);
    rows.push(['🧱 Blocking', 'Full block while charged — overflow only']);
    rows.push(['💚 Self-repair', `+${+(STATS.healer.heal[b.level] / 8).toFixed(1)}/s (1/8 of healer)`]);
    rows.push(['❤ Structure', `${Math.ceil(b.hp ?? 0)} / ${b.maxHp} HP`]);
  } else if (b.type === 'healer') {
    rows.push(['💚 Heal rate', `${b.healPerSec}/s${b.level < 5 ? ` (Lv${b.level + 1} → ${STATS.healer.heal[b.level + 1]}/s)` : ' (MAX)'}`]);
    rows.push(['🎯 Repairs', 'ONE shield at a time — weakest % in range']);
    rows.push(['📏 Coverage', `≈ ${HEALER_COVER_CELLS} squares (range 1, no diagonals)`]);
    rows.push(['❤ Structure', `${Math.ceil(b.hp ?? 0)} / ${b.maxHp} HP`]);
  } else if (b.type === 'launcher') {
    const key = b.launcherType === 'single' ? 'single' : b.launcherType === 'scatter' ? 'scatter' : 'cluster';
    const tbl = STATS[key];
    const blastTxt = b.launcherType === 'single' ? '1 square per missile' : b.launcherType === 'scatter' ? 'plus of 5 squares per missile' : '4 bomblets, plus-shaped blasts per missile';
    const stock = b.stock ?? 0;
    const maxStock = b.maxStock ?? MAX_STOCK;
    rows.push(['📦 Stockpile', `${'●'.repeat(stock)}${'○'.repeat(Math.max(0, maxStock - stock))} ${stock}/${maxStock} loaded`]);
    rows.push(['🚀 Missile', `${b.launcherType} — ${b.missileDamage} dmg / ${b.missileCost}cr each`]);
    rows.push(['💥 Blast', blastTxt]);
    rows.push(['⏱ Reload', `${((b.cooldownMs ?? 0) / 1000).toFixed(1)}s per missile built`]);
    if (b.level < 5) rows.push(['⬆ Next level', `dmg ${tbl.dmg[b.level + 1]} • ${tbl.cost[b.level + 1]}cr/missile`]);
  } else if (b.type === 'core') {
    rows.push(['⭐ Core HP', `${Math.ceil(b.coreHp ?? 0)} / ${b.maxCoreHp}`]);
    rows.push(['💰 Income', `+${coreIncome}/s baseline economy`]);
    rows.push(['💚 Regen', `+${b.coreRegenPerSec}/s (slow — keep shields up!)`]);
  }
  const reloading = b.type === 'launcher' && (Date.now() - (b.lastFiredAt ?? 0) < (b.cooldownMs ?? 4000));
  const stock = b.stock ?? 0;
  const maxStock = b.maxStock ?? MAX_STOCK;
  const stockFull = stock >= maxStock;
  const canLoad = isMine && b.type === 'launcher' && !stockFull && !reloading && myResources >= (b.missileCost ?? 0);
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
          className={`btn btn-full ${upgradeCost !== null && myResources >= upgradeCost ? 'btn-primary' : 'btn-secondary'}`}
          disabled={upgradeCost === null || myResources < upgradeCost}
          onClick={onUpgrade}
          style={{ marginBottom: 8, padding: '14px' }}
        >
          {upgradeCost === null ? '⭐ MAX LEVEL' : `⬆ Upgrade to Lv${b.level + 1} (${upgradeCost}cr)`}
        </button>
      )}
      {isMine && b.type === 'launcher' && (
        <button
          type="button"
          className={`btn btn-full ${canLoad ? 'btn-secondary' : 'btn-secondary'}`}
          disabled={!canLoad}
          onClick={onLoad}
          style={{ marginBottom: 8, padding: '14px' }}
          title={stockFull ? 'Stockpile full' : reloading ? 'Reloading' : `Build 1 missile for ${b.missileCost}cr`}
        >
          {stockFull ? `📦 Stockpile full (${maxStock}/${maxStock})` : reloading ? '⏳ Reloading…' : `🔨 Build missile (${b.missileCost}cr)`}
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
