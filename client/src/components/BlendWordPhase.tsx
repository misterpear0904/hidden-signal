import { useState, useEffect, type FormEvent } from 'react';
import type { RoomState } from '../types/game';
import { TOTAL_ROUNDS } from '../constants';
import TimerBar from './TimerBar';

interface Props {
  roomState: RoomState;
  myId: string;
  onSubmitClue: (word: string) => void;
}

export default function BlendWordPhase({ roomState, myId, onSubmitClue }: Props) {
  const [word, setWord] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const blend = roomState.blendState;
  const amChameleon = blend?.amChameleon ?? false;

  useEffect(() => {
    setWord('');
    setSubmitted(false);
  }, [roomState.round, roomState.code]);

  if (!blend) return null;
  const alreadySubmitted = blend.clues.some(c => c.playerId === myId);
  const done = submitted || alreadySubmitted;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!word.trim() || done) return;
    onSubmitClue(word.trim());
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
            <div className="badge badge-cyan">🦎 Word Phase</div>
          </div>
          <h1 className="heading-xl">
            Drop Your <span className="gradient-cyan">Clue</span>
          </h1>
          <p className="text-muted text-sm mt-8">
            {amChameleon
              ? 'You do NOT know the secret word — bluff a clue that fits the category!'
              : 'Give a one-word clue only an insider would give.'}
          </p>
          {roomState.timerEnd && (
            <div style={{ maxWidth: 400, margin: '16px auto 0' }}>
              <TimerBar endTime={roomState.timerEnd} color="purple" />
            </div>
          )}
        </div>

        <div
          className="glass text-center"
          style={{
            padding: '24px',
            borderRadius: 'var(--radius-xl)',
            marginBottom: 20,
            background: amChameleon ? 'rgba(251,191,36,0.08)' : 'rgba(6,182,212,0.08)',
            border: `2px solid ${amChameleon ? 'rgba(251,191,36,0.4)' : 'rgba(6,182,212,0.4)'}`,
          }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>{amChameleon ? '🦎' : '🤫'}</div>
          <div className="heading-lg" style={{ marginBottom: 4 }}>
            {amChameleon ? 'YOU ARE THE CHAMELEON' : blend.secretWord}
          </div>
          <div className="text-sm text-muted">Category: <strong style={{ color: 'var(--amber-400)' }}>{blend.category}</strong></div>
        </div>

        <div className="glass p-32" style={{ borderRadius: 'var(--radius-xl)' }}>
          {!done ? (
            <form onSubmit={handleSubmit} className="flex flex-col gap-20">
              <div className="input-group">
                <label className="input-label" htmlFor="blend-clue-input">Your one-word clue</label>
                <input
                  id="blend-clue-input"
                  className="input"
                  style={{ fontSize: '1.2rem', textAlign: 'center' }}
                  placeholder="e.g. trunk"
                  value={word}
                  onChange={e => setWord(e.target.value)}
                  maxLength={24}
                  autoFocus
                />
              </div>
              <button type="submit" className="btn btn-primary btn-lg" disabled={word.trim().length === 0} id="submit-blend-clue-btn">
                🦎 Submit Clue
              </button>
            </form>
          ) : (
            <div className="flex flex-col items-center gap-16" style={{ padding: '20px 0' }}>
              <div style={{ fontSize: '3rem' }}>✅</div>
              <div className="heading-md text-center">Clue locked in!</div>
              <p className="text-muted text-sm text-center">Waiting for others… ({blend.clueCount} / {roomState.totalPlayers})</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
