import React, { useState, useCallback } from 'react';
import type { RoleData, RoomState, Player } from '../types/game';
import TimerBar from './TimerBar';

interface Props {
  myRole: RoleData;
  roomState: RoomState;
  myId: string;
  onSubmitGuess: (guessData: object) => void;
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

export default function GuessPhase({ myRole, roomState, myId, onSubmitGuess }: Props) {
  const [selectedPartner, setSelectedPartner] = useState<string>('');
  const [selectedPair, setSelectedPair] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);

  const isHidden = myRole.role === 'hidden';
  const alreadySubmitted = roomState.guesses.some(g => g.playerId === myId);
  const effectivelySubmitted = submitted || alreadySubmitted;

  const otherPlayers = roomState.players.filter(p => p.id !== myId);

  const handleNeutralToggle = useCallback((playerId: string) => {
    setSelectedPair(prev => {
      if (prev.includes(playerId)) return prev.filter(id => id !== playerId);
      if (prev.length >= 2) return prev; // max 2
      return [...prev, playerId];
    });
  }, []);

  const canSubmitHidden = selectedPartner !== '';
  const canSubmitNeutral = selectedPair.length === 2;

  const handleSubmit = useCallback(() => {
    if (effectivelySubmitted) return;
    if (isHidden) {
      if (!canSubmitHidden) return;
      onSubmitGuess({ guessedPartnerId: selectedPartner });
    } else {
      if (!canSubmitNeutral) return;
      onSubmitGuess({ guessedPairIds: selectedPair });
    }
    setSubmitted(true);
  }, [effectivelySubmitted, isHidden, canSubmitHidden, canSubmitNeutral, selectedPartner, selectedPair, onSubmitGuess]);

  const playerIndex = (id: string) => roomState.players.findIndex(p => p.id === id);

