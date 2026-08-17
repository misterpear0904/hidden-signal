import React, { useState, useEffect } from 'react';
import type { RoomState } from '../types/game';

interface Props {
  roomState: RoomState;
  myId: string;
  isHost: boolean;
  onSubmitPick: (colIndex: number) => void;
  onNextTurn: () => void;
}

export default function TerritoryPushGame({ roomState, myId, isHost, onSubmitPick, onNextTurn }: Props) {
  const [selectedCol, setSelectedCol] = useState<number | null>(null);
  const [lockedCol, setLockedCol] = useState<number | null>(null);
  const territory = roomState.territoryState;

  // Reset local selection ONLY when the turn changes
  useEffect(() => {
    setSelectedCol(null);
    setLockedCol(null);
  }, [territory?.turn]);

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

  const hasSubmitted = lockedCol !== null || territory.submittedPicks[myId] !== undefined;
  const displayLockedCol = lockedCol ?? (typeof territory.submittedPicks[myId] === 'number' ? territory.submittedPicks[myId] : selectedCol);

  const redPlayers = roomState.players.filter(p => territory.teams.red.includes(p.id));
  const bluePlayers = roomState.players.filter(p => territory.teams.blue.includes(p.id));

  function handleLockIn() {
    if (selectedCol !== null && !hasSubmitted) {
      setLockedCol(selectedCol);
      onSubmitPick(selectedCol);
    }
  }

  return (
    <div className="page-top">
      <div className="container-wide animate-fade-up" style={{ maxWidth: 1000 }}>
        {/* Header */}
        <div className="glass p-20" style={{ borderRadius: 'var(--radius-xl)', marginBottom: 20 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <span style={{ fontSize: '1.6rem' }}>⚔️</span>
                <h1 className="heading-md" style={{ margin: 0 }}>Territory Push</h1>
                <span className="badge badge-purple">Turn {territory.turn}</span>
              </div>
              <p className="text-xs text-muted" style={{ margin: 0 }}>
                Room: <strong style={{ color: 'var(--amber-400)' }}>{roomState.code}</strong> | Grid 10x10 | Simultaneous Push
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
                  Team {myTeamName} {isRedTeam ? '(Top → Row 9)' : isBlueTeam ? '(Bottom → Row 0)' : ''}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Layout: Grid + Side Panel */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) 340px', gap: 20 }} className="responsive-grid">
          {/* 10x10 Board Section */}
          <div className="glass p-20" style={{ borderRadius: 'var(--radius-xl)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {/* Top Column Labels & Previous Move Indicators */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', width: '100%', maxWidth: 440, gap: 4, marginBottom: 6, textAlign: 'center' }}>
              {Array.from({ length: 10 }).map((_, c) => {
                const isSelected = selectedCol === c;
                const lastRes = territory.lastResolutions?.[c];
                const delta = lastRes ? lastRes.newFrontier - lastRes.oldFrontier : 0;
                const hadAction = lastRes ? (lastRes.redPicks.length > 0 || lastRes.bluePicks.length > 0) : false;

                return (
                  <div key={c} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        color: isSelected ? (isRedTeam ? 'var(--rose-400)' : 'var(--cyan-400)') : 'var(--text-muted)',
                      }}
                    >
                      C{c + 1}
                    </span>
                    {/* Previous turn shift indicator badge */}
                    {lastRes && hadAction ? (
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

            {/* 10x10 Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateRows: 'repeat(10, 1fr)',
                gap: 4,
                width: '100%',
                maxWidth: 440,
                aspectRatio: '1/1',
                background: 'rgba(0, 0, 0, 0.4)',
                padding: 6,
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border)',
                position: 'relative',
              }}
            >
              {Array.from({ length: 10 }).map((_, r) => (
                <div
                  key={r}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(10, 1fr)',
                    gap: 4,
                    borderBottom: r === 4 ? '2px dashed rgba(255, 255, 255, 0.35)' : undefined,
                    paddingBottom: r === 4 ? 2 : 0,
                  }}
                >
                  {Array.from({ length: 10 }).map((_, c) => {
                    const redFrontier = territory.board[c]; // Red owns rows 0..redFrontier
                    const isRedTile = r <= redFrontier;
                    const isBoundaryTile = r === redFrontier;
                    const isSelectedColumn = selectedCol === c;

                    // Compute if this specific tile was captured in the last turn
                    const lastRes = territory.lastResolutions?.[c];
                    let tileShiftType: 'red-capture' | 'blue-capture' | 'held' | null = null;
                    if (lastRes) {
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
                        onClick={() => {
                          if (roomState.phase === 'territory-turn' && !hasSubmitted) {
                            setSelectedCol(c);
                          }
                        }}
                        style={{
                          background: isRedTile
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
                          border: isSelectedColumn
                            ? `2px solid ${isRedTeam ? '#f43f5e' : '#38bdf8'}`
                            : tileShiftType === 'red-capture'
                            ? '2px solid rgba(254, 202, 202, 0.9)'
                            : tileShiftType === 'blue-capture'
                            ? '2px solid rgba(186, 230, 253, 0.9)'
                            : isBoundaryTile
                            ? '1px solid rgba(255,255,255,0.7)'
                            : '1px solid rgba(255,255,255,0.05)',
                          borderRadius: 4,
                          cursor: !hasSubmitted && roomState.phase === 'territory-turn' ? 'pointer' : 'default',
                          transition: 'all 0.15s ease',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          position: 'relative',
                          boxShadow: isSelectedColumn
                            ? '0 0 12px rgba(255,255,255,0.5)'
                            : tileShiftType === 'red-capture'
                            ? '0 0 8px rgba(239,68,68,0.7)'
                            : tileShiftType === 'blue-capture'
                            ? '0 0 8px rgba(6,182,212,0.7)'
                            : 'none',
                        }}
                        title={`Col ${c + 1}, Row ${r} | ${isRedTile ? 'Red Territory' : 'Blue Territory'}${tileShiftType ? ` (${tileShiftType})` : ''}`}
                      >
                        {tileShiftType === 'red-capture' && (
                          <span style={{ fontSize: '0.65rem', fontWeight: 900, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
                            ↓
                          </span>
                        )}
                        {tileShiftType === 'blue-capture' && (
                          <span style={{ fontSize: '0.65rem', fontWeight: 900, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
                            ↑
                          </span>
                        )}
                        {tileShiftType === 'held' && (
                          <span style={{ fontSize: '0.55rem' }}>🛡️</span>
                        )}
                        {!tileShiftType && isBoundaryTile && r === 0 && <span style={{ fontSize: '0.55rem' }}>🚩</span>}
                        {!tileShiftType && isBoundaryTile && r === 9 && <span style={{ fontSize: '0.55rem' }}>🚩</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Column Target Buttons */}
            {roomState.phase === 'territory-turn' && (
              <div style={{ width: '100%', maxWidth: 440, marginTop: 16 }}>
                <label className="text-xs text-muted" style={{ display: 'block', textAlign: 'center', marginBottom: 8, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  {hasSubmitted ? '✓ Column Locked In' : 'Select Column to Push'}
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 4 }}>
                  {Array.from({ length: 10 }).map((_, c) => {
                    const isSelected = selectedCol === c;
                    const frontier = territory.board[c];
                    // Defender status for my team
                    const isDefendingCol = (isRedTeam && frontier < 4) || (isBlueTeam && frontier > 4);

                    return (
                      <button
                        key={c}
                        type="button"
                        id={`col-select-btn-${c}`}
                        disabled={hasSubmitted}
                        onClick={() => setSelectedCol(c)}
                        style={{
                          padding: '8px 0',
                          borderRadius: 'var(--radius-md)',
                          background: isSelected
                            ? isRedTeam ? 'var(--rose-400)' : 'var(--cyan-400)'
                            : 'rgba(255,255,255,0.05)',
                          color: isSelected ? '#fff' : 'var(--text-primary)',
                          border: `1px solid ${isSelected ? '#fff' : 'var(--border)'}`,
                          fontWeight: 700,
                          fontSize: '0.8rem',
                          cursor: hasSubmitted ? 'not-allowed' : 'pointer',
                          transition: 'all 0.15s',
                          position: 'relative',
                        }}
                      >
                        {c + 1}
                        {isDefendingCol && (
                          <span style={{ position: 'absolute', top: -4, right: -2, fontSize: '0.6rem' }} title="Defender Advantage Active!">
                            🛡️
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {!hasSubmitted ? (
                  <button
                    type="button"
                    id="lock-in-column-btn"
                    disabled={selectedCol === null}
                    onClick={handleLockIn}
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
              </div>
            )}
          </div>

          {/* Sidebar: Roster & Turn Resolution Log */}
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
                      <span className="text-xs" style={{ color: isDone ? 'var(--green-400)' : 'var(--amber-400)' }}>
                        {isDone ? '✓ Ready' : '⏳ Picking'}
                      </span>
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
                      <span className="text-xs" style={{ color: isDone ? 'var(--green-400)' : 'var(--amber-400)' }}>
                        {isDone ? '✓ Ready' : '⏳ Picking'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Persistent Battle Log Panel */}
            <div className="glass p-16 animate-fade-up" style={{ borderRadius: 'var(--radius-xl)', border: '1px solid rgba(255,255,255,0.15)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--amber-400)' }}>
                  📜 Battle Log
                </span>
                <span className="badge badge-muted" style={{ fontSize: '0.65rem' }}>
                  {territory.turnHistory && territory.turnHistory.length > 0 ? `${territory.turnHistory.length} turns recorded` : 'Turn 1 in progress'}
                </span>
              </div>

              {territory.turnHistory && territory.turnHistory.length > 0 ? (
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
              )}
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
                Team {territory.winnerTeam.toUpperCase()} successfully pushed their territory into the enemy back row!
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
