import React, { useEffect, useState } from 'react';
import type { RoleData, RoomState } from '../types/game';

interface Props {
  myRole: RoleData;
  roomState: RoomState;
  myId: string;
}

export default function RoleReveal({ myRole, roomState, myId }: Props) {
  const [revealed, setRevealed] = useState(false);
  const isHidden = myRole.role === 'hidden';

  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 300);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="page">
      <div className="container animate-fade-up">
        {/* Round Indicator */}
        <div className="flex items-center justify-center gap-16 mb-32">
          <div className="round-dots">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className={`round-dot ${i + 1 === roomState.round ? 'active' : i + 1 < roomState.round ? 'done' : ''}`}
              />
            ))}
          </div>
          <div className="badge badge-muted">Round {roomState.round} of 3</div>
        </div>

        <div className="text-center mb-24">
          <p className="text-muted text-sm" style={{ letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600 }}>
            Your role this round
          </p>
        </div>

        {/* Role Card */}
        {revealed && (
          <div className={`role-card ${isHidden ? 'role-card-hidden' : 'role-card-neutral'}`}>
            <div style={{ fontSize: '3.5rem' }}>{isHidden ? '🕵️' : '🎯'}</div>

            <div>
              <div
                className={`heading-xl ${isHidden ? 'gradient-amber' : 'gradient-purple'}`}
                style={{ marginBottom: 8 }}
              >
                {isHidden ? 'Hidden Pair' : 'Neutral'}
              </div>
              <p className="text-muted text-sm">
                {isHidden
                  ? 'You share a hidden signal with one other player. Find them!'
                  : 'Expose the hidden pair to earn points!'}
              </p>
            </div>

            {isHidden && myRole.secretCode && (
              <div className="flex flex-col items-center gap-12">
                <div className="text-xs text-muted" style={{ letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600 }}>
                  Your shared hidden signal
                </div>
                <div className="secret-code-display">
                  {myRole.secretCode}
                </div>
                <div className="text-xs text-muted text-center" style={{ maxWidth: 260 }}>
                  Use your signal word to hint at this code without being obvious!
                </div>
              </div>
            )}

            {!isHidden && (
              <div
                className="glass"
                style={{
                  padding: '16px 24px',
                  borderRadius: 'var(--radius-lg)',
                  textAlign: 'center',
                  background: 'rgba(139,92,246,0.08)',
                  border: '1px solid rgba(139,92,246,0.2)',
                }}
              >
                <div className="text-sm" style={{ color: 'var(--purple-400)' }}>
                  🔍 Watch for suspicious signals from the hidden pair
                </div>
              </div>
            )}
          </div>
        )}

        {/* All Players in this round */}
        <div className="glass p-24 mt-24" style={{ borderRadius: 'var(--radius-xl)' }}>
          <div className="heading-md mb-16">Players this round</div>
          <div className="player-grid stagger">
            {roomState.players.map((p, i) => {
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
              return (
                <div key={p.id} className="player-card animate-fade-up">
                  <div className="player-avatar" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                    {p.name[0]?.toUpperCase()}
                  </div>
                  <div className="player-name">{p.name}</div>
                  {p.id === myId && <div className="badge badge-cyan" style={{ fontSize: '0.6rem' }}>You</div>}
                </div>
              );
            })}
          </div>
        </div>

        <p className="text-center text-xs text-muted mt-16">
          Signal phase begins in a moment...
        </p>
      </div>
    </div>
  );
}
