import React, { useState } from 'react';
import type { RoomState } from '../types/game';
import GameSelect, { GAME_CATALOGUE } from './GameSelect';

interface Props {
  roomState: RoomState;
  myId: string;
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

export default function Lobby({ roomState, myId, onStartGame }: Props) {
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);

  const me = roomState.players.find(p => p.id === myId);
  const isHost = me?.isHost ?? false;
  const playerCount = roomState.players.length;

  const selectedGame = GAME_CATALOGUE.find(g => g.id === selectedGameId) ?? null;
  const canStart = selectedGame !== null && playerCount >= (selectedGame?.minPlayers ?? 4);

  const startBlockedReason = !selectedGame
    ? 'Choose a game above to continue'
    : playerCount < (selectedGame.minPlayers)
    ? `Need at least ${selectedGame.minPlayers - playerCount} more player${selectedGame.minPlayers - playerCount !== 1 ? 's' : ''} for ${selectedGame.name}`
    : null;

  return (
    <div className="page-top">
      <div className="container-wide animate-fade-up">
        {/* Header */}
        <div className="text-center" style={{ marginBottom: 32 }}>
          <div className="flex items-center justify-center gap-12 mb-16">
            <div className="badge badge-purple">Lobby</div>
            <div className="flex items-center gap-8">
              <div className="conn-dot online" />
              <span className="text-xs text-muted">Live</span>
            </div>
          </div>
          <h1 className="heading-xl">
            Room <span className="gradient-purple">{roomState.code}</span>
          </h1>
          <p className="text-muted text-sm mt-8">
            Share this code with your friends
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
                  color: playerCount >= 4 ? 'var(--green-400)' : 'var(--text-secondary)',
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
            {roomState.players.map((p, i) => (
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
                <div className="flex gap-4">
                  {p.isHost && <div className="badge badge-amber" style={{ fontSize: '0.6rem' }}>Host</div>}
                  {p.id === myId && <div className="badge badge-cyan" style={{ fontSize: '0.6rem' }}>You</div>}
                </div>
              </div>
            ))}

            {/* Empty slots hint relative to selected game min, or 4 */}
            {playerCount < 4 && Array.from({ length: 4 - playerCount }).map((_, i) => (
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
              {isHost ? 'Select which game to play' : 'Waiting for host to pick a game...'}
            </p>
          </div>
          <GameSelect
            selectedGameId={selectedGameId}
            playerCount={playerCount}
            isHost={isHost}
            onSelect={setSelectedGameId}
          />
        </div>

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
