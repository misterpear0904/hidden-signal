import React, { useState } from 'react';
import type { RoomState } from '../types/game';
import GameSelect, { GAME_CATALOGUE } from './GameSelect';

interface Props {
  roomState: RoomState;
  myId: string;
  onSelectGame: (gameId: string) => void;
  onUpdateChromaOptions: (options: Partial<import('../types/game').ChromaOptions>) => void;
  onUpdateTerritoryOptions: (options: Partial<import('../types/game').TerritoryOptions>) => void;
  onSetPlayerDifficulty: (difficulty: 'easy' | 'medium' | 'hard') => void;
  onStartGame: () => void;
}

const AVATAR_COLORS = [
  'linear-gradient(135deg,#8b5cf6,#6d28d9)',
  'linear-gradient(135deg,#22d3ee,#0891b2)',
  'linear-gradient(135deg,#fbbf24,#d97706)',
  'linear-gradient(135deg,#4ade80,#16a34a)',
  'linear-gradient(135deg,#fb7185,#be123c)',
  'linear-gradient(135deg,#a78bfa,#7c3aed)',
  'linear-gradient(135deg,#34d399,#059669)',
  'linear-gradient(135deg,#f472b6,#be185d)',
];

export default function Lobby({ roomState, myId, onSelectGame, onUpdateChromaOptions, onUpdateTerritoryOptions, onSetPlayerDifficulty, onStartGame }: Props) {
  const me = roomState.players.find(p => p.id === myId);
  const isHost = me?.isHost ?? false;
  const playerCount = roomState.players.length;

  const selectedGameId = roomState.selectedGameId || null;
  const selectedGame = GAME_CATALOGUE.find(g => g.id === selectedGameId) ?? null;
  
  const isTerritoryPush = selectedGameId === 'territory-push';
  const isEvenPlayers = playerCount % 2 === 0;

  const canStart = selectedGame !== null &&
    playerCount >= (selectedGame?.minPlayers ?? 2) &&
    (!isTerritoryPush || isEvenPlayers);

  const startBlockedReason = !selectedGame
    ? 'Choose a game above to continue'
    : playerCount < (selectedGame.minPlayers)
    ? `Need at least ${selectedGame.minPlayers - playerCount} more player${selectedGame.minPlayers - playerCount !== 1 ? 's' : ''} for ${selectedGame.name}`
    : isTerritoryPush && !isEvenPlayers
    ? 'Territory Push requires an EVEN number of players (e.g. 2, 4, 6, 8...)'
    : null;

  const chromaOptions = roomState.chromaOptions || { difficulty: 'easy', playerDifficulties: {}, fairPoints: true, extremeMode: false };
  const territoryOptions = roomState.territoryOptions || { extremeMode: false };
  const myDifficulty = chromaOptions.playerDifficulties?.[myId] || 'easy';

  return (
    <div className="page-top">
      <div className="container-wide animate-fade-up">
        {/* Header */}
        <div className="text-center" style={{ marginBottom: 32 }}>
          <div className="flex items-center justify-center gap-12 mb-16">
            <div className="badge badge-purple">Game Lounge Lobby</div>
            <div className="flex items-center gap-8">
              <div className="conn-dot online" />
              <span className="text-xs text-muted">Live</span>
            </div>
          </div>
          <h1 className="heading-xl">
            Room <span className="gradient-purple">{roomState.code}</span>
          </h1>
          <p className="text-muted text-sm mt-8">
            Party lounge for deception, hidden knowledge & bluffing games • Share code with friends
          </p>
        </div>

        {/* Room Code Copy */}
        <div
          className="glass text-center"
          style={{
            padding: '20px 32px',
            borderRadius: 'var(--radius-xl)',
            marginBottom: 24,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
          onClick={() => navigator.clipboard?.writeText(roomState.code)}
          id="copy-code-btn"
          title="Click to copy"
        >
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '2.5rem', fontWeight: 700, letterSpacing: '0.3em', color: 'var(--amber-400)' }}>
            {roomState.code}
          </div>
          <div className="text-xs text-muted mt-8">Click to copy code</div>
        </div>

        {/* Lobby Hub Guide */}
        <div
          className="glass p-20 animate-fade-up"
          style={{
            borderRadius: 'var(--radius-xl)',
            marginBottom: 24,
            background: 'linear-gradient(135deg, rgba(139,92,246,0.06), rgba(6,182,212,0.04))',
            border: '1px solid rgba(139,92,246,0.2)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: '1.3rem' }}>🎲</span>
            <div>
              <h3 className="heading-md" style={{ fontSize: '0.95rem', margin: 0 }}>
                Deception & Hidden Knowledge Games Lounge
              </h3>
              <p className="text-xs text-muted" style={{ marginTop: 2 }}>
                This lobby is your shared room for multiple bluffing, deduction, and perception games.
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-lg)', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--purple-400)', marginBottom: 4 }}>
                🤫 Hidden Information
              </div>
              <div className="text-xs text-muted" style={{ lineHeight: 1.4 }}>
                Secret roles, hidden signals, visual changes & simultaneous blind choices.
              </div>
            </div>

            <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-lg)', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--cyan-400)', marginBottom: 4 }}>
                📖 Interactive Game Rules
              </div>
              <div className="text-xs text-muted" style={{ lineHeight: 1.4 }}>
                Host picks the game, and any player can click any game card to preview its rules.
              </div>
            </div>

            <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-lg)', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--amber-400)', marginBottom: 4 }}>
                🔄 Continuous Party Play
              </div>
              <div className="text-xs text-muted" style={{ lineHeight: 1.4 }}>
                Players stay connected together to play round after round or switch games seamlessly.
              </div>
            </div>
          </div>
        </div>

        {/* Players */}
        <div className="glass p-24" style={{ borderRadius: 'var(--radius-xl)', marginBottom: 24 }}>
          <div className="flex justify-between items-center" style={{ marginBottom: 20 }}>
            <h2 className="heading-md">Players</h2>
            <div className="flex items-center gap-8">
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.1rem',
                  fontWeight: 700,
                  color: playerCount >= (selectedGame?.minPlayers ?? 2) ? 'var(--green-400)' : 'var(--text-secondary)',
                }}
              >
                {playerCount}
              </span>
              <span className="text-muted text-sm">
                {selectedGame ? `/ ${selectedGame.maxPlayers} max` : '/ ? players'}
              </span>
            </div>
          </div>

          <div className="player-grid stagger">
            {roomState.players.map((p, i) => {
              const pDiff = chromaOptions.playerDifficulties?.[p.id] || 'easy';
              return (
                <div
                  key={p.id}
                  className={`player-card animate-fade-up ${!p.connected ? 'disconnected' : ''}`}
                  id={`player-card-${p.id}`}
                >
                  <div
                    className="player-avatar"
                    style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
                  >
                    {p.name[0]?.toUpperCase()}
                  </div>
                  <div className="player-name">{p.name}</div>
                  <div className="flex flex-wrap gap-4 justify-center">
                    {p.isHost && <div className="badge badge-amber" style={{ fontSize: '0.6rem' }}>Host</div>}
                    {p.id === myId && <div className="badge badge-cyan" style={{ fontSize: '0.6rem' }}>You</div>}
                    {selectedGameId === 'chroma-shift' && (
                      <div
                        className="badge"
                        style={{
                          fontSize: '0.6rem',
                          background: pDiff === 'easy' ? 'rgba(74,222,128,0.15)' : pDiff === 'medium' ? 'rgba(251,191,36,0.15)' : 'rgba(239,68,68,0.15)',
                          color: pDiff === 'easy' ? 'var(--green-400)' : pDiff === 'medium' ? 'var(--amber-400)' : 'var(--rose-400)',
                        }}
                      >
                        {pDiff === 'easy' ? '🟢 Easy' : pDiff === 'medium' ? '🟡 Medium' : '🔴 Hard'}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Empty slots hint relative to selected game min */}
            {playerCount < (selectedGame?.minPlayers ?? 2) && Array.from({ length: (selectedGame?.minPlayers ?? 2) - playerCount }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="player-card"
                style={{ opacity: 0.25, borderStyle: 'dashed' }}
              >
                <div className="player-avatar" style={{ background: 'var(--bg-card)', fontSize: '1.4rem' }}>+</div>
                <div className="player-name text-muted">Waiting...</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Game Selection ── */}
        <div className="glass p-24" style={{ borderRadius: 'var(--radius-xl)', marginBottom: 24 }}>
          <div style={{ marginBottom: 16 }}>
            <h2 className="heading-md" style={{ marginBottom: 4 }}>Choose a Game</h2>
            <p className="text-xs text-muted">
              {isHost ? 'Select a deception or hidden knowledge game to launch' : 'Browse game rules below while the host chooses a game...'}
            </p>
          </div>
          <GameSelect
            selectedGameId={selectedGameId}
            playerCount={playerCount}
            isHost={isHost}
            onSelect={onSelectGame}
          />
        </div>

        {/* ── Chroma Shift Game Options Panel ── */}
        {selectedGameId === 'chroma-shift' && (
          <div className="glass p-24 animate-fade-up" style={{ borderRadius: 'var(--radius-xl)', marginBottom: 24, border: '1px solid rgba(6,182,212,0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: '1.4rem' }}>🎨</span>
              <div>
                <h3 className="heading-md" style={{ fontSize: '1.1rem', margin: 0 }}>Chroma Shift Settings</h3>
                <p className="text-xs text-muted">Each player can select their own difficulty mode!</p>
              </div>
            </div>

            {/* Per-Player Difficulty Selector */}
            <div style={{ marginBottom: 20 }}>
              <label className="text-xs text-muted" style={{ fontWeight: 700, letterSpacing: '0.05em', display: 'block', marginBottom: 8, textTransform: 'uppercase' }}>
                Your Difficulty Mode
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {(['easy', 'medium', 'hard'] as const).map((diff) => {
                  const isActive = myDifficulty === diff;
                  const ptsText = chromaOptions.fairPoints
                    ? diff === 'easy' ? '1 pt/rnd' : diff === 'medium' ? '2 pts/rnd' : '3 pts/rnd'
                    : '1 pt/rnd';

                  return (
                    <button
                      key={diff}
                      type="button"
                      id={`diff-btn-${diff}`}
                      onClick={() => onSetPlayerDifficulty(diff)}
                      style={{
                        padding: '12px 10px',
                        borderRadius: 'var(--radius-lg)',
                        background: isActive ? 'rgba(6,182,212,0.15)' : 'rgba(255,255,255,0.03)',
                        border: `2px solid ${isActive ? 'var(--cyan-400)' : 'var(--border)'}`,
                        color: isActive ? '#fff' : 'var(--text-muted)',
                        fontWeight: isActive ? 700 : 500,
                        cursor: 'pointer',
                        textAlign: 'center',
                        transition: 'all 0.2s',
                      }}
                    >
                      <div style={{ fontSize: '0.95rem', textTransform: 'capitalize', marginBottom: 2 }}>
                        {diff === 'easy' ? '🟢 Easy' : diff === 'medium' ? '🟡 Medium' : '🔴 Hard'}
                      </div>
                      <div className="text-xs text-muted" style={{ fontSize: '0.7rem' }}>
                        {diff === 'easy' ? 'Static grid' : diff === 'medium' ? 'Slow drift' : 'Fast + Resizing'}
                      </div>
                      <div style={{ fontSize: '0.65rem', color: isActive ? 'var(--cyan-400)' : 'var(--text-muted)', marginTop: 4, fontWeight: 700 }}>
                        {ptsText}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Fair Points Host Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                  ⚖️ Fair Points Mode
                </div>
                <div className="text-xs text-muted" style={{ marginTop: 2 }}>
                  {chromaOptions.fairPoints
                    ? 'ON: Easy = 1 pt, Medium = 2 pts, Hard = 3 pts'
                    : 'OFF: All difficulty modes award 1 pt per round'}
                </div>
              </div>

              {isHost ? (
                <button
                  type="button"
                  id="fair-points-toggle"
                  onClick={() => onUpdateChromaOptions({ fairPoints: !chromaOptions.fairPoints })}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-full)',
                    background: chromaOptions.fairPoints ? 'var(--green-400)' : 'rgba(255,255,255,0.1)',
                    color: chromaOptions.fairPoints ? '#000' : 'var(--text-muted)',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {chromaOptions.fairPoints ? 'ON ✓' : 'OFF'}
                </button>
              ) : (
                <span className="badge" style={{ background: chromaOptions.fairPoints ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.05)', color: chromaOptions.fairPoints ? 'var(--green-400)' : 'var(--text-muted)' }}>
                  {chromaOptions.fairPoints ? 'ON' : 'OFF'} (Host Setting)
                </span>
              )}
            </div>

            {/* Extreme Mode Host Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: chromaOptions.extremeMode ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-lg)', border: `1px solid ${chromaOptions.extremeMode ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`, transition: 'all 0.2s' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: chromaOptions.extremeMode ? 'var(--rose-400)' : 'var(--text-primary)' }}>
                  🔥 Extreme Mode (8x8 Grid)
                </div>
                <div className="text-xs text-muted" style={{ marginTop: 2 }}>
                  {chromaOptions.extremeMode
                    ? 'ON: Extreme 8x8 Grid (64 Tiles total!)'
                    : 'OFF: Standard 5x5 Grid (25 Tiles)'}
                </div>
              </div>

              {isHost ? (
                <button
                  type="button"
                  id="extreme-mode-toggle"
                  onClick={() => onUpdateChromaOptions({ extremeMode: !chromaOptions.extremeMode })}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-full)',
                    background: chromaOptions.extremeMode ? 'var(--rose-400)' : 'rgba(255,255,255,0.1)',
                    color: chromaOptions.extremeMode ? '#fff' : 'var(--text-muted)',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    boxShadow: chromaOptions.extremeMode ? '0 0 16px rgba(239,68,68,0.4)' : 'none',
                  }}
                >
                  {chromaOptions.extremeMode ? '8x8 ON 🔥' : 'OFF'}
                </button>
              ) : (
                <span className="badge" style={{ background: chromaOptions.extremeMode ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.05)', color: chromaOptions.extremeMode ? 'var(--rose-400)' : 'var(--text-muted)' }}>
                  {chromaOptions.extremeMode ? '8x8 🔥' : '5x5'} (Host Setting)
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── Territory Push Game Options Panel ── */}
        {selectedGameId === 'territory-push' && (
          <div className="glass p-24 animate-fade-up" style={{ borderRadius: 'var(--radius-xl)', marginBottom: 24, border: '1px solid rgba(244,63,94,0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: '1.4rem' }}>⚔️</span>
              <div>
                <h3 className="heading-md" style={{ fontSize: '1.1rem', margin: 0 }}>Territory Push Settings</h3>
                <p className="text-xs text-muted">Configure match format and real-time intensity!</p>
              </div>
            </div>

            {/* Extreme Mode Host Toggle */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 18px',
              background: territoryOptions.extremeMode ? 'rgba(244,63,94,0.12)' : 'rgba(255,255,255,0.03)',
              borderRadius: 'var(--radius-lg)',
              border: `1px solid ${territoryOptions.extremeMode ? 'rgba(244,63,94,0.45)' : 'var(--border)'}`,
              transition: 'all 0.2s',
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: '0.95rem', color: territoryOptions.extremeMode ? 'var(--rose-400)' : 'var(--text-primary)' }}>
                    🔥 Extreme Mode (Real-Time 10x20 Grid)
                  </span>
                  {territoryOptions.extremeMode && (
                    <span className="badge badge-rose" style={{ fontSize: '0.6rem' }}>20 Rows + Real-Time</span>
                  )}
                </div>
                <div className="text-xs text-muted" style={{ marginTop: 4, lineHeight: 1.4 }}>
                  {territoryOptions.extremeMode
                    ? '⚡ Real-time energy charging (+1 shot every ~3.5s, store up to 3) & 8 randomized booster squares (+10% team recharge speed each) on a 10x20 grid! Instant firing without turns.'
                    : 'OFF: Standard 10x10 grid with turn-based simultaneous column selection.'}
                </div>
              </div>

              {isHost ? (
                <button
                  type="button"
                  id="territory-extreme-mode-toggle"
                  onClick={() => onUpdateTerritoryOptions({ extremeMode: !territoryOptions.extremeMode })}
                  style={{
                    padding: '8px 18px',
                    borderRadius: 'var(--radius-full)',
                    background: territoryOptions.extremeMode ? 'var(--rose-400)' : 'rgba(255,255,255,0.1)',
                    color: territoryOptions.extremeMode ? '#fff' : 'var(--text-muted)',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    boxShadow: territoryOptions.extremeMode ? '0 0 16px rgba(244,63,94,0.45)' : 'none',
                  }}
                >
                  {territoryOptions.extremeMode ? '20-Row ON 🔥' : 'OFF'}
                </button>
              ) : (
                <span className="badge" style={{ background: territoryOptions.extremeMode ? 'rgba(244,63,94,0.15)' : 'rgba(255,255,255,0.05)', color: territoryOptions.extremeMode ? 'var(--rose-400)' : 'var(--text-muted)' }}>
                  {territoryOptions.extremeMode ? '20-Row Extreme 🔥' : '10x10 Standard'} (Host Setting)
                </span>
              )}
            </div>
          </div>
        )}

        {/* Start / Waiting */}
        {isHost ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              className={`btn btn-lg btn-full ${canStart ? 'btn-primary' : 'btn-secondary'}`}
              disabled={!canStart}
              onClick={onStartGame}
              id="start-game-btn"
            >
              {canStart ? `🚀 Start ${selectedGame!.name}` : '⏳ Not ready yet'}
            </button>
            {startBlockedReason && (
              <p className="text-center text-xs text-muted">{startBlockedReason}</p>
            )}
          </div>
        ) : (
          <div
            className="glass text-center"
            style={{ padding: '20px', borderRadius: 'var(--radius-lg)' }}
          >
            <div className="spinner" style={{ margin: '0 auto 12px' }} />
            <p className="text-muted text-sm">
              {selectedGame
                ? `Host selected ${selectedGame.emoji} ${selectedGame.name} — waiting to start...`
                : 'Waiting for the host to choose a game...'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
