import { useState } from 'react';
import type { RoomState } from '../types/game';
import { TOTAL_ROUNDS, avatarColor, avatarInitial } from '../constants';
import TimerBar from './TimerBar';

interface Props {
  roomState: RoomState;
  myId: string;
  onSubmitVote: (targetId: string) => void;
}

export default function BlendVotePhase({ roomState, myId, onSubmitVote }: Props) {
  const [selected, setSelected] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const blend = roomState.blendState;
  if (!blend) return null;

  const done = submitted;
  const others = roomState.players.filter(p => p.id !== myId);
  const nameOf = (id: string) => roomState.players.find(p => p.id === id)?.name ?? '???';
  const clueOf = (id: string) => blend.clues.find(c => c.playerId === id)?.word ?? '…';

  const handleSubmit = () => {
    if (!selected || done) return;
    onSubmitVote(selected);
    setSubmitted(true);
  };

  return (
    <div className="page-top">
      <div className="container animate-fade-up">
        <div className="text-center mb-28">
          <div className="flex items-center justify-center gap-12 mb-16">
            <div className="round-dots">
              {Array.from({ length: TOTAL_ROUNDS }).map((_, i) => (
                <div key={i} className={`round-dot ${i + 1 === roomState.round ? 'active' : i + 1 < roomState.round ? 'done' : ''}`} />
              ))}
            </div>
            <div className="badge badge-rose">🦎 Vote Phase</div>
          </div>
          <h1 className="heading-xl">
            Spot the <span className="gradient-amber">Chameleon</span>
          </h1>
          <p className="text-muted text-sm mt-8">
            Whose clue doesn't belong? Votes are secret until the reveal.
          </p>
          {roomState.timerEnd && (
            <div style={{ maxWidth: 400, margin: '16px auto 0' }}>
              <TimerBar endTime={roomState.timerEnd} color="amber" />
            </div>
          )}
        </div>

        <div className="glass p-24" style={{ borderRadius: 'var(--radius-xl)', marginBottom: 20 }}>
          <h2 className="heading-md mb-16">All clues · {blend.category}</h2>
          <div className="flex flex-col gap-8">
            {roomState.players.map((p, i) => (
              <div key={p.id} className="score-row">
                <div className="player-avatar" style={{ width: 36, height: 36, fontSize: '0.9rem', background: avatarColor(i) }}>
                  {avatarInitial(p.name)}
                </div>
                <span className="text-sm" style={{ fontWeight: 600 }}>{p.name}{p.id === myId ? ' (You)' : ''}</span>
                <span className="text-mono" style={{ marginLeft: 'auto', fontWeight: 700, fontSize: '1.05rem', color: 'var(--cyan-400)' }}>
                  “{clueOf(p.id)}”
                </span>
              </div>
            ))}
          </div>
        </div>

        {!done ? (
          <div className="glass p-24" style={{ borderRadius: 'var(--radius-xl)' }}>
            <div className="heading-md mb-16">Who is the chameleon?</div>
            <div className="guess-player-list">
              {others.map(p => {
                const isSelected = selected === p.id;
                return (
                  <button
                    key={p.id}
                    className={`guess-player-option ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelected(p.id)}
                    id={`blend-vote-${p.id}`}
                  >
                    <span style={{ fontWeight: 600 }}>{nameOf(p.id)}</span>
                    <span className="text-xs text-muted">“{clueOf(p.id)}”</span>
                    <div className="check-circle checked" style={{ marginLeft: 'auto', opacity: isSelected ? 1 : 0 }}>
                      <span style={{ color: '#fff', fontSize: '0.7rem' }}>✓</span>
                    </div>
                  </button>
                );
              })}
            </div>
            <button
              className={`btn btn-lg btn-full mt-24 ${selected ? 'btn-primary' : 'btn-secondary'}`}
              disabled={!selected}
              onClick={handleSubmit}
              id="submit-blend-vote-btn"
            >
              🎯 Lock In Vote
            </button>
          </div>
        ) : (
          <div className="glass p-32 text-center" style={{ borderRadius: 'var(--radius-xl)' }}>
            <div style={{ fontSize: '3rem', marginBottom: 12 }}>🔒</div>
            <div className="heading-md mb-8">Vote Locked In!</div>
            <p className="text-muted text-sm">Waiting for others… ({blend.voteCount} / {roomState.totalPlayers})</p>
          </div>
        )}
      </div>
    </div>
  );
}
