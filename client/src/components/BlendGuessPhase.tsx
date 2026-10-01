import { useState, type FormEvent } from 'react';
import type { RoomState } from '../types/game';
import TimerBar from './TimerBar';

interface Props {
  roomState: RoomState;
  myId: string;
  onSubmitGuess: (guess: string) => void;
}

export default function BlendGuessPhase({ roomState, myId, onSubmitGuess }: Props) {
  const [guess, setGuess] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const blend = roomState.blendState;
  if (!blend) return null;

  const amChameleon = blend.amChameleon;
  const accusedName = blend.accusedId
    ? roomState.players.find(p => p.id === blend.accusedId)?.name ?? '???'
    : 'Nobody';

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!guess.trim() || submitted) return;
    onSubmitGuess(guess.trim());
    setSubmitted(true);
  };

  return (
    <div className="page-top">
      <div className="container animate-fade-up">
        <div className="text-center mb-28">
          <div className="badge badge-amber">🦎 Chameleon caught — last chance!</div>
          <h1 className="heading-xl mt-16">
            {accusedName} was <span className="gradient-amber">Accused</span>
          </h1>
          <p className="text-muted text-sm mt-8">
            {amChameleon
              ? 'They caught you! Guess the secret word to steal the round (+2 pts).'
              : 'The accused chameleon is guessing the secret word… get ready.'}
          </p>
          {roomState.timerEnd && (
            <div style={{ maxWidth: 400, margin: '16px auto 0' }}>
              <TimerBar endTime={roomState.timerEnd} color="amber" />
            </div>
          )}
        </div>

        {amChameleon && !submitted ? (
          <div className="glass p-32" style={{ borderRadius: 'var(--radius-xl)' }}>
            <form onSubmit={handleSubmit} className="flex flex-col gap-20">
              <div className="input-group">
                <label className="input-label" htmlFor="blend-guess-input">
                  The secret word is…? (Category: {blend.category})
                </label>
                <input
                  id="blend-guess-input"
                  className="input"
                  style={{ fontSize: '1.2rem', textAlign: 'center' }}
                  placeholder="Your guess"
                  value={guess}
                  onChange={e => setGuess(e.target.value)}
                  maxLength={30}
                  autoFocus
                />
              </div>
              <button type="submit" className="btn btn-primary btn-lg" disabled={guess.trim().length === 0} id="submit-blend-guess-btn">
                🦎 Guess the Word
              </button>
            </form>
          </div>
        ) : (
          <div className="glass p-32 text-center" style={{ borderRadius: 'var(--radius-xl)' }}>
            <div style={{ fontSize: '3rem', marginBottom: 12 }}>{amChameleon ? '🤞' : '⏳'}</div>
            <div className="heading-md mb-8">{amChameleon ? 'Guess submitted!' : 'Waiting for the chameleon…'}</div>
            <p className="text-muted text-sm">Revealing in a moment.</p>
          </div>
        )}
      </div>
    </div>
  );
}
