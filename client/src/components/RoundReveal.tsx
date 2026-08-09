import React from 'react';
import type { RoundRevealData, RoomState } from '../types/game';

interface Props {
  revealData: RoundRevealData;
  roomState: RoomState;
  myId: string;
  isHost: boolean;
  isLastRound: boolean;
  onNextRound: () => void;
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

export default function RoundReveal({ revealData, roomState, myId, isHost, isLastRound, onNextRound }: Props) {
  const { hiddenPairIds, secretCode, roles, signals, guesses, scoreDeltas, players } = revealData;

  const myRole = roles.find(r => r.playerId === myId);
  const isHidden = myRole?.role === 'hidden';
  const myPartner = hiddenPairIds.find(id => id !== myId);
  const myPartnerPlayer = players.find(p => p.id === myPartner);
  const partnerGuess = guesses.find(g => g.playerId === myId);

  const playerMap = Object.fromEntries(players.map(p => [p.id, p]));
  const playerIndex = (id: string) => players.findIndex(p => p.id === id);

  const roleName = (id: string) => roles.find(r => r.playerId === id)?.role === 'hidden' ? 'Hidden' : 'Neutral';
  const isHiddenPlayer = (id: string) => hiddenPairIds.includes(id);

  // Determine outcome for me
  let myOutcomeLabel = '';
  let myOutcomeIcon = '';
  const myGuessSubmitted = guesses.some(g => g.playerId === myId);

  if (!myGuessSubmitted) {
    myOutcomeLabel = 'No vote submitted (-0 pts)';
    myOutcomeIcon = '⏸️';
  } else if (isHidden) {
    const correctPartner = hiddenPairIds.find(id => id !== myId);
    const guessedOk = guesses.find(g => g.playerId === myId)?.guessedPartnerId === correctPartner;
    myOutcomeLabel = guessedOk ? 'Found your partner! (+2 pts)' : 'Wrong partner choice (-1 pt)';
    myOutcomeIcon = guessedOk ? '🎉' : '😬';
  } else {
    const myGuess = guesses.find(g => g.playerId === myId);
    const guessedIds = new Set(myGuess?.guessedPairIds ?? []);
    const correctIds = new Set(hiddenPairIds);
    const hitCount = [...guessedIds].filter(id => correctIds.has(id)).length;
    const missCount = guessedIds.size - hitCount;
    if (hitCount === 2) { myOutcomeLabel = 'Perfect! Exposed both! (+2 pts)'; myOutcomeIcon = '🎯'; }
    else if (hitCount === 1) { myOutcomeLabel = 'Caught one (+1 pt), missed one (-1 pt)'; myOutcomeIcon = '🔍'; }
    else { myOutcomeLabel = 'Incorrect guess (-2 pts)'; myOutcomeIcon = '💨'; }
  }

  const myDelta = scoreDeltas[myId] ?? 0;

  return (
    <div className="page-top">
      <div className="container-wide animate-fade-up">
        {/* Header */}
        <div className="text-center mb-32">
          <div className="badge badge-purple mb-16" style={{ margin: '0 auto 16px' }}>
            Round {roomState.round} Result
          </div>
          <h1 className="heading-xl">
            The <span className="gradient-amber">Truth</span> Revealed
          </h1>
        </div>

        {/* Shared Hidden Signal Reveal */}
        <div
          className="glass text-center"
          style={{
            padding: '28px',
            borderRadius: 'var(--radius-xl)',
            marginBottom: 20,
            background: 'linear-gradient(135deg, rgba(251,191,36,0.1), rgba(251,113,133,0.06))',
            border: '1px solid rgba(251,191,36,0.3)',
          }}
        >
          <div className="text-xs text-muted mb-12" style={{ textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>
            The Shared Hidden Signal Was
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '4rem',
              fontWeight: 700,
              color: 'var(--amber-400)',
              lineHeight: 1,
            }}
          >
            {secretCode}
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            {hiddenPairIds.map(id => {
              const p = playerMap[id];
              const pIdx = playerIndex(id);
              return (
                <div key={id} className="flex items-center gap-8" style={{ background: 'rgba(251,191,36,0.15)', padding: '6px 14px', borderRadius: 'var(--radius-full)', border: '1px solid rgba(251,191,36,0.3)' }}>
                  <div className="player-avatar" style={{ width: 22, height: 22, fontSize: '0.65rem', background: AVATAR_COLORS[pIdx % AVATAR_COLORS.length] }}>
                    {p?.name?.[0]?.toUpperCase()}
                  </div>
                  <span className="text-sm" style={{ fontWeight: 600, color: 'var(--amber-400)' }}>{p?.name}</span>
                  <span className="badge badge-amber" style={{ fontSize: '0.55rem' }}>Hidden</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* My Outcome */}
        <div
          className="glass"
          style={{
            padding: '20px 24px',
            borderRadius: 'var(--radius-xl)',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            background: myDelta > 0 ? 'rgba(74,222,128,0.08)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${myDelta > 0 ? 'rgba(74,222,128,0.3)' : 'var(--border)'}`,
          }}
        >
          <span style={{ fontSize: '2rem' }}>{myOutcomeIcon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>{myOutcomeLabel}</div>
            <div className="text-xs text-muted">{isHidden ? 'Hidden Pair' : 'Neutral'}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div
              className="text-mono"
              style={{
                fontSize: '1.8rem', fontWeight: 700,
                color: myDelta > 0 ? 'var(--green-400)' : myDelta < 0 ? 'var(--rose-400)' : 'var(--text-muted)',
              }}
            >
              {myDelta > 0 ? `+${myDelta}` : myDelta}
            </div>
            <div className="text-xs text-muted">pts this round</div>
          </div>
        </div>

        {/* Signals + Roles + Scores Table */}
        <div className="glass p-24" style={{ borderRadius: 'var(--radius-xl)', marginBottom: 20 }}>
          <h2 className="heading-md mb-20">Round Breakdown</h2>
          <div className="flex flex-col gap-8">
            {players.map(p => {
              const pIdx = playerIndex(p.id);
              const sig = signals.find(s => s.playerId === p.id);
              const delta = scoreDeltas[p.id] ?? 0;
              const isHiddenP = isHiddenPlayer(p.id);
              const currentScore = roomState.players.find(rp => rp.id === p.id)?.score ?? p.score;
              return (
                <div
                  key={p.id}
                  className="score-row"
                  style={{
                    background: isHiddenP ? 'rgba(251,191,36,0.06)' : undefined,
                    borderRadius: 'var(--radius-md)',
                    border: isHiddenP ? '1px solid rgba(251,191,36,0.2)' : '1px solid transparent',
                  }}
                  id={`reveal-row-${p.id}`}
                >
                  <div className="player-avatar" style={{ width: 36, height: 36, fontSize: '0.9rem', background: AVATAR_COLORS[pIdx % AVATAR_COLORS.length] }}>
                    {p.name[0]?.toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {p.name}
                      {p.id === myId && <span className="badge badge-cyan" style={{ fontSize: '0.55rem' }}>You</span>}
                      <span className={`badge ${isHiddenP ? 'badge-amber' : 'badge-muted'}`} style={{ fontSize: '0.55rem' }}>
                        {isHiddenP ? 'Hidden' : 'Neutral'}
                      </span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div className={`score-delta ${delta > 0 ? 'delta-pos' : delta < 0 ? 'delta-neg' : 'delta-zero'}`} style={delta < 0 ? { color: 'var(--rose-400)' } : {}}>
                      {delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '0'}
                    </div>
                    <div className="text-xs text-muted">{currentScore} total</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Next Round / Host Control */}
        {isHost ? (
          <button
            className={`btn btn-lg btn-full ${isLastRound ? 'btn-amber' : 'btn-primary'}`}
            onClick={onNextRound}
            id="next-round-btn"
          >
            {isLastRound ? '🏆 See Final Results' : '▶ Next Round'}
          </button>
        ) : (
          <div className="glass text-center" style={{ padding: '20px', borderRadius: 'var(--radius-lg)' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />
            <p className="text-muted text-sm">Waiting for host to continue...</p>
          </div>
        )}
      </div>
    </div>
  );
}
