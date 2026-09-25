import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { RoomState } from '../types/game';
import { TOTAL_ROUNDS } from '../constants';

interface Props {
  roomState: RoomState;
  myId: string;
  isHost: boolean;
  onGuessTile: (tileIndex: number) => void;
  onNextRound: () => void;
}

interface TilePhysics {
  x: number;
  y: number;
  vx: number;
  vy: number;
  scale: number;
  phaseOffset: number;
}

interface TileButtonProps {
  index: number;
  isTarget: boolean;
  isReveal: boolean;
  isWinner: boolean;
  disabled: boolean;
  baseGradient: [string, string];
  targetGradient: [string, string];
  difficulty: string;
  tileSizePx: number;
  isExtreme: boolean;
  physicsEnabled: boolean;
  initialX: number;
  initialY: number;
  onClick: (index: number) => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
  overlayRef: (el: HTMLDivElement | null) => void;
}

const TileButton = memo(function TileButton({
  index,
  isTarget,
  isReveal,
  isWinner,
  disabled,
  baseGradient,
  targetGradient,
  difficulty,
  tileSizePx,
  isExtreme,
  physicsEnabled,
  initialX,
  initialY,
  onClick,
  buttonRef,
  overlayRef,
}: TileButtonProps) {
  const [base1, base2] = baseGradient;
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => onClick(index)}
      disabled={disabled}
      aria-label={isWinner ? 'Winning target tile' : `Tile ${index + 1}${isTarget && isReveal ? ' (was target)' : ''}`}
      style={{
        width: difficulty === 'easy' || !physicsEnabled ? '100%' : `${tileSizePx}px`,
        height: difficulty === 'easy' || !physicsEnabled ? '100%' : `${tileSizePx}px`,
        borderRadius: isExtreme ? '6px' : 'var(--radius-lg)',
        cursor: disabled ? 'default' : 'pointer',
        outline: 'none',
        position: physicsEnabled ? 'absolute' : 'relative',
        left: physicsEnabled ? `${initialX}%` : undefined,
        top: physicsEnabled ? `${initialY}%` : undefined,
        overflow: 'hidden',
        background: `linear-gradient(135deg, ${base1}, ${base2})`,
        border: isWinner ? '3px solid var(--green-400)' : '1px solid rgba(255,255,255,0.15)',
        boxShadow: isWinner ? '0 0 25px var(--green-400)' : '0 4px 12px rgba(0,0,0,0.3)',
        willChange: physicsEnabled ? 'transform' : undefined,
      }}
      className="chroma-tile-btn"
      title={isWinner ? 'Winning Target Tile!' : `Tile ${index + 1}`}
    >
      {isTarget && (
        <div
          ref={overlayRef}
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            background: `linear-gradient(135deg, ${targetGradient[0]}, ${targetGradient[1]})`,
            opacity: 0,
            pointerEvents: 'none',
          }}
        />
      )}
      {isWinner && (
        <span style={{ position: 'relative', zIndex: 10, fontSize: isExtreme ? '0.9rem' : '1.5rem', filter: 'drop-shadow(0 0 8px rgba(0,0,0,0.8))' }}>
          🎯
        </span>
      )}
    </button>
  );
});

