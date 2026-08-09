import React, { useState } from 'react';

interface Props {
  onCreateRoom: (name: string) => void;
  onJoinRoom: (code: string, name: string) => void;
  connected: boolean;
}

const AVATAR_COLORS = [
  'linear-gradient(135deg,#8b5cf6,#6d28d9)',
  'linear-gradient(135deg,#22d3ee,#0891b2)',
  'linear-gradient(135deg,#fbbf24,#d97706)',
  'linear-gradient(135deg,#4ade80,#16a34a)',
  'linear-gradient(135deg,#fb7185,#be123c)',
];

export default function LandingPage({ onCreateRoom, onJoinRoom, connected }: Props) {
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  const avatarColor = AVATAR_COLORS[name.length % AVATAR_COLORS.length];
  const initial = name.trim()[0]?.toUpperCase() || '?';

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return;
    onCreateRoom(name.trim());
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2 || code.trim().length < 6) return;
    onJoinRoom(code.trim().toUpperCase(), name.trim());
  };

  return (
    <div className="page">
      <div className="container animate-fade-up">
        {/* Logo / Title */}
        <div className="text-center" style={{ marginBottom: 40 }}>
          <div style={{ fontSize: '3rem', marginBottom: 8 }}>🕵️</div>
          <h1 className="heading-hero" style={{ marginBottom: 8 }}>
            Hidden <span className="gradient-purple">Signal</span>
          </h1>
          <p className="text-muted text-sm">
            A social deduction game of secrets, signals, and strategy
          </p>
          <div className="flex items-center justify-center gap-8 mt-12">
            <div className={`conn-dot ${connected ? 'online' : 'offline'}`} />
            <span className="text-xs text-muted">{connected ? 'Connected' : 'Connecting...'}</span>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="glass" style={{ padding: '6px', borderRadius: 'var(--radius-xl)', marginBottom: 20, display: 'flex', gap: 4 }}>
          <button
            className={`btn btn-full ${tab === 'create' ? 'btn-primary' : ''}`}
            style={tab !== 'create' ? { color: 'var(--text-secondary)', background: 'none' } : {}}
            onClick={() => setTab('create')}
          >
            Create Room
          </button>
          <button
            className={`btn btn-full ${tab === 'join' ? 'btn-primary' : ''}`}
            style={tab !== 'join' ? { color: 'var(--text-secondary)', background: 'none' } : {}}
            onClick={() => setTab('join')}
          >
            Join Room
          </button>
        </div>

        {/* Form Card */}
        <div className="glass p-32" style={{ borderRadius: 'var(--radius-xl)' }}>
          {/* Avatar Preview */}
          <div className="flex justify-center" style={{ marginBottom: 28 }}>
            <div
              className="player-avatar"
              style={{
                width: 72, height: 72,
                fontSize: '1.8rem',
                background: name.trim() ? avatarColor : 'var(--bg-card)',
                border: '2px solid var(--border)',
                transition: 'background 0.3s',
              }}
            >
              {name.trim() ? initial : '👤'}
            </div>
          </div>

          <form onSubmit={tab === 'create' ? handleCreate : handleJoin}>
            <div className="flex flex-col gap-16">
              <div className="input-group">
                <label className="input-label">Your Name</label>
                <input
                  className="input"
                  placeholder="Enter your name..."
                  value={name}
                  onChange={e => setName(e.target.value)}
                  maxLength={20}
                  autoFocus
                  id="player-name-input"
                />
              </div>

              {tab === 'join' && (
                <div className="input-group">
                  <label className="input-label">Room Code</label>
                  <input
                    className="input input-code"
                    placeholder="ABCDEF"
                    value={code}
                    onChange={e => setCode(e.target.value.toUpperCase())}
                    maxLength={6}
                    id="room-code-input"
                  />
                </div>
              )}

              <button
                type="submit"
                className={`btn btn-lg btn-full ${tab === 'create' ? 'btn-primary' : 'btn-cyan'}`}
                disabled={!connected || name.trim().length < 2 || (tab === 'join' && code.trim().length < 6)}
                id={tab === 'create' ? 'create-room-btn' : 'join-room-btn'}
              >
                {tab === 'create' ? '✦ Create Room' : '→ Join Game'}
              </button>
            </div>
          </form>

          <div className="divider" />

          {/* How to play */}
          <div className="flex flex-col gap-12">
            <p className="text-xs text-muted text-center" style={{ fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>How to play</p>
            {[
              ['🕵️', '2 players are the Hidden Pair sharing a hidden signal (they don\'t know who each other are)'],
              ['⚡', 'Anyone can vote at any time to immediately end the round'],
              ['🤝', 'Pair: Guess partner → +1 pt each (+1 to both) | Wrong → -1 pt penalty'],
              ['🎯', 'Neutrals: Expose pair → +1 pt per correct pick | Wrong picks → -1 pt penalty'],
              ['🏆', 'Highest total score after 3 rounds wins!'],
            ].map(([icon, text], i) => (
              <div key={i} className="flex items-start gap-12">
                <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{icon}</span>
                <span className="text-sm text-muted">{text}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-center text-xs text-muted mt-16">Minimum 4 players required to start</p>
      </div>
    </div>
  );
}
