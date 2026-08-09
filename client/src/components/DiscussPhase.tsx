import React from 'react';
import type { RoleData, RoomState } from '../types/game';
import TimerBar from './TimerBar';

interface Props {
  roomState: RoomState;
  myId: string;
  myRole: RoleData;
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

export default function DiscussPhase({ roomState, myId, myRole }: Props) {
  const isHidden = myRole.role === 'hidden';

  // Map player id -> player object for fast lookup
  const playerMap = Object.fromEntries(roomState.players.map(p => [p.id, p]));
  const playerIndex = (id: string) => roomState.players.findIndex(p => p.id === id);

  return (
    <div className="page-top">
      <div className="container-wide animate-fade-up">
        {/* Header */}
        <div className="text-center mb-32">
          <div className="flex items-center justify-center gap-12 mb-16">
            <div className="round-dots">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className={`round-dot ${i + 1 === roomState.round ? 'active' : i + 1 < roomState.round ? 'done' : ''}`} />
              ))}
            </div>
            <div className="badge badge-amber">Discuss</div>
          </div>
          <h1 className="heading-xl">
            The <span className="gradient-amber">Signals</span> Are In
          </h1>
          <p className="text-muted text-sm mt-8">
            {isHidden
              ? 'Study the signals — which one is your partner\'s?'
              : 'Which signals are connected? Find the hidden pair!'}
          </p>
        </div>

        {/* Timer */}
        {roomState.timerEnd && (
          <div style={{ marginBottom: 24 }}>
            <TimerBar endTime={roomState.timerEnd} color="amber" />
          </div>
        )}

        {/* Role Reminder */}
        <div
          className="glass"
          style={{
            padding: '14px 20px',
            borderRadius: 'var(--radius-lg)',
            marginBottom: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: isHidden ? 'rgba(251,191,36,0.08)' : 'rgba(139,92,246,0.08)',
            border: `1px solid ${isHidden ? 'rgba(251,191,36,0.25)' : 'rgba(139,92,246,0.25)'}`,
          }}
        >
          <span style={{ fontSize: '1.2rem' }}>{isHidden ? '🕵️' : '🎯'}</span>
          <div>
            <div className="text-sm" style={{ fontWeight: 600, color: isHidden ? 'var(--amber-400)' : 'var(--purple-400)' }}>
              {isHidden ? `Your code: "${myRole.secretCode}"` : 'Neutral — spot the pair!'}
            </div>
            <div className="text-xs text-muted">Guessing phase follows — use this time wisely</div>
          </div>
        </div>

        {/* Signals Board */}
        <div className="glass p-24" style={{ borderRadius: 'var(--radius-xl)', marginBottom: 24 }}>
          <h2 className="heading-md mb-20">All Signals</h2>
          <div className="signal-grid stagger">
            {roomState.signals.map((sig, i) => {
              const player = playerMap[sig.playerId];
              const pIdx = playerIndex(sig.playerId);
              const isMe = sig.playerId === myId;
              return (
                <div
                  key={sig.playerId}
                  className="signal-card animate-fade-up"
                  style={isMe ? { borderColor: 'rgba(139,92,246,0.4)', background: 'rgba(139,92,246,0.08)' } : {}}
                  id={`signal-card-${sig.playerId}`}
                >
                  <div className="signal-word">
                    {sig.signal || '???'}
                  </div>
                  <div className="flex items-center gap-8">
                    <div
                      className="player-avatar"
                      style={{ width: 24, height: 24, fontSize: '0.7rem', background: AVATAR_COLORS[pIdx % AVATAR_COLORS.length] }}
                    >
                      {player?.name?.[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div className="signal-author">
                      {player?.name ?? 'Unknown'}
                      {isMe && <span style={{ color: 'var(--purple-400)', marginLeft: 4 }}>· You</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Scoreboard */}
        <div className="glass p-24" style={{ borderRadius: 'var(--radius-xl)' }}>
          <h2 className="heading-md mb-16">Current Scores</h2>
          <div className="flex flex-col gap-4">
            {[...roomState.players]
              .sort((a, b) => b.score - a.score)
              .map((p, i) => {
                const pIdx = roomState.players.findIndex(pl => pl.id === p.id);
                return (
                  <div key={p.id} className="score-row">
                    <div
                      className="player-avatar"
                      style={{ width: 32, height: 32, fontSize: '0.9rem', background: AVATAR_COLORS[pIdx % AVATAR_COLORS.length] }}
                    >
                      {p.name[0]?.toUpperCase()}
                    </div>
                    <span className="text-sm" style={{ fontWeight: 600 }}>{p.name}</span>
                    {p.id === myId && <span className="badge badge-cyan" style={{ fontSize: '0.6rem' }}>You</span>}
                    <span className="score-delta" style={{ color: 'var(--purple-400)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                      {p.score} pts
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </div>
  );
}
