import React, { useEffect, useRef, useState } from 'react';
import type { RoomState } from '../types/game';

interface Props {
  roomState: RoomState;
  myId: string;
  isHost: boolean;
  onGuessTile: (tileIndex: number) => void;
  onNextRound: () => void;
}

interface TilePhysics {
  x: number; // percentage 0..100
  y: number; // percentage 0..100
  vx: number;
  vy: number;
  scale: number;
  phaseOffset: number;
}

// Hex/RGB helper for color interpolation
function parseColor(colorStr: string): [number, number, number] {
  if (colorStr.startsWith('#')) {
    let hex = colorStr.slice(1);
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const num = parseInt(hex, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }
  return [100, 100, 100];
}

function interpolateColor(c1: string, c2: string, factor: number): string {
  const [r1, g1, b1] = parseColor(c1);
  const [r2, g2, b2] = parseColor(c2);
  const r = Math.round(r1 + (r2 - r1) * factor);
  const g = Math.round(g1 + (g2 - g1) * factor);
  const b = Math.round(b1 + (b2 - b1) * factor);
  return `rgb(${r}, ${g}, ${b})`;
}

export default function ChromaShiftGame({ roomState, myId, isHost, onGuessTile, onNextRound }: Props) {
  const { chromaState, chromaOptions, round } = roomState;
  const difficulty = chromaOptions?.playerDifficulties?.[myId] || 'easy';
  const isExtreme = chromaOptions?.extremeMode ?? false;
  const gridDim = isExtreme ? 15 : 5;
  const totalTiles = gridDim * gridDim;
  const tileSizePx = isExtreme ? 22 : 64;

  const isReveal = roomState.phase === 'chroma-reveal';

  const [wrongFlash, setWrongFlash] = useState(false);

  // Time elapsed for target gradient shift (0 -> 1 over 45 seconds)
  const [shiftProgress, setShiftProgress] = useState(0);

  // Physics state for floating tiles (Medium & Hard mode)
  const [tilesPhysics, setTilesPhysics] = useState<TilePhysics[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Initialize tile physics positions based on grid coordinates
  useEffect(() => {
    const initial: TilePhysics[] = [];
    const step = 80 / gridDim;

    for (let i = 0; i < totalTiles; i++) {
      const row = Math.floor(i / gridDim);
      const col = i % gridDim;
      const x = 5 + col * step;
      const y = 5 + row * step;

      // Tile movement speed (Medium = 0.09, Hard = 0.13)
      const speedMult = difficulty === 'hard' ? 0.13 : 0.09;
      const angle = (i * 1.37 + (chromaState?.seed || 0)) % (Math.PI * 2);
      const vx = Math.cos(angle) * speedMult;
      const vy = Math.sin(angle) * speedMult;

      initial.push({
        x,
        y,
        vx,
        vy,
        scale: 1,
        phaseOffset: i * 0.7,
      });
    }
    setTilesPhysics(initial);
    setShiftProgress(0);
  }, [round, chromaState?.seed, difficulty, gridDim, totalTiles]);

  // High-FPS requestAnimationFrame color shift loop for ultra-smooth micro-incremental steps
  useEffect(() => {
    if (isReveal || !chromaState) return;
    let animId: number;
    const startTime = performance.now();
    const DURATION_MS = (chromaState.shiftDurationSec || 60) * 1000;

    const updateShift = (now: number) => {
      const elapsed = now - startTime;
      const linearP = Math.min(1, Math.max(0, elapsed / DURATION_MS));
      // Quadratic ease curve: initial start is virtually imperceptible and ramps up continuously
      const easedP = Math.pow(linearP, 2.0);
      setShiftProgress(easedP);

      if (linearP < 1) {
        animId = requestAnimationFrame(updateShift);
      }
    };

    animId = requestAnimationFrame(updateShift);
    return () => cancelAnimationFrame(animId);
  }, [round, chromaState?.shiftDurationSec ?? 60, isReveal]);

  // Movement & physics loop for Medium and Hard modes
  useEffect(() => {
    if (difficulty === 'easy' || isReveal) return;

    let animId: number;
    let lastTime = performance.now();

    const updatePhysics = (now: number) => {
      const dt = Math.min(50, now - lastTime) / 16;
      lastTime = now;

      setTilesPhysics(prev => {
        if (!prev || prev.length !== totalTiles) return prev;
        const next = prev.map(t => ({ ...t }));

        const targetSpeed = difficulty === 'hard' ? 0.13 : 0.09;

        // 1. Move and bounce off container walls
        for (let i = 0; i < totalTiles; i++) {
          const t = next[i];
          t.x += t.vx * dt;
          t.y += t.vy * dt;

          // Wall bounces
          if (t.x < 2) { t.x = 2; t.vx = Math.abs(t.vx); }
          if (t.x > 88) { t.x = 88; t.vx = -Math.abs(t.vx); }
          if (t.y < 2) { t.y = 2; t.vy = Math.abs(t.vy); }
          if (t.y > 88) { t.y = 88; t.vy = -Math.abs(t.vy); }

          // Hard mode: dynamic scale pulsation (0.5x to 1.5x)
          if (difficulty === 'hard') {
            const timeSec = now / 1000;
            t.scale = 1.0 + 0.5 * Math.sin(timeSec * 1.5 + t.phaseOffset);
          } else {
            t.scale = 1;
          }
        }

        // 2. Soft anti-overlap repulsion between tiles
        const minDistBase = isExtreme ? 4.5 : 14;
        for (let i = 0; i < totalTiles; i++) {
          for (let j = i + 1; j < totalTiles; j++) {
            const dx = next[j].x - next[i].x;
            const dy = next[j].y - next[i].y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const minDist = minDistBase * Math.max(next[i].scale, next[j].scale) * 0.75;

            if (dist < minDist && dist > 0.01) {
              const overlap = (minDist - dist) / 2;
              const nx = dx / dist;
              const ny = dy / dist;

              next[i].x -= nx * overlap * 0.2;
              next[i].y -= ny * overlap * 0.2;
              next[j].x += nx * overlap * 0.2;
              next[j].y += ny * overlap * 0.2;

              // Elastic bounce swap
              const tempVx = next[i].vx;
              const tempVy = next[i].vy;
              next[i].vx = next[j].vx;
              next[i].vy = next[j].vy;
              next[j].vx = tempVx;
              next[j].vy = tempVy;
            }
          }
        }

        // 3. Normalize velocity to maintain constant target speed
        for (let i = 0; i < totalTiles; i++) {
          const t = next[i];
          const currentSpeed = Math.sqrt(t.vx * t.vx + t.vy * t.vy);
          if (currentSpeed > 0.0001) {
            t.vx = (t.vx / currentSpeed) * targetSpeed;
            t.vy = (t.vy / currentSpeed) * targetSpeed;
          }
        }

        return next;
      });

      animId = requestAnimationFrame(updatePhysics);
    };

    animId = requestAnimationFrame(updatePhysics);
    return () => cancelAnimationFrame(animId);
  }, [difficulty, isReveal, totalTiles, isExtreme]);

  // Click handler
  const handleTileClick = (index: number) => {
    if (isReveal) return;

    if (chromaState && index !== chromaState.targetTileIndex) {
      setWrongFlash(true);
      setTimeout(() => setWrongFlash(false), 600);
    }
    onGuessTile(index);
  };

  // Base tile style computation
  const getTileStyle = (index: number) => {
    if (!chromaState) return {};

    const isTarget = index === chromaState.targetTileIndex;
    const [base1, base2] = chromaState.baseGradient;
    const background = `linear-gradient(135deg, ${base1}, ${base2})`;

    if (difficulty === 'easy') {
      return {
        background,
        border: isReveal && isTarget ? '3px solid var(--green-400)' : '1px solid rgba(255,255,255,0.15)',
        boxShadow: isReveal && isTarget ? '0 0 25px var(--green-400)' : '0 4px 12px rgba(0,0,0,0.3)',
      };
    }

    // Medium or Hard physics positioning
    const physics = tilesPhysics[index] || { x: 0, y: 0, scale: 1 };
    return {
      background,
      position: 'absolute' as const,
      left: `${physics.x}%`,
      top: `${physics.y}%`,
      transform: `scale(${physics.scale})`,
      transition: 'transform 0.1s ease-out',
      border: isReveal && isTarget ? '3px solid var(--green-400)' : '1px solid rgba(255,255,255,0.18)',
      boxShadow: isReveal && isTarget ? '0 0 30px var(--green-400)' : '0 6px 16px rgba(0,0,0,0.4)',
      zIndex: isTarget && isReveal ? 100 : Math.round(physics.scale * 10),
    };
  };

  return (
    <div className="page-top" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div className="container animate-fade-up" style={{ maxWidth: 760, width: '100%' }}>
        {/* Header HUD */}
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
          {/* Game Title & Status Badges */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 className="heading-md" style={{ margin: 0, fontSize: '1.25rem', whiteSpace: 'nowrap' }}>
                🎨 Chroma Shift
              </h2>
              <span className="badge badge-purple" style={{ fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                Round {round} / 5
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span className="badge badge-cyan" style={{ fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
                {difficulty === 'easy' ? '🟢 Easy' : difficulty === 'medium' ? '🟡 Medium' : '🔴 Hard'}
              </span>

              {isExtreme && (
                <span className="badge" style={{ fontSize: '0.7rem', background: 'rgba(239,68,68,0.15)', color: 'var(--rose-400)', border: '1px solid rgba(239,68,68,0.3)', whiteSpace: 'nowrap' }}>
                  🔥 15x15 (225 Tiles)
                </span>
              )}

              {chromaOptions.fairPoints && (
                <span className="badge badge-amber" style={{ fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
                  ⚖️ Fair Pts (+{difficulty === 'easy' ? 1 : difficulty === 'medium' ? 2 : 3})
                </span>
              )}
            </div>
          </div>

          {/* Player Score Cards */}
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

        {/* Misclick Toast / Flash */}
        {wrongFlash && (
          <div
            className="toast animate-fade-up"
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

        {/* Main Playing Arena */}
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
              : `Spot the single tile (among ${totalTiles} tiles) that is slowly changing color and click it first!`}
          </p>

          {/* Grid vs Floating Container */}
          <div
            ref={containerRef}
            style={{
              width: '100%',
              aspectRatio: '1 / 1',
              maxWidth: 540,
              margin: '0 auto',
              position: 'relative',
              display: difficulty === 'easy' ? 'grid' : 'block',
              gridTemplateColumns: difficulty === 'easy' ? `repeat(${gridDim}, 1fr)` : undefined,
              gridTemplateRows: difficulty === 'easy' ? `repeat(${gridDim}, 1fr)` : undefined,
              gap: difficulty === 'easy' ? (isExtreme ? 3 : 12) : undefined,
              overflow: 'hidden',
              borderRadius: 'var(--radius-xl)',
              background: 'rgba(0,0,0,0.25)',
              padding: isExtreme ? 6 : 12,
            }}
          >
            {Array.from({ length: totalTiles }).map((_, i) => {
              const isTargetWinner = isReveal && chromaState?.targetTileIndex === i;
              const isTargetTile = chromaState?.targetTileIndex === i;

              return (
                <button
                  key={i}
                  id={`chroma-tile-${i}`}
                  onClick={() => handleTileClick(i)}
                  disabled={isReveal}
                  style={{
                    width: difficulty === 'easy' ? '100%' : `${tileSizePx}px`,
                    height: difficulty === 'easy' ? '100%' : `${tileSizePx}px`,
                    borderRadius: isExtreme ? '4px' : 'var(--radius-lg)',
                    cursor: isReveal ? 'default' : 'pointer',
                    outline: 'none',
                    position: difficulty === 'easy' ? 'relative' : undefined,
                    overflow: 'hidden',
                    ...getTileStyle(i),
                  }}
                  className="chroma-tile-btn"
                  title={isTargetWinner ? 'Winning Target Tile!' : `Tile ${i + 1}`}
                >
                  {/* Ultra-smooth micro-incremental gradient overlay */}
                  {isTargetTile && chromaState && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        borderRadius: 'inherit',
                        background: `linear-gradient(135deg, ${chromaState.targetGradient[0]}, ${chromaState.targetGradient[1]})`,
                        opacity: shiftProgress,
                        pointerEvents: 'none',
                        transition: 'none',
                      }}
                    />
                  )}

                  {isTargetWinner && (
                    <span style={{ position: 'relative', zIndex: 10, fontSize: isExtreme ? '0.75rem' : '1.5rem', filter: 'drop-shadow(0 0 8px rgba(0,0,0,0.8))' }}>
                      🎯
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Round Reveal Modal / Banner */}
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
                ? `${chromaState.roundWinnerName} spotted the tile!`
                : 'Round Finished!'}
            </h3>
            <p className="text-muted text-sm mb-16">
              {chromaState.roundWinnerName
                ? `Awarded +${chromaState.pointsAwarded} point${chromaState.pointsAwarded !== 1 ? 's' : ''}!`
                : 'No one scored this round.'}
            </p>

            {isHost ? (
              <button
                className="btn btn-lg btn-primary btn-full"
                onClick={onNextRound}
                id="next-chroma-round-btn"
              >
                {round >= 5 ? '🏆 View Final Leaderboard' : 'Next Round ➔'}
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