  return (
    <div className="page-top">
      <div className="container animate-fade-up">
        {/* Header */}
        <div className="text-center mb-28">
          <div className="flex items-center justify-center gap-12 mb-16">
            <div className="round-dots">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className={`round-dot ${i + 1 === roomState.round ? 'active' : i + 1 < roomState.round ? 'done' : ''}`} />
              ))}
            </div>
            <div className="badge badge-rose">Guess Phase</div>
          </div>
          <h1 className="heading-xl">
            {isHidden ? (
              <>Find Your <span className="gradient-amber">Partner</span></>
            ) : (
              <>Expose the <span className="gradient-purple">Pair</span></>
            )}
          </h1>
          <p className="text-muted text-sm mt-8">
            {isHidden
              ? 'Select the player you think shares your hidden signal. Any vote immediately ends the round!'
              : 'Select 2 players you think are the hidden pair. Any vote immediately ends the round!'}
          </p>
        </div>

        {/* Role & Hidden Signal Reminder Card */}
        <div
          className="glass"
          style={{
            padding: '20px 24px',
            borderRadius: 'var(--radius-xl)',
            marginBottom: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: isHidden ? 'linear-gradient(135deg, rgba(251,191,36,0.12), rgba(251,113,133,0.06))' : 'rgba(139,92,246,0.08)',
            border: `1px solid ${isHidden ? 'rgba(251,191,36,0.35)' : 'rgba(139,92,246,0.25)'}`,
          }}
        >
          <div className="flex items-center gap-16">
            <div style={{ fontSize: '2.5rem' }}>{isHidden ? '🕵️' : '🎯'}</div>
            <div>
              <div className="text-xs text-muted" style={{ letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}>
                Your Role
              </div>
              <div className="heading-md" style={{ color: isHidden ? 'var(--amber-400)' : 'var(--purple-400)' }}>
                {isHidden ? 'Hidden Pair' : 'Neutral Player'}
              </div>
              <div className="text-xs text-muted">
                {isHidden ? 'Find your partner who has the exact same shared hidden signal!' : 'Deduce who the two hidden players are!'}
              </div>
            </div>
          </div>

          {isHidden && myRole.secretCode && (
            <div className="flex flex-col items-center">
              <div className="text-xs text-muted mb-4" style={{ letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}>
                Shared Hidden Signal
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '2.2rem',
                  fontWeight: 800,
                  color: 'var(--amber-400)',
                  background: 'rgba(251,191,36,0.15)',
                  padding: '4px 20px',
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid rgba(251,191,36,0.4)',
                  letterSpacing: '0.1em',
                  boxShadow: '0 0 20px rgba(251,191,36,0.2)'
                }}
              >
                {myRole.secretCode}
              </div>
            </div>
          )}
        </div>

        {/* Main Guess UI */}
        {!effectivelySubmitted ? (
          <div className="glass p-32" style={{ borderRadius: 'var(--radius-xl)', marginBottom: 16 }}>
            <div className="heading-md mb-20">
              {isHidden ? '🕵️ Who is your partner?' : '🎯 Who are the hidden pair?'}
            </div>

            {isHidden ? (
              /* Hidden pair: single select */
              <div className="guess-player-list">
                {otherPlayers.map(player => {
                  const pIdx = playerIndex(player.id);
                  const isSelected = selectedPartner === player.id;
                  return (
                    <button
                      key={player.id}
                      className={`guess-player-option ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedPartner(player.id)}
                      id={`guess-partner-${player.id}`}
                    >
                      <div
                        className="player-avatar"
                        style={{ width: 40, height: 40, fontSize: '1.1rem', background: AVATAR_COLORS[pIdx % AVATAR_COLORS.length] }}
                      >
                        {player.name[0]?.toUpperCase()}
                      </div>
                      <span style={{ fontWeight: 600 }}>{player.name}</span>
                      <div className="check-circle checked" style={{ marginLeft: 'auto', opacity: isSelected ? 1 : 0 }}>
                        <span style={{ color: '#fff', fontSize: '0.7rem' }}>✓</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              /* Neutral: select 2 */
              <div>
                <div className="text-xs text-muted mb-12">
                  Select 2 players ({selectedPair.length}/2 selected)
                </div>
                <div className="guess-player-list">
                  {otherPlayers.map(player => {
                    const pIdx = playerIndex(player.id);
                    const isSelected = selectedPair.includes(player.id);
                    const isDisabled = !isSelected && selectedPair.length >= 2;
                    return (
                      <button
                        key={player.id}
                        className={`guess-player-option ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled-opt' : ''}`}
                        onClick={() => !isDisabled && handleNeutralToggle(player.id)}
                        id={`guess-pair-${player.id}`}
                      >
                        <div
                          className="player-avatar"
                          style={{ width: 40, height: 40, fontSize: '1.1rem', background: AVATAR_COLORS[pIdx % AVATAR_COLORS.length] }}
                        >
                          {player.name[0]?.toUpperCase()}
                        </div>
                        <span style={{ fontWeight: 600 }}>{player.name}</span>
                        <div className={`check-circle ${isSelected ? 'checked' : ''}`} style={{ marginLeft: 'auto' }}>
                          {isSelected && <span style={{ color: '#fff', fontSize: '0.7rem' }}>✓</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              className={`btn btn-lg btn-full mt-24 ${
                (isHidden ? canSubmitHidden : canSubmitNeutral) ? 'btn-primary' : 'btn-secondary'
              }`}
              disabled={isHidden ? !canSubmitHidden : !canSubmitNeutral}
              onClick={handleSubmit}
              id="submit-guess-btn"
            >
              🎯 Lock In Guess
            </button>
          </div>
        ) : (
          <div className="glass p-32 text-center" style={{ borderRadius: 'var(--radius-xl)' }}>
            <div style={{ fontSize: '3rem', marginBottom: 12 }}>🔒</div>
            <div className="heading-md mb-8">Guess Locked In!</div>
            <p className="text-muted text-sm">Waiting for other players...</p>
          </div>
        )}

        {/* Guess progress */}
        <div className="glass mt-12" style={{ padding: '14px 18px', borderRadius: 'var(--radius-lg)' }}>
          <div className="flex justify-between items-center mb-8">
            <span className="text-xs text-muted">Guesses submitted</span>
            <span className="text-xs text-mono" style={{ color: 'var(--green-400)', fontWeight: 700 }}>
              {roomState.submittedGuessCount} / {roomState.totalPlayers}
            </span>
          </div>
          <div className="timer-bar-wrap">
            <div
              className="timer-bar"
              style={{
                width: `${roomState.totalPlayers > 0 ? (roomState.submittedGuessCount / roomState.totalPlayers) * 100 : 0}%`,
                background: 'linear-gradient(90deg, var(--rose-500), var(--amber-400))',
                transition: 'width 0.4s ease',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
