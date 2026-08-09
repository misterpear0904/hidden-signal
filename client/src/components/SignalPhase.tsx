import React, { useState, useEffect, useCallback } from 'react';
import type { RoleData, RoomState } from '../types/game';
import TimerBar from './TimerBar';

interface Props {
  myRole: RoleData;
  roomState: RoomState;
  myId: string;
  onSubmitSignal: (signal: string) => void;
}

export default function SignalPhase({ myRole, roomState, myId, onSubmitSignal }: Props) {
  const [signal, setSignal] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const isHidden = myRole.role === 'hidden';

  const alreadySubmitted = roomState.signals.some(s => s.playerId === myId);
  const effectivelySubmitted = submitted || alreadySubmitted;

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!signal.trim() || effectivelySubmitted) return;
    onSubmitSignal(signal.trim());
    setSubmitted(true);
  }, [signal, effectivelySubmitted, onSubmitSignal]);

  // Count how many submitted (server only exposes count or submitted flag during this phase)
  const submittedCount = roomState.submittedSignalCount;
  const totalPlayers = roomState.totalPlayers;

  return (
    <div className="page">
      <div className="container animate-fade-up">
        {/* Header */}
        <div className="text-center mb-32">
          <div className="flex items-center justify-center gap-12 mb-16">
            <div className="round-dots">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className={`round-dot ${i + 1 === roomState.round ? 'active' : i + 1 < roomState.round ? 'done' : ''}`} />
              ))}
            </div>
            <div className="badge badge-cyan">Signal Phase</div>
          </div>
          <h1 className="heading-xl">
            Send Your <span className="gradient-cyan">Signal</span>
          </h1>
          <p className="text-muted text-sm mt-8">
            {isHidden
              ? `Your code is "${myRole.secretCode}" — hint at it without being obvious`
              : 'Submit any signal word — blend in or cause confusion!'}
          </p>
        </div>

        {/* Your Role Reminder */}
        <div
          className="glass"
          style={{
            padding: '16px 20px',
            borderRadius: 'var(--radius-lg)',
            marginBottom: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: isHidden
              ? 'rgba(251,191,36,0.08)'
              : 'rgba(139,92,246,0.08)',
            border: `1px solid ${isHidden ? 'rgba(251,191,36,0.25)' : 'rgba(139,92,246,0.25)'}`,
          }}
        >
          <span style={{ fontSize: '1.3rem' }}>{isHidden ? '🕵️' : '🎯'}</span>
          <div>
            <div className="text-sm" style={{ fontWeight: 600, color: isHidden ? 'var(--amber-400)' : 'var(--purple-400)' }}>
              {isHidden ? `Hidden Pair — Code: "${myRole.secretCode}"` : 'Neutral Player'}
            </div>
            <div className="text-xs text-muted">
              {isHidden ? 'Your partner has the same code' : 'Spot which signals share a hidden theme'}
            </div>
          </div>
        </div>

        {/* Signal Input */}
        <div className="glass p-32" style={{ borderRadius: 'var(--radius-xl)' }}>
          {!effectivelySubmitted ? (
            <form onSubmit={handleSubmit} className="flex flex-col gap-20">
              <div className="input-group">
                <label className="input-label">Your Signal Word</label>
                <input
                  className="input"
                  style={{ fontSize: '1.2rem', fontFamily: 'var(--font-mono)', textAlign: 'center' }}
                  placeholder="Enter one word..."
                  value={signal}
                  onChange={e => setSignal(e.target.value.replace(/\s+/g, ''))}
                  maxLength={20}
                  autoFocus
                  id="signal-input"
                />
                <div className="text-xs text-muted">
                  One word only — be clever, be subtle
                </div>
              </div>
              <button
                type="submit"
                className="btn btn-primary btn-lg"
                disabled={signal.trim().length === 0}
                id="submit-signal-btn"
              >
                📡 Submit Signal
              </button>
            </form>
          ) : (
            <div className="flex flex-col items-center gap-16" style={{ padding: '20px 0' }}>
              <div style={{ fontSize: '3rem' }}>✅</div>
              <div>
                <div className="heading-md text-center mb-8">Signal Sent!</div>
                <div
                  className="text-mono text-center"
                  style={{ fontSize: '1.5rem', color: 'var(--cyan-400)', fontWeight: 700 }}
                >
                  "{signal || '...'}"
                </div>
              </div>
              <p className="text-muted text-sm text-center">
                Waiting for others to submit their signals...
              </p>
            </div>
          )}
        </div>

        {/* Submission Progress */}
        <div className="glass mt-16" style={{ padding: '16px 20px', borderRadius: 'var(--radius-lg)' }}>
          <div className="flex justify-between items-center mb-8">
            <span className="text-xs text-muted">Signals submitted</span>
            <span className="text-xs text-mono" style={{ color: 'var(--green-400)', fontWeight: 700 }}>
              {submittedCount} / {totalPlayers}
            </span>
          </div>
          <div className="timer-bar-wrap">
            <div
              className="timer-bar"
              style={{
                width: `${totalPlayers > 0 ? (submittedCount / totalPlayers) * 100 : 0}%`,
                background: 'linear-gradient(90deg, var(--green-500), var(--cyan-400))',
                transition: 'width 0.4s ease',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
