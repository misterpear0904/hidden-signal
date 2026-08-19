import React, { useState, useEffect } from 'react';
import type { RoomState } from '../types/game';

interface Props {
  roomState: RoomState;
  myId: string;
  isHost: boolean;
  onSubmitPick: (colIndex: number) => void;
  onPlaceMine?: (row: number, col: number) => void;
  onNextTurn: () => void;
}

export default function TerritoryPushGame({ roomState, myId, isHost, onSubmitPick, onPlaceMine, onNextTurn }: Props) {
  const [selectedCol, setSelectedCol] = useState<number | null>(null);
  const [lockedCol, setLockedCol] = useState<number | null>(null);
  const [firedCol, setFiredCol] = useState<number | null>(null);
  const [isPlacingMine, setIsPlacingMine] = useState(false);
  const [mineFeedback, setMineFeedback] = useState<string | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  const territory = roomState.territoryState;
  const isExtreme = territory?.extremeMode === true;
  const boardHeight = territory?.boardHeight || (isExtreme ? 20 : 10);
  const midRow = isExtreme ? 9 : 4;

  // Real-time clock for extreme mode charge progress animation
  useEffect(() => {
    if (!isExtreme) return;
    const interval = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(interval);
  }, [isExtreme]);

  // Reset standard turn selection ONLY when turn changes in turn-based mode
  useEffect(() => {
    if (!isExtreme) {
      setSelectedCol(null);
      setLockedCol(null);
    }
  }, [territory?.turn, isExtreme]);

  // Clear fire ripple
  useEffect(() => {
    if (firedCol === null) return;
    const t = setTimeout(() => setFiredCol(null), 350);
    return () => clearTimeout(t);
  }, [firedCol]);

  // Clear mine feedback toast
  useEffect(() => {
    if (!mineFeedback) return;
    const t = setTimeout(() => setMineFeedback(null), 3000);
    return () => clearTimeout(t);
  }, [mineFeedback]);

  if (!territory) {
    return (
      <div className="page text-center">
        <div className="spinner" />
        <p className="text-muted mt-16">Initializing Territory Push...</p>
      </div>
    );
  }

  const isRedTeam = territory.teams.red.includes(myId);
  const isBlueTeam = territory.teams.blue.includes(myId);
  const myTeamName = isRedTeam ? 'Red' : isBlueTeam ? 'Blue' : 'Spectator';

  // Mines & Traps state
  const myMine = territory.mines?.[myId];
  const allTeamMines = Object.values(territory.mines || {});
  const recentExplosions = territory.recentExplosions || [];
  const latestExplosion = recentExplosions[0];
  const isLatestExplosionRecent = latestExplosion && (now - latestExplosion.timestamp < 6000);

  // Booster Squares & Dynamic Recharge calculation
  const bonusSquares = territory.bonusSquares || [];
  const redBonuses = bonusSquares.filter(sq => sq.row <= territory.board[sq.col]).length;
  const blueBonuses = bonusSquares.length - redBonuses;
  const myBonusCount = isRedTeam ? redBonuses : isBlueTeam ? blueBonuses : 0;
  const myRechargeInterval = Math.max(1000, Math.round(5000 / (1 + myBonusCount * 0.10)));

  // Energy & Shot calculations in Extreme Mode
  const myEnergy = territory.energy?.[myId] || { shots: 1, lastChargeMs: now, nextChargeTime: null, chargeIntervalMs: myRechargeInterval };
  const chargeInterval = myEnergy.chargeIntervalMs || myRechargeInterval;
  const elapsed = Math.max(0, now - myEnergy.lastChargeMs);
  const earned = Math.floor(elapsed / chargeInterval);
  const availableShots = Math.min(3, myEnergy.shots + earned);
  const remainderMs = elapsed % chargeInterval;
  const chargePercent = availableShots >= 3 ? 100 : Math.min(100, Math.floor((remainderMs / chargeInterval) * 100));
  const secondsUntilNext = availableShots >= 3 ? 0 : ((chargeInterval - remainderMs) / 1000).toFixed(1);

  // Standard mode lock-in state
  const hasSubmitted = lockedCol !== null || territory.submittedPicks[myId] !== undefined;
  const displayLockedCol = lockedCol ?? (typeof territory.submittedPicks[myId] === 'number' ? territory.submittedPicks[myId] : selectedCol);

  const redPlayers = roomState.players.filter(p => territory.teams.red.includes(p.id));
  const bluePlayers = roomState.players.filter(p => territory.teams.blue.includes(p.id));

  function handleStandardLockIn() {
    if (selectedCol !== null && !hasSubmitted) {
      setLockedCol(selectedCol);
      onSubmitPick(selectedCol);
    }
  }

  function handleExtremeFire(c: number) {
    if (availableShots > 0 && !territory?.winnerTeam) {
      setFiredCol(c);
      onSubmitPick(c);
    }
  }

  function handleTileClick(r: number, c: number) {
    if (!territory) return;

    if (isPlacingMine) {
      const redFrontier = territory.board[c];
      const isRedTile = r <= redFrontier;
      const isFriendlyTile = isRedTeam ? isRedTile : isBlueTeam ? !isRedTile : false;

      if (isFriendlyTile && onPlaceMine) {
        onPlaceMine(r, c);
        setIsPlacingMine(false);
        setMineFeedback(`💣 Mine deployed at Col ${c + 1}, Row ${r + 1}!`);
      }
      return;
    }

    if (isExtreme) {
      handleExtremeFire(c);
    } else if (roomState.phase === 'territory-turn' && !hasSubmitted) {
      setSelectedCol(c);
    }
  }

  return (
    <div className="page-top">
      <div className="container-wide animate-fade-up" style={{ maxWidth: 1060 }}>
        {/* Header */}
        <div className="glass p-20" style={{ borderRadius: 'var(--radius-xl)', marginBottom: 20 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <span style={{ fontSize: '1.6rem' }}>⚔️</span>
                <h1 className="heading-md" style={{ margin: 0 }}>Territory Push</h1>
                {isExtreme ? (
                  <span className="badge badge-rose" style={{ animation: 'pulse 2s infinite' }}>🔥 Extreme Real-Time (10x20)</span>
                ) : (
                  <span className="badge badge-purple">Turn {territory.turn}</span>
                )}
              </div>
              <p className="text-xs text-muted" style={{ margin: 0 }}>
                Room: <strong style={{ color: 'var(--amber-400)' }}>{roomState.code}</strong> | {boardHeight}x10 Grid | {isExtreme ? `⚡ Real-Time (+1 / ${(chargeInterval / 1000).toFixed(1)}s) • 8 Booster Nodes` : 'Simultaneous Push'}
              </p>
            </div>

            {/* My Team Banner */}
            <div
              style={{
                padding: '8px 16px',
                borderRadius: 'var(--radius-lg)',
                background: isRedTeam
                  ? 'linear-gradient(135deg, rgba(239,68,68,0.2), rgba(225,29,72,0.1))'
                  : isBlueTeam
                  ? 'linear-gradient(135deg, rgba(6,182,212,0.2), rgba(14,165,233,0.1))'
                  : 'rgba(255,255,255,0.05)',
                border: `2px solid ${isRedTeam ? 'var(--rose-400)' : isBlueTeam ? 'var(--cyan-400)' : 'var(--border)'}`,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <div style={{ fontSize: '1.3rem' }}>{isRedTeam ? '🔴' : isBlueTeam ? '🔵' : '👁️'}</div>
              <div>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>You Are On</div>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: isRedTeam ? 'var(--rose-400)' : isBlueTeam ? 'var(--cyan-400)' : '#fff' }}>
                  Team {myTeamName} {isRedTeam ? `(Top → Row ${boardHeight - 1})` : isBlueTeam ? '(Bottom → Row 0)' : ''}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Explosion Alert Banner */}
        {latestExplosion && isLatestExplosionRecent && (
          <div
            className="glass p-16 animate-fade-up"
            style={{
              borderRadius: 'var(--radius-xl)',
              marginBottom: 20,
              background: 'linear-gradient(135deg, rgba(239,68,68,0.25), rgba(245,158,11,0.2))',
              border: '2px solid rgba(239,68,68,0.7)',
              boxShadow: '0 0 25px rgba(239,68,68,0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: '2rem', animation: 'pulse 1s infinite' }}>💥</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: '#fff' }}>
                  {latestExplosion.message}
                </div>
                <p className="text-xs text-muted" style={{ margin: '2px 0 0' }}>
                  Detonation blast engulfed 2-tile radius (Columns {latestExplosion.affectedCols.map(c => `C${c + 1}`).join(', ')}) converting them to Team {latestExplosion.team.toUpperCase()}!
                </p>
              </div>
            </div>
            <span className="badge badge-rose" style={{ fontSize: '0.75rem', fontWeight: 800 }}>TRAP DETONATED</span>
          </div>
        )}

        {/* Mine Trap Control Bar */}
        {(isRedTeam || isBlueTeam) && !territory.winnerTeam && (
          <div
            className="glass p-14 animate-fade-up"
            style={{
              borderRadius: 'var(--radius-xl)',
              marginBottom: 20,
              background: isPlacingMine
                ? 'linear-gradient(135deg, rgba(74,222,128,0.15), rgba(16,185,129,0.1))'
                : 'linear-gradient(135deg, rgba(168,85,247,0.12), rgba(99,102,241,0.08))',
              border: `1px solid ${isPlacingMine ? 'rgba(74,222,128,0.5)' : 'rgba(168,85,247,0.3)'}`,
              boxShadow: isPlacingMine ? '0 0 20px rgba(74,222,128,0.2)' : 'none',
              transition: 'all 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: '1.4rem' }}>💣</span>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#fff' }}>
                      {myMine
                        ? `Mine Trap Armed at Col ${myMine.col + 1}, Row ${myMine.row + 1}`
                        : 'Mine Trap Ready (1/1 Available)'}
                    </span>
                    {myMine && (
                      <span className="badge badge-purple" style={{ fontSize: '0.65rem' }}>
                        ACTIVE TRAP
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted" style={{ margin: '2px 0 0' }}>
                    {isPlacingMine
                      ? '🎯 Target mode: Click any friendly territory tile on the grid below to deploy your trap!'
                      : '2-Tile Blast: If an enemy attacks this tile, it detonates and claims all tiles within 2 squares for your team.'}
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {mineFeedback && (
                  <span style={{ fontSize: '0.8rem', color: 'var(--green-400)', fontWeight: 700 }}>
                    {mineFeedback}
                  </span>
                )}
                <button
                  type="button"
                  id="deploy-mine-btn"
                  onClick={() => setIsPlacingMine(!isPlacingMine)}
                  className={`btn btn-sm ${isPlacingMine ? 'btn-secondary' : myMine ? 'btn-secondary' : 'btn-primary'}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    borderColor: isPlacingMine ? 'rgba(74,222,128,0.5)' : undefined,
                  }}
                >
                  <span>{isPlacingMine ? '✖ Cancel' : myMine ? '🔄 Move Mine' : '💣 Place Mine Trap'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Extreme Mode Real-Time Energy HUD */}
        {isExtreme && (
          <div
            className="glass p-16 animate-fade-up"
            style={{
              borderRadius: 'var(--radius-xl)',
              marginBottom: 20,
              background: 'linear-gradient(135deg, rgba(244,63,94,0.12), rgba(6,182,212,0.08))',
              border: '1px solid rgba(244,63,94,0.3)',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '1.2rem' }}>⚡</span>
                  <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#fff' }}>
                    Stored Push Charges: <span style={{ color: availableShots > 0 ? (isRedTeam ? 'var(--rose-400)' : 'var(--cyan-400)') : 'var(--text-muted)', fontSize: '1.15rem' }}>{availableShots} / 3</span>
                  </span>
                </div>
                <p className="text-xs text-muted" style={{ margin: '3px 0 0' }}>
                  {availableShots >= 3
                    ? '⚡ Maximum charge reached! Click any column C1–C10 below to fire immediately.'
                    : `🔋 Next shot ready in ${secondsUntilNext}s (+1 charge every ${(chargeInterval / 1000).toFixed(1)}s • ${myBonusCount} booster${myBonusCount === 1 ? '' : 's'} controlled)`}
                </p>
              </div>

              {/* 3 Charge Pods & Bar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[0, 1, 2].map((slotIdx) => {
                    const isCharged = slotIdx < availableShots;
                    const isCurrentlyCharging = slotIdx === availableShots && availableShots < 3;

                    return (
                      <div
                        key={slotIdx}
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 'var(--radius-md)',
                          background: isCharged
                            ? (isRedTeam ? 'rgba(239,68,68,0.25)' : 'rgba(6,182,212,0.25)')
                            : 'rgba(0,0,0,0.35)',
                          border: `2px solid ${isCharged ? (isRedTeam ? 'var(--rose-400)' : 'var(--cyan-400)') : isCurrentlyCharging ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.1)'}`,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          position: 'relative',
                          overflow: 'hidden',
                          boxShadow: isCharged ? `0 0 12px ${isRedTeam ? 'rgba(239,68,68,0.4)' : 'rgba(6,182,212,0.4)'}` : 'none',
                        }}
                      >
                        {isCurrentlyCharging && (
                          <div
                            style={{
                              position: 'absolute',
                              bottom: 0,
                              left: 0,
                              right: 0,
                              height: `${chargePercent}%`,
                              background: isRedTeam ? 'rgba(239,68,68,0.3)' : 'rgba(6,182,212,0.3)',
                              transition: 'height 0.1s linear',
                              zIndex: 0,
                            }}
                          />
                        )}
                        <span style={{ fontSize: '1.1rem', zIndex: 1, opacity: isCharged ? 1 : 0.4 }}>
                          {isCharged ? '⚡' : isCurrentlyCharging ? '⏳' : '⚪'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Smooth Charge Bar */}
            {availableShots < 3 && (
              <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, marginTop: 12, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${chargePercent}%`,
                    background: isRedTeam ? 'linear-gradient(90deg, #f43f5e, #ef4444)' : 'linear-gradient(90deg, #06b6d4, #38bdf8)',
                    transition: 'width 0.1s linear',
                  }}
                />
              </div>
            )}

            {/* Recharge Booster Control Bar */}
            {bonusSquares.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  marginTop: 12,
                  paddingTop: 10,
                  borderTop: '1px solid rgba(255,255,255,0.1)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                    ⚡ Map Boosters (+10% Team Speed):
                  </span>
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-full)',
                      background: 'rgba(239,68,68,0.15)',
                      border: '1px solid rgba(239,68,68,0.4)',
                      fontSize: '0.75rem',
                      color: 'var(--rose-400)',
                      fontWeight: 700,
                    }}
                  >
                    <span>🔴 Red: {redBonuses}/{bonusSquares.length}</span>
                    <span style={{ opacity: 0.8, fontSize: '0.7rem' }}>
                      (+{redBonuses * 10}% • {(5000 / (1 + redBonuses * 0.1) / 1000).toFixed(1)}s)
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-full)',
                      background: 'rgba(6,182,212,0.15)',
                      border: '1px solid rgba(6,182,212,0.4)',
                      fontSize: '0.75rem',
                      color: 'var(--cyan-400)',
                      fontWeight: 700,
                    }}
                  >
                    <span>🔵 Blue: {blueBonuses}/{bonusSquares.length}</span>
                    <span style={{ opacity: 0.8, fontSize: '0.7rem' }}>
                      (+{blueBonuses * 10}% • {(5000 / (1 + blueBonuses * 0.1) / 1000).toFixed(1)}s)
                    </span>
                  </div>
                </div>

                <div style={{ fontSize: '0.75rem', color: isRedTeam ? 'var(--rose-400)' : isBlueTeam ? 'var(--cyan-400)' : 'var(--text-muted)', fontWeight: 600 }}>
                  Your Team: +{myBonusCount * 10}% Speed ({(chargeInterval / 1000).toFixed(1)}s / shot)
                </div>
              </div>
            )}
          </div>
        )}

        {/* Main Content Layout: Board + Side Panel */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) 340px', gap: 20 }} className="responsive-grid">
          {/* Board Section */}
          <div className="glass p-20" style={{ borderRadius: 'var(--radius-xl)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {/* Top Column Labels & Shift Indicators */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', width: '100%', maxWidth: 460, gap: 4, marginBottom: 6, textAlign: 'center' }}>
              {Array.from({ length: 10 }).map((_, c) => {
                const isSelected = selectedCol === c || firedCol === c;
                const lastRes = territory.lastResolutions?.[c];
                const delta = lastRes ? lastRes.newFrontier - lastRes.oldFrontier : 0;
                const hadAction = lastRes ? (lastRes.redPicks.length > 0 || lastRes.bluePicks.length > 0) : false;
                const isExplosionCol = latestExplosion && isLatestExplosionRecent && latestExplosion.affectedCols.includes(c);

                return (
                  <div key={c} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        color: isExplosionCol
                          ? 'var(--amber-400)'
                          : isSelected ? (isRedTeam ? 'var(--rose-400)' : 'var(--cyan-400)') : 'var(--text-muted)',
                      }}
                    >
                      {isExplosionCol ? '💥' : `C${c + 1}`}
                    </span>
                    {!isExtreme && lastRes && hadAction ? (
                      <span
                        style={{
                          fontSize: '0.58rem',
                          fontWeight: 800,
                          padding: '1px 2px',
                          borderRadius: 3,
                          marginTop: 1,
                          lineHeight: 1,
                          color: delta > 0 ? '#fff' : delta < 0 ? '#fff' : 'var(--amber-400)',
                          background: delta > 0 ? 'rgba(239,68,68,0.7)' : delta < 0 ? 'rgba(6,182,212,0.7)' : 'rgba(251,191,36,0.2)',
                          border: `1px solid ${delta > 0 ? 'rgba(239,68,68,0.9)' : delta < 0 ? 'rgba(6,182,212,0.9)' : 'rgba(251,191,36,0.5)'}`,
                        }}
                        title={`Last Turn Col ${c + 1}: ${lastRes.clashResult}`}
                      >
                        {delta > 0 ? `+${delta}↓` : delta < 0 ? `+${-delta}↑` : '⚔️'}
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.55rem', color: 'rgba(255,255,255,0.2)', marginTop: 1 }}>·</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Grid Container (10x10 or 10x20) */}
            <div
              style={{
                display: 'grid',
                gridTemplateRows: `repeat(${boardHeight}, 1fr)`,
                gap: isExtreme ? 2 : 4,
                width: '100%',
                maxWidth: 460,
                maxHeight: isExtreme ? '620px' : undefined,
                aspectRatio: isExtreme ? '10/16' : '1/1',
                background: 'rgba(0, 0, 0, 0.45)',
                padding: 6,
                borderRadius: 'var(--radius-lg)',
                border: isPlacingMine ? '2px solid rgba(74,222,128,0.6)' : '1px solid var(--border)',
                position: 'relative',
              }}
            >
              {Array.from({ length: boardHeight }).map((_, r) => (
                <div
                  key={r}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(10, 1fr)',
                    gap: isExtreme ? 2 : 4,
                    borderBottom: r === midRow ? '2px dashed rgba(255, 255, 255, 0.45)' : undefined,
                    paddingBottom: r === midRow ? (isExtreme ? 1 : 2) : 0,
                  }}
                >
                  {Array.from({ length: 10 }).map((_, c) => {
                    const redFrontier = territory.board[c]; // Red owns rows 0..redFrontier
                    const isRedTile = r <= redFrontier;
                    const isBoundaryTile = r === redFrontier;
                    const isSelectedColumn = selectedCol === c || firedCol === c;
                    const isFriendlyTile = isRedTeam ? isRedTile : isBlueTeam ? !isRedTile : false;

                    // Mine check
                    const tileMine = allTeamMines.find(m => m.row === r && m.col === c);
                    const isMyMineTile = tileMine?.playerId === myId;

                    // Booster square check
                    const bonusSquare = bonusSquares.find(sq => sq.row === r && sq.col === c);
                    const isBonus = !!bonusSquare;
                    const isStolen = isBonus && ((isRedTile && bonusSquare.initialTeam === 'blue') || (!isRedTile && bonusSquare.initialTeam === 'red'));

                    // Standard turn shift calculation
                    const lastRes = territory.lastResolutions?.[c];
                    let tileShiftType: 'red-capture' | 'blue-capture' | 'held' | null = null;
                    if (!isExtreme && lastRes) {
                      const delta = lastRes.newFrontier - lastRes.oldFrontier;
                      if (delta > 0 && r > lastRes.oldFrontier && r <= lastRes.newFrontier) {
                        tileShiftType = 'red-capture';
                      } else if (delta < 0 && r > lastRes.newFrontier && r <= lastRes.oldFrontier) {
                        tileShiftType = 'blue-capture';
                      } else if (delta === 0 && (lastRes.redPicks.length > 0 || lastRes.bluePicks.length > 0) && r === lastRes.newFrontier) {
                        tileShiftType = 'held';
                      }
                    }

                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => handleTileClick(r, c)}
                        style={{
                          background: isPlacingMine && isFriendlyTile
                            ? isRedTile
                              ? 'linear-gradient(135deg, rgba(239,68,68,0.85), rgba(74,222,128,0.35))'
                              : 'linear-gradient(135deg, rgba(6,182,212,0.85), rgba(74,222,128,0.35))'
                            : isBonus
                            ? isRedTile
                              ? isBoundaryTile
                                ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
                                : 'linear-gradient(135deg, #dc2626, #b45309)'
                              : (r === redFrontier + 1)
                              ? 'linear-gradient(135deg, #0284c7, #06b6d4)'
                              : 'linear-gradient(135deg, #0369a1, #0891b2)'
                            : isRedTile
                            ? isBoundaryTile
                              ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                              : tileShiftType === 'red-capture'
                              ? 'linear-gradient(135deg, #f87171, #ef4444)'
                              : 'rgba(239, 68, 68, 0.65)'
                            : (r === redFrontier + 1)
                            ? 'linear-gradient(135deg, #06b6d4, #0284c7)'
                            : tileShiftType === 'blue-capture'
                            ? 'linear-gradient(135deg, #38bdf8, #0ea5e9)'
                            : 'rgba(6, 182, 212, 0.65)',
                          border: isPlacingMine && isFriendlyTile
                            ? '2px dashed #4ade80'
                            : tileMine
                            ? `2px solid ${isMyMineTile ? '#facc15' : 'rgba(255,255,255,0.9)'}`
                            : isSelectedColumn
                            ? `2px solid ${isRedTeam ? '#f43f5e' : '#38bdf8'}`
                            : isBonus
                            ? `2px solid ${isRedTile ? '#fbbf24' : '#38bdf8'}`
                            : tileShiftType === 'red-capture'
                            ? '2px solid rgba(254, 202, 202, 0.9)'
                            : tileShiftType === 'blue-capture'
                            ? '2px solid rgba(186, 230, 253, 0.9)'
                            : isBoundaryTile
                            ? '1px solid rgba(255,255,255,0.8)'
                            : '1px solid rgba(255,255,255,0.04)',
                          borderRadius: isExtreme ? 2 : 4,
                          cursor: isPlacingMine
                            ? isFriendlyTile ? 'crosshair' : 'not-allowed'
                            : isExtreme
                            ? availableShots > 0 ? 'pointer' : 'not-allowed'
                            : !hasSubmitted && roomState.phase === 'territory-turn' ? 'pointer' : 'default',
                          transition: 'all 0.1s ease',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          position: 'relative',
                          boxShadow: tileMine
                            ? `0 0 12px ${isMyMineTile ? 'rgba(250,204,21,0.8)' : 'rgba(255,255,255,0.5)'}`
                            : isSelectedColumn
                            ? '0 0 14px rgba(255,255,255,0.6)'
                            : isBonus
                            ? `0 0 10px ${isRedTile ? 'rgba(245,158,11,0.85)' : 'rgba(56,189,248,0.85)'}`
                            : isBoundaryTile
                            ? `0 0 8px ${isRedTile ? 'rgba(239,68,68,0.5)' : 'rgba(6,182,212,0.5)'}`
                            : 'none',
                        }}
                        title={
                          tileMine
                            ? `${isMyMineTile ? '💣 YOUR MINE TRAP' : `💣 ${tileMine.playerName}'s Mine Trap`} | Detonates 2-Tile Radius Blast if attacked! | Col ${c + 1}, Row ${r + 1}`
                            : isBonus
                            ? `⚡ Recharge Booster (+10% Team Speed) | Controlled by ${isRedTile ? 'Team Red' : 'Team Blue'}${isStolen ? ' (STOLEN from enemy!)' : ' (Native)'} | Col ${c + 1}, Row ${r + 1}`
                            : `Col ${c + 1}, Row ${r + 1} | ${isRedTile ? 'Red Territory' : 'Blue Territory'}`
                        }
                      >
                        {tileMine && (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              lineHeight: 1,
                              pointerEvents: 'none',
                              userSelect: 'none',
                              zIndex: 2,
                            }}
                          >
                            <span
                              style={{
                                fontSize: isExtreme ? '0.75rem' : '0.9rem',
                                filter: 'drop-shadow(0 0 4px rgba(0,0,0,0.95))',
                                animation: 'pulse 1.8s infinite',
                              }}
                            >
                              💣
                            </span>
                            {isMyMineTile && (
                              <span
                                style={{
                                  fontSize: '0.45rem',
                                  fontWeight: 900,
                                  color: '#facc15',
                                  background: 'rgba(0,0,0,0.85)',
                                  padding: '0 2px',
                                  borderRadius: 2,
                                  marginTop: -2,
                                  lineHeight: 1,
                                }}
                              >
                                YOU
                              </span>
                            )}
                          </div>
                        )}
                        {!tileMine && isBonus && (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              lineHeight: 1,
                              pointerEvents: 'none',
                              userSelect: 'none',
                            }}
                          >
                            <span
                              style={{
                                fontSize: isExtreme ? '0.7rem' : '0.8rem',
                                filter: 'drop-shadow(0 0 3px rgba(0,0,0,0.9))',
                              }}
                            >
                              ⚡
                            </span>
                            {isExtreme && (
                              <span
                                style={{
                                  fontSize: '0.45rem',
                                  fontWeight: 900,
                                  color: isStolen ? '#fef08a' : '#fff',
                                  background: isStolen ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.45)',
                                  padding: '0 2px',
                                  borderRadius: 2,
                                  marginTop: -1,
                                  textShadow: '0 1px 2px rgba(0,0,0,0.9)',
                                  lineHeight: '0.9',
                                }}
                              >
                                +10%
                              </span>
                            )}
                          </div>
                        )}
                        {!tileMine && !isBonus && tileShiftType === 'red-capture' && (
                          <span style={{ fontSize: '0.65rem', fontWeight: 900, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
                            ↓
                          </span>
                        )}
                        {!tileMine && !isBonus && tileShiftType === 'blue-capture' && (
                          <span style={{ fontSize: '0.65rem', fontWeight: 900, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
                            ↑
                          </span>
                        )}
                        {!tileMine && !isBonus && tileShiftType === 'held' && (
                          <span style={{ fontSize: '0.55rem' }}>🛡️</span>
                        )}
                        {!tileMine && !isBonus && !tileShiftType && isBoundaryTile && r === 0 && <span style={{ fontSize: isExtreme ? '0.45rem' : '0.55rem' }}>🚩</span>}
                        {!tileMine && !isBonus && !tileShiftType && isBoundaryTile && r === boardHeight - 1 && <span style={{ fontSize: isExtreme ? '0.45rem' : '0.55rem' }}>🚩</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Column Trigger Action Buttons */}
            <div style={{ width: '100%', maxWidth: 460, marginTop: 14 }}>
              <label className="text-xs text-muted" style={{ display: 'block', textAlign: 'center', marginBottom: 8, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                {isExtreme
                  ? availableShots > 0
                    ? `⚡ CLICK COLUMN TO PUSH (${availableShots} SHOT${availableShots !== 1 ? 'S' : ''} READY)`
                    : '⏳ CHARGING NEXT SHOT...'
                  : hasSubmitted ? '✓ Column Locked In' : 'Select Column to Push'}
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 4 }}>
                {Array.from({ length: 10 }).map((_, c) => {
                  const isSelected = selectedCol === c || firedCol === c;
                  const frontier = territory.board[c];
                  const isDefendingCol = !isExtreme && ((isRedTeam && frontier < 4) || (isBlueTeam && frontier > 4));
                  const colBonus = bonusSquares.find(sq => sq.col === c);

                  return (
                    <button
                      key={c}
                      type="button"
                      id={`col-select-btn-${c}`}
                      disabled={isExtreme ? availableShots < 1 : hasSubmitted}
                      onClick={() => {
                        if (isExtreme) {
                          handleExtremeFire(c);
                        } else {
                          setSelectedCol(c);
                        }
                      }}
                      style={{
                        padding: isExtreme ? '10px 0' : '8px 0',
                        borderRadius: 'var(--radius-md)',
                        background: isSelected
                          ? isRedTeam ? 'var(--rose-400)' : 'var(--cyan-400)'
                          : 'rgba(255,255,255,0.06)',
                        color: isSelected ? '#fff' : 'var(--text-primary)',
                        border: `1px solid ${isSelected ? '#fff' : colBonus ? 'rgba(251,191,36,0.5)' : 'var(--border)'}`,
                        fontWeight: 800,
                        fontSize: '0.85rem',
                        cursor: (isExtreme ? availableShots < 1 : hasSubmitted) ? 'not-allowed' : 'pointer',
                        transition: 'all 0.1s',
                        position: 'relative',
                        boxShadow: isSelected ? '0 0 12px rgba(255,255,255,0.5)' : 'none',
                        opacity: isExtreme && availableShots < 1 ? 0.45 : 1,
                      }}
                    >
                      <div>{c + 1}</div>
                      <div style={{ fontSize: '0.6rem', color: isSelected ? '#fff' : 'var(--text-muted)', marginTop: 2 }}>
                        {isRedTeam ? '↓' : '↑'}
                      </div>
                      {isDefendingCol && (
                        <span style={{ position: 'absolute', top: -4, right: -2, fontSize: '0.6rem' }} title="Defender Advantage Active!">
                          🛡️
                        </span>
                      )}
                      {colBonus && (
                        <span
                          style={{
                            position: 'absolute',
                            top: -5,
                            right: -3,
                            fontSize: '0.55rem',
                            background: 'rgba(0,0,0,0.85)',
                            borderRadius: '50%',
                            padding: '1px',
                            border: '1px solid rgba(251,191,36,0.8)',
                          }}
                          title={`Column contains a +10% Recharge Booster at Row ${colBonus.row}!`}
                        >
                          ⚡
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Standard Mode Submit Button */}
              {!isExtreme && (
                <>
                  {!hasSubmitted ? (
                    <button
                      type="button"
                      id="lock-in-column-btn"
                      disabled={selectedCol === null}
                      onClick={handleStandardLockIn}
                      className={`btn btn-lg btn-full ${selectedCol !== null ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ marginTop: 14 }}
                    >
                      {selectedCol !== null ? `🚀 Lock In Column ${selectedCol + 1}` : 'Select a Column above'}
                    </button>
                  ) : (
                    <div
                      className="glass text-center"
                      style={{ padding: '12px', borderRadius: 'var(--radius-lg)', marginTop: 14, background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)' }}
                    >
                      <span style={{ color: 'var(--green-400)', fontWeight: 700 }}>
                        ✓ Locked in Column {displayLockedCol !== null ? displayLockedCol + 1 : ''}!
                      </span>
                      <p className="text-xs text-muted" style={{ margin: '4px 0 0' }}>Waiting for all players to submit...</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Sidebar: Roster & Battle / Turn Feed */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Team Red Roster */}
            <div className="glass p-16" style={{ borderRadius: 'var(--radius-xl)', borderLeft: '4px solid var(--rose-400)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontWeight: 800, color: 'var(--rose-400)', fontSize: '0.95rem' }}>🔴 Team Red (Top)</span>
                <span className="badge badge-muted" style={{ fontSize: '0.65rem' }}>{redPlayers.length} players</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {redPlayers.map(p => {
                  const isDone = territory.submittedPicks[p.id] !== undefined;
                  const pEnergy = territory.energy?.[p.id];
                  return (
                    <div
                      key={p.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        background: 'rgba(255,255,255,0.03)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '0.85rem',
                      }}
                    >
                      <span style={{ fontWeight: p.id === myId ? 700 : 400 }}>
                        {p.name} {p.id === myId ? '(You)' : ''}
                      </span>
                      {isExtreme ? (
                        <span className="text-xs" style={{ color: (pEnergy?.shots ?? 0) > 0 ? 'var(--rose-400)' : 'var(--text-muted)', fontWeight: 700 }}>
                          ⚡ {pEnergy?.shots ?? 0} shots
                        </span>
                      ) : (
                        <span className="text-xs" style={{ color: isDone ? 'var(--green-400)' : 'var(--amber-400)' }}>
                          {isDone ? '✓ Ready' : '⏳ Picking'}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Team Blue Roster */}
            <div className="glass p-16" style={{ borderRadius: 'var(--radius-xl)', borderLeft: '4px solid var(--cyan-400)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontWeight: 800, color: 'var(--cyan-400)', fontSize: '0.95rem' }}>🔵 Team Blue (Bottom)</span>
                <span className="badge badge-muted" style={{ fontSize: '0.65rem' }}>{bluePlayers.length} players</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {bluePlayers.map(p => {
                  const isDone = territory.submittedPicks[p.id] !== undefined;
                  const pEnergy = territory.energy?.[p.id];
                  return (
                    <div
                      key={p.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        background: 'rgba(255,255,255,0.03)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '0.85rem',
                      }}
                    >
                      <span style={{ fontWeight: p.id === myId ? 700 : 400 }}>
                        {p.name} {p.id === myId ? '(You)' : ''}
                      </span>
                      {isExtreme ? (
                        <span className="text-xs" style={{ color: (pEnergy?.shots ?? 0) > 0 ? 'var(--cyan-400)' : 'var(--text-muted)', fontWeight: 700 }}>
                          ⚡ {pEnergy?.shots ?? 0} shots
                        </span>
                      ) : (
                        <span className="text-xs" style={{ color: isDone ? 'var(--green-400)' : 'var(--amber-400)' }}>
                          {isDone ? '✓ Ready' : '⏳ Picking'}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Live Combat Feed (Extreme) / Battle Log (Standard) */}
            <div className="glass p-16 animate-fade-up" style={{ borderRadius: 'var(--radius-xl)', border: '1px solid rgba(255,255,255,0.15)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontWeight: 800, fontSize: '0.95rem', color: isExtreme ? 'var(--rose-400)' : 'var(--amber-400)' }}>
                  {isExtreme ? '⚡ Live Combat Feed' : '📜 Battle Log'}
                </span>
                <span className="badge badge-muted" style={{ fontSize: '0.65rem' }}>
                  {isExtreme
                    ? `${territory.recentShots?.length || 0} recent shots`
                    : territory.turnHistory && territory.turnHistory.length > 0 ? `${territory.turnHistory.length} turns recorded` : 'Turn 1 in progress'}
                </span>
              </div>

              {isExtreme ? (
                /* Extreme Mode Live Push Stream */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
                  {territory.recentShots && territory.recentShots.length > 0 ? (
                    territory.recentShots.map((shot) => {
                      const isRed = shot.team === 'red';
                      const secondsAgo = Math.max(0, Math.floor((now - shot.timestamp) / 1000));

                      return (
                        <div
                          key={shot.id}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 'var(--radius-md)',
                            background: isRed ? 'rgba(239,68,68,0.12)' : 'rgba(6,182,212,0.12)',
                            border: `1px solid ${isRed ? 'rgba(239,68,68,0.3)' : 'rgba(6,182,212,0.3)'}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            fontSize: '0.78rem',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span>{isRed ? '🔴' : '🔵'}</span>
                            <span style={{ fontWeight: 700, color: isRed ? 'var(--rose-400)' : 'var(--cyan-400)' }}>
                              {shot.playerName}
                            </span>
                            <span style={{ color: 'var(--text-muted)' }}>
                              pushed <strong style={{ color: '#fff' }}>Col {shot.col + 1}</strong> ({isRed ? '+1↓' : '+1↑'})
                            </span>
                          </div>
                          <span className="text-xs text-muted" style={{ fontSize: '0.65rem' }}>
                            {secondsAgo}s ago
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    <div style={{ padding: '16px 12px', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-lg)' }}>
                      <p className="text-xs text-muted" style={{ margin: 0 }}>
                        Real-time combat active! Click any column to launch your first push.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                /* Standard Mode Turn History */
                territory.turnHistory && territory.turnHistory.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 300, overflowY: 'auto', paddingRight: 4 }}>
                    {[...territory.turnHistory].reverse().map((hist) => {
                      const activeResolutions = hist.resolutions.filter(r => r.redPicks.length > 0 || r.bluePicks.length > 0);
                      return (
                        <div
                          key={hist.turn}
                          style={{
                            background: 'rgba(255,255,255,0.03)',
                            borderRadius: 'var(--radius-lg)',
                            padding: '10px 12px',
                            border: '1px solid var(--border)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                            <span style={{ fontWeight: 800, fontSize: '0.8rem', color: 'var(--amber-400)' }}>
                              ⚡ Turn {hist.turn}
                            </span>
                            <span className="text-xs text-muted" style={{ fontSize: '0.65rem' }}>
                              {activeResolutions.length} clash{activeResolutions.length !== 1 ? 'es' : ''}
                            </span>
                          </div>

                          {activeResolutions.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {activeResolutions.map((res) => (
                                <div
                                  key={res.col}
                                  style={{
                                    padding: '6px 8px',
                                    borderRadius: 'var(--radius-md)',
                                    background: 'rgba(0,0,0,0.3)',
                                    fontSize: '0.75rem',
                                    border: '1px solid rgba(255,255,255,0.06)',
                                  }}
                                >
                                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
                                    Col {res.col + 1}: {res.clashResult}
                                  </div>
                                  <div className="text-muted flex flex-wrap gap-6" style={{ fontSize: '0.68rem' }}>
                                    {res.redPicks.length > 0 && (
                                      <span style={{ color: 'var(--rose-400)' }}>Red: {res.redPicks.join(', ')}</span>
                                    )}
                                    {res.bluePicks.length > 0 && (
                                      <span style={{ color: 'var(--cyan-400)' }}>Blue: {res.bluePicks.join(', ')}</span>
                                    )}
                                    {res.defenderAdvantageApplied && (
                                      <span style={{ color: 'var(--amber-400)' }}>🛡️ Defender Bonus ({res.defenderAdvantageApplied})</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-xs text-muted" style={{ fontStyle: 'italic' }}>
                              No active clashes this turn
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ padding: '16px 12px', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-lg)' }}>
                    <p className="text-xs text-muted" style={{ margin: 0 }}>
                      No turn history yet. Lock in your column pick above to start the first clash!
                    </p>
                  </div>
                )
              )}
            </div>

            {/* Tactical Intel / Field Guide Card */}
            <div className="glass p-16 animate-fade-up" style={{ borderRadius: 'var(--radius-xl)', border: '1px solid rgba(168,85,247,0.25)', background: 'linear-gradient(135deg, rgba(168,85,247,0.08), rgba(0,0,0,0.3))' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: '1.1rem' }}>🛡️</span>
                <span style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--purple-400)' }}>Tactical Intel</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li>
                  <strong style={{ color: '#fff' }}>💣 Hidden Mine Traps:</strong> Place 1 secret mine anywhere in your team's territory. If the enemy invades it, it blasts a <strong style={{ color: '#facc15' }}>2-tile radius (5x5 zone)</strong> converting all tiles to your team! After exploding, your mine is refunded to deploy again.
                </li>
                {bonusSquares.length > 0 && (
                  <li>
                    <strong style={{ color: '#fff' }}>⚡ +10% Speed Boosters:</strong> Controlling booster nodes speeds up your entire team's charge rate by +10% per square.
                  </li>
                )}
                {!isExtreme && (
                  <li>
                    <strong style={{ color: '#fff' }}>🛡️ Defender Advantage:</strong> Defending behind your home 4 rows grants +1 free defensive push value in clashes.
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>

        {/* Victory Modal */}
        {territory.winnerTeam && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.85)',
              backdropFilter: 'blur(10px)',
              zIndex: 100,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 20,
            }}
            className="animate-fade-up"
          >
            <div
              className="glass p-32 text-center"
              style={{
                maxWidth: 480,
                width: '100%',
                borderRadius: 'var(--radius-2xl)',
                border: `2px solid ${territory.winnerTeam === 'red' ? 'var(--rose-400)' : 'var(--cyan-400)'}`,
                boxShadow: `0 0 40px ${territory.winnerTeam === 'red' ? 'rgba(244,63,94,0.4)' : 'rgba(6,182,212,0.4)'}`,
              }}
            >
              <div style={{ fontSize: '4rem', marginBottom: 12 }}>🏆</div>
              <h2 className="heading-xl" style={{ marginBottom: 8 }}>
                Team <span style={{ color: territory.winnerTeam === 'red' ? 'var(--rose-400)' : 'var(--cyan-400)' }}>{territory.winnerTeam.toUpperCase()}</span> Victory!
              </h2>
              <p className="text-muted text-sm" style={{ marginBottom: 24 }}>
                Team {territory.winnerTeam.toUpperCase()} successfully broke through and reached the enemy back line!
              </p>

              {isHost && (
                <button
                  type="button"
                  id="victory-next-btn"
                  onClick={onNextTurn}
                  className="btn btn-primary btn-lg btn-full"
                >
                  📊 View Final Scores
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