export default function ChromaShiftGame({ roomState, myId, isHost, onGuessTile, onNextRound }: Props) {
  const { chromaState, chromaOptions, round } = roomState;
  const difficulty = chromaOptions?.playerDifficulties?.[myId] || 'easy';
  const isExtreme = chromaOptions?.extremeMode ?? false;
  const gridDim = isExtreme ? 8 : 5;
  const totalTiles = gridDim * gridDim;
  const tileSizePx = isExtreme ? 42 : 64;

  const isReveal = roomState.phase === 'chroma-reveal';
  const [wrongFlash, setWrongFlash] = useState(false);
  const [raceNow, setRaceNow] = useState(() => Date.now());
  const raceEndAt = chromaState?.raceEndAt ?? null;
  const isRace = !isReveal && raceEndAt !== null && raceEndAt !== undefined;
  const solvers = chromaState?.solvers ?? [];
  const iSolved = solvers.some(s => s.playerId === myId);
  const mySolverEntry = solvers.find(s => s.playerId === myId);
  const wrongFlashTimer = useRef<number | null>(null);
  const physicsRef = useRef<TilePhysics[]>([]);
  const buttonEls = useRef<Array<HTMLButtonElement | null>>([]);
  const overlayEls = useRef<Array<HTMLDivElement | null>>([]);
  const shiftStartRef = useRef<number>(performance.now());

  const prefersReducedMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    []
  );
  const isCoarsePointer = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches,
    []
  );
  // On phones + extreme 8x8, disable JS physics movement (biggest lag source).
  // Tiles stay in grid; color-shift gameplay is unchanged.
  const physicsEnabled = difficulty !== 'easy' && !prefersReducedMotion && !(isExtreme && isCoarsePointer);
  const useRepulsion = physicsEnabled && !isExtreme && totalTiles <= 25 && !isCoarsePointer;

  // Static initial positions (no React state churn)
  const initialPositions = useMemo(() => {
    const arr: Array<{ x: number; y: number }> = [];
    const step = 80 / gridDim;
    for (let i = 0; i < totalTiles; i++) {
      const row = Math.floor(i / gridDim);
      const col = i % gridDim;
      arr.push({ x: 5 + col * step, y: 5 + row * step });
    }
    return arr;
  }, [gridDim, totalTiles, round, chromaState?.seed]);

  useEffect(() => {
    buttonEls.current = new Array(totalTiles).fill(null);
    overlayEls.current = new Array(totalTiles).fill(null);
    shiftStartRef.current = performance.now();
    const speedMult = difficulty === 'hard' ? 0.13 : 0.09;
    physicsRef.current = initialPositions.map((p, i) => {
      const angle = (i * 1.37 + (chromaState?.seed || 0)) % (Math.PI * 2);
      return { x: p.x, y: p.y, vx: Math.cos(angle) * speedMult, vy: Math.sin(angle) * speedMult, scale: 1, phaseOffset: i * 0.7 };
    });
  }, [round, chromaState?.seed, difficulty, initialPositions, totalTiles]);

  useEffect(() => {
    return () => {
      if (wrongFlashTimer.current) window.clearTimeout(wrongFlashTimer.current);
    };
  }, []);

  // Race countdown ticker (only while 10s race is active)
  useEffect(() => {
    if (!isRace) return;
    setRaceNow(Date.now());
    const id = window.setInterval(() => setRaceNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [isRace, raceEndAt]);

  // Single unified rAF loop: imperative DOM updates, no per-frame React state.
  useEffect(() => {
    if (isReveal || !chromaState) return;
    let animId = 0;
    let lastPhysics = performance.now();
    let lastShiftWrite = 0;
    const DURATION_MS = (chromaState.shiftDurationSec || 60) * 1000;
    const t0 = shiftStartRef.current;
    const targetSpeed = difficulty === 'hard' ? 0.13 : 0.09;
    // Phones: 20fps physics, desktop: 30fps. Shift overlay: write at most every 120ms.
    const physicsInterval = isCoarsePointer || isExtreme ? 50 : 33;
    const targetIndex = chromaState.targetTileIndex;

    const tick = (now: number) => {
      // Color shift overlay (imperative, no re-render)
      if (now - lastShiftWrite > 120) {
        lastShiftWrite = now;
        const linearP = Math.min(1, Math.max(0, (now - t0) / DURATION_MS));
        const easedP = linearP * linearP;
        const overlay = overlayEls.current[targetIndex];
        if (overlay) overlay.style.opacity = String(easedP);
      }

      if (physicsEnabled && now - lastPhysics >= physicsInterval) {
        const dt = Math.min(50, now - lastPhysics) / 16;
        lastPhysics = now;
        const arr = physicsRef.current;
        if (arr.length === totalTiles) {
          for (let i = 0; i < totalTiles; i++) {
            const t = arr[i];
            t.x += t.vx * dt;
            t.y += t.vy * dt;
            if (t.x < 2) { t.x = 2; t.vx = Math.abs(t.vx); }
            if (t.x > 88) { t.x = 88; t.vx = -Math.abs(t.vx); }
            if (t.y < 2) { t.y = 2; t.vy = Math.abs(t.vy); }
            if (t.y > 88) { t.y = 88; t.vy = -Math.abs(t.vy); }
            t.scale = difficulty === 'hard' ? 1.0 + 0.5 * Math.sin((now / 1000) * 1.5 + t.phaseOffset) : 1;
          }
          if (useRepulsion) {
            const minDistBase = 14;
            for (let i = 0; i < totalTiles; i++) {
              for (let j = i + 1; j < totalTiles; j++) {
                const dx = arr[j].x - arr[i].x;
                const dy = arr[j].y - arr[i].y;
                const distSq = dx * dx + dy * dy;
                const minDist = minDistBase * 0.75;
                if (distSq < minDist * minDist && distSq > 0.0001) {
                  const dist = Math.sqrt(distSq);
                  const overlap = (minDist - dist) / 2;
                  const nx = dx / dist;
                  const ny = dy / dist;
                  arr[i].x -= nx * overlap * 0.2;
                  arr[i].y -= ny * overlap * 0.2;
                  arr[j].x += nx * overlap * 0.2;
                  arr[j].y += ny * overlap * 0.2;
                  const tvx = arr[i].vx; const tvy = arr[i].vy;
                  arr[i].vx = arr[j].vx; arr[i].vy = arr[j].vy;
                  arr[j].vx = tvx; arr[j].vy = tvy;
                }
              }
            }
          }
          for (let i = 0; i < totalTiles; i++) {
            const t = arr[i];
            const sp = Math.sqrt(t.vx * t.vx + t.vy * t.vy);
            if (sp > 0.0001) { t.vx = (t.vx / sp) * targetSpeed; t.vy = (t.vy / sp) * targetSpeed; }
            const el = buttonEls.current[i];
            if (el) {
              // GPU-friendly transform only; left/top set once at mount
              el.style.transform = t.scale !== 1 ? `scale(${t.scale.toFixed(3)})` : '';
              el.style.left = `${t.x.toFixed(2)}%`;
              el.style.top = `${t.y.toFixed(2)}%`;
            }
          }
        }
      }
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [isReveal, chromaState?.shiftDurationSec, chromaState?.targetTileIndex, difficulty, physicsEnabled, useRepulsion, totalTiles, isCoarsePointer, isExtreme, round]);

  // Click handler (server is source of truth for penalty)
  const handleTileClick = (index: number) => {
    if (isReveal || iSolved) return;
    if (chromaState && index !== chromaState.targetTileIndex) {
      setWrongFlash(true);
      if (wrongFlashTimer.current) window.clearTimeout(wrongFlashTimer.current);
      wrongFlashTimer.current = window.setTimeout(() => setWrongFlash(false), 600);
    }
    onGuessTile(index);
  };

  const raceSecsLeft = isRace && raceEndAt ? Math.max(0, Math.ceil((raceEndAt - raceNow) / 1000)) : 0;

  return (
    <div className="page-top" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div className="container animate-fade-up" style={{ maxWidth: 760, width: '100%' }}>
        <div
          className="glass p-16"
          style={{
            borderRadius: 'var(--radius-xl)',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 className="heading-md" style={{ margin: 0, fontSize: '1.25rem', whiteSpace: 'nowrap' }}>
                🎨 Chroma Shift
              </h2>
              <span className="badge badge-purple" style={{ fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                Round {round} / {TOTAL_ROUNDS}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span className="badge badge-cyan" style={{ fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
                {difficulty === 'easy' ? '🟢 Easy' : difficulty === 'medium' ? '🟡 Medium' : '🔴 Hard'}
              </span>
              {isExtreme && (
                <span className="badge" style={{ fontSize: '0.7rem', background: 'rgba(239,68,68,0.15)', color: 'var(--rose-400)', border: '1px solid rgba(239,68,68,0.3)', whiteSpace: 'nowrap' }}>
                  🔥 8x8 (64 Tiles)
                </span>
              )}
              {chromaOptions.fairPoints && (
                <span className="badge badge-amber" style={{ fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
                  ⚖️ Fair Pts (+{difficulty === 'easy' ? 1 : difficulty === 'medium' ? 2 : 3})
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {roomState.players.map((p) => {
              const pDiff = chromaOptions?.playerDifficulties?.[p.id] || 'easy';
              return (
                <div
                  key={p.id}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 'var(--radius-md)',
                    background: p.id === myId ? 'rgba(6,182,212,0.15)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${p.id === myId ? 'var(--cyan-400)' : 'var(--border)'}`,
                    textAlign: 'center',
                    minWidth: 80,
                  }}
                >
                  <div className="text-xs text-muted" style={{ fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center', whiteSpace: 'nowrap' }}>
                    <span style={{ fontWeight: p.id === myId ? 700 : 400 }}>{p.name} {p.id === myId && '(You)'}</span>
                    <span style={{ fontSize: '0.6rem' }}>
                      {pDiff === 'easy' ? '🟢' : pDiff === 'medium' ? '🟡' : '🔴'}
                    </span>
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1rem', color: 'var(--amber-400)', marginTop: 1 }}>
                    {p.score} pts
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {wrongFlash && (
          <div
            className="toast animate-fade-up"
            role="alert"
            style={{
              position: 'fixed',
              top: 20,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(239, 68, 68, 0.95)',
              color: '#fff',
              fontWeight: 700,
              boxShadow: '0 0 20px rgba(239, 68, 68, 0.6)',
              zIndex: 9999,
            }}
          >
            ⚠️ Incorrect tile! -1 Point Penalty!
          </div>
        )}

        <div
          className="glass p-20"
          style={{
            borderRadius: 'var(--radius-2xl)',
            marginBottom: 20,
            position: 'relative',
            background: 'rgba(15, 23, 42, 0.6)',
            border: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          <p className="text-center text-xs text-muted" style={{ marginBottom: 16 }}>
            {isReveal
              ? '🎉 Round Finished!'
              : isRace
              ? `🏁 ${chromaState?.firstFinderName ?? 'Someone'} found it! ${raceSecsLeft}s left — find it too for half points!`
              : `Spot the single tile (among ${totalTiles} tiles) that is slowly changing color and click it first!`}
          </p>
          {isRace && (
            <div
              className="glass p-16 animate-fade-up"
              role="alert"
              style={{
                borderRadius: 'var(--radius-xl)',
                marginBottom: 16,
                background: 'linear-gradient(135deg, rgba(251,191,36,0.15), rgba(239,68,68,0.1))',
                border: '2px solid var(--amber-400)',
                textAlign: 'center',
              }}
            >
              <div style={{ fontWeight: 800, fontSize: '1rem', color: '#fff' }}>
                🎯 {chromaState?.firstFinderName} spotted the tile first (+{chromaState?.firstFinderPoints} pts)!
              </div>
              <p className="text-sm mt-8" style={{ color: 'var(--amber-400)', fontWeight: 700 }}>
                {iSolved
                  ? `You found it too (+${mySolverEntry?.points} pts)!`
                  : `You have ${raceSecsLeft}s to find it for half points!`}
              </p>
              {solvers.length > 0 && (
                <div className="text-xs text-muted mt-8">
                  Solved ({solvers.length}): {solvers.map(s => `${s.playerName} (+${s.points})`).join(', ')}
                </div>
              )}
            </div>
          )}
          <div
            style={{
              width: '100%',
              aspectRatio: '1 / 1',
              maxWidth: 540,
              margin: '0 auto',
              position: 'relative',
              display: difficulty === 'easy' || !physicsEnabled ? 'grid' : 'block',
              gridTemplateColumns: difficulty === 'easy' || !physicsEnabled ? `repeat(${gridDim}, 1fr)` : undefined,
              gridTemplateRows: difficulty === 'easy' || !physicsEnabled ? `repeat(${gridDim}, 1fr)` : undefined,
              gap: difficulty === 'easy' || !physicsEnabled ? (isExtreme ? 4 : 12) : undefined,
              overflow: 'hidden',
              borderRadius: 'var(--radius-xl)',
              background: 'rgba(0,0,0,0.25)',
              padding: isExtreme ? 8 : 12,
            }}
          >
            {Array.from({ length: totalTiles }).map((_, i) => (
              <TileButton
                key={`${round}-${i}`}
                index={i}
                isTarget={chromaState?.targetTileIndex === i}
                isReveal={isReveal}
                isWinner={isReveal && chromaState?.targetTileIndex === i}
                disabled={isReveal || iSolved}
                baseGradient={chromaState?.baseGradient ?? ['#1e1b4b', '#312e81']}
                targetGradient={chromaState?.targetGradient ?? ['#2e1065', '#4c1d95']}
                difficulty={difficulty}
                tileSizePx={tileSizePx}
                isExtreme={isExtreme}
                physicsEnabled={physicsEnabled}
                initialX={initialPositions[i]?.x ?? 0}
                initialY={initialPositions[i]?.y ?? 0}
                onClick={handleTileClick}
                buttonRef={(el) => { buttonEls.current[i] = el; }}
                overlayRef={(el) => { overlayEls.current[i] = el; }}
              />
            ))}
          </div>
        </div>

        {isReveal && chromaState && (
          <div
            className="glass p-24 text-center animate-fade-up"
            style={{
              borderRadius: 'var(--radius-xl)',
              background: 'linear-gradient(135deg, rgba(6,182,212,0.15), rgba(168,85,247,0.15))',
              border: '2px solid var(--cyan-400)',
            }}
          >
            <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🏆</div>
            <h3 className="heading-lg" style={{ marginBottom: 6 }}>
              {chromaState.roundWinnerName
                ? `${chromaState.roundWinnerName} spotted the tile first!`
                : 'Round Finished!'}
            </h3>
            <p className="text-muted text-sm mb-16">
              {(chromaState.solvers ?? []).length > 1
                ? `${chromaState.solvers.length} players found it: ${chromaState.solvers.map(s => `${s.playerName} (+${s.points})`).join(', ')}`
                : chromaState.roundWinnerName
                ? `Awarded +${chromaState.pointsAwarded} point${chromaState.pointsAwarded !== 1 ? 's' : ''}!`
                : 'No one scored this round.'}
            </p>
            {isHost ? (
              <button
                className="btn btn-lg btn-primary btn-full"
                onClick={onNextRound}
                id="next-chroma-round-btn"
              >
                {round >= TOTAL_ROUNDS ? '🏆 View Final Leaderboard' : 'Next Round ➔'}
              </button>
            ) : (
              <p className="text-xs text-muted" style={{ fontStyle: 'italic' }}>
                Waiting for host to continue to the next round...
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
