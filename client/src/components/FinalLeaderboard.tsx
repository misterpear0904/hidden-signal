import React from 'react';
import type { RoomState } from '../types/game';

interface Props {
  roomState: RoomState;
  myId: string;
  isHost: boolean;
  onPlayAgain: () => void;
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

const MEDALS = ['🥇', '🥈', '🥉'];
const RANK_LABELS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

export default function FinalLeaderboard({ roomState, myId, isHost, onPlayAgain }: Props) {
  const sorted = [...roomState.players].sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  const iWin = winner.id === myId;
  const myRank = sorted.findIndex(p => p.id === myId);

  return (
    <div className="page-top">
      <div className="container animate-fade-up">
        {/* Trophy & Winner */}
        <div className="text-center" style={{ marginBottom: 32 }}>
          <div style={{ fontSize: '4rem', marginBottom: 12, animation: 'fade-up 0.5s ease' }}>
            {iWin ? '🏆' : '🎮'}
          </div>
          <h1 className="heading-xl mb-8">
            {iWin ? (
              <>You <span className="gradient-amber">Won!</span></>
            ) : (
              <>Game <span className="gradient-purple">Over!</span></>
            )}
          </h1>
          <p className="text-muted text-sm">
            {iWin
              ? 'Masterful deduction — you outsmarted everyone!'
              : `${winner.name} takes the win!`}
          </p>
        </div>

        {/* Winner Spotlight */}
        {!iWin && (
          <div
            className="glass text-center"
            style={{
              padding: '28px',
              borderRadius: 'var(--radius-xl)',
              marginBottom: 20,
              background: 'linear-gradient(135deg, rgba(251,191,36,0.12), rgba(251,113,133,0.06))',
              border: '1px solid rgba(251,191,36,0.35)',
              boxShadow: '0 4px 40px rgba(251,191,36,0.15)',
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: 8 }}>🥇</div>
            <div
              className="player-avatar"
              style={{
                width: 72, height: 72, fontSize: '1.8rem',
                background: AVATAR_COLORS[roomState.players.findIndex(p => p.id === winner.id) % AVATAR_COLORS.length],
                margin: '0 auto 12px',
              }}
            >
              {winner.name[0]?.toUpperCase()}
            </div>
            <div className="heading-lg mb-4">{winner.name}</div>
            <div className="text-mono" style={{ fontSize: '2rem', color: 'var(--amber-400)', fontWeight: 700 }}>
              {winner.score} pts
            </div>
          </div>
        )}

        {/* Full Leaderboard */}
        <div className="glass p-24" style={{ borderRadius: 'var(--radius-xl)', marginBottom: 24 }}>
          <h2 className="heading-md mb-20">Final Standings</h2>
          {sorted.map((p, i) => {
            const pIdx = roomState.players.findIndex(rp => rp.id === p.id);
            const isMe = p.id === myId;
            return (
              <div
                key={p.id}
                className={`leaderboard-row animate-fade-up ${i === 0 ? 'first' : ''}`}
                style={{ animationDelay: `${i * 0.08}s` }}
                id={`leaderboard-row-${i}`}
              >
                <div className="rank-num">
                  {i < 3 ? MEDALS[i] : <span className="text-muted">{RANK_LABELS[i]}</span>}
                </div>
                <div
                  className="player-avatar"
                  style={{
                    width: 44, height: 44, fontSize: '1.1rem',
                    background: AVATAR_COLORS[pIdx % AVATAR_COLORS.length],
                    flexShrink: 0,
                  }}
                >
                  {p.name[0]?.toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{p.name}</div>
                  {isMe && <div className="badge badge-cyan" style={{ fontSize: '0.6rem', marginTop: 2 }}>You</div>}
                </div>
                <div className="score-big">{p.score}</div>
              </div>
            );
          })}
        </div>

        {/* My Performance */}
        <div
          className="glass"
          style={{
            padding: '16px 20px',
            borderRadius: 'var(--radius-lg)',
            marginBottom: 24,
            background: 'rgba(139,92,246,0.06)',
            border: '1px solid rgba(139,92,246,0.2)',
          }}
        >
          <div className="text-xs text-muted mb-4" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Your Result
          </div>
          <div className="flex items-center gap-12">
            <span style={{ fontSize: '1.4rem' }}>{myRank === 0 ? '🏆' : myRank === 1 ? '🥈' : myRank === 2 ? '🥉' : '🎮'}</span>
            <span style={{ fontWeight: 600 }}>{RANK_LABELS[myRank]} place</span>
            <span className="text-mono" style={{ marginLeft: 'auto', color: 'var(--purple-400)', fontWeight: 700, fontSize: '1.2rem' }}>
              {roomState.players.find(p => p.id === myId)?.score ?? 0} pts
            </span>
          </div>
        </div>

        {/* Play Again */}
        {isHost ? (
          <button
            className="btn btn-primary btn-lg btn-full"
            onClick={onPlayAgain}
            id="play-again-btn"
          >
            🔄 Play Again
          </button>
        ) : (
          <div className="glass text-center" style={{ padding: '20px', borderRadius: 'var(--radius-lg)' }}>
            <p className="text-muted text-sm">Waiting for host to start a new game...</p>
          </div>
        )}
      </div>
    </div>
  );
}
