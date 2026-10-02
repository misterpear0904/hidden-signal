import type { RoomState } from '../types/game';
import { TOTAL_ROUNDS } from '../constants';
import { PlayingCard } from './BluffBetPhase';

interface Props {
  roomState: RoomState;
  myId: string;
  isHost: boolean;
  isLastRound: boolean;
  onNextRound: () => void;
}

export default function BluffRevealPhase({ roomState, myId, isHost, isLastRound, onNextRound }: Props) {
  const bluff = roomState.bluffState;
  if (!bluff) return null;

  const nameOf = (id: string | null) => roomState.players.find(p => p.id === id)?.name ?? '???';
  const iWon = bluff.winnerId === myId;
  const myDelta = bluff.points[myId] ?? 0;

  const headline = bluff.reason === 'timeout'
    ? `⏱️ ${nameOf(bluff.loserId)} ran out of time!`
    : bluff.reason === 'fold'
    ? bluff.bluffWin
      ? `😎 ${nameOf(bluff.winnerId)} bluffed with a Jack and ${nameOf(bluff.loserId)} folded! (+2 pts)`
      : `🏳️ ${nameOf(bluff.loserId)} folded — ${nameOf(bluff.winnerId)} takes it!`
    : `${nameOf(bluff.winnerId)} wins the showdown!`;

  return (
    <div className="page-top">
      <div className="container animate-fade-up" style={{ maxWidth: 640 }}>
        <div className="text-center" style={{ marginBottom: 28 }}>
          <div className="flex items-center justify-center gap-12 mb-16">
            <div className="round-dots">
              {Array.from({ length: TOTAL_ROUNDS }).map((_, i) => (
                <div key={i} className={`round-dot ${i + 1 === roomState.round ? 'active' : i + 1 < roomState.round ? 'done' : ''}`} />
              ))}
            </div>
            <div className="badge badge-rose">🃏 Revealed</div>
          </div>
          <div style={{ fontSize: '3.5rem', marginBottom: 8 }}>{iWon ? '🏆' : '🃏'}</div>
          <h1 className="heading-xl mb-8">{headline}</h1>
        </div>

        <div className="glass p-24" style={{ borderRadius: 'var(--radius-xl)', marginBottom: 20 }}>
          <h2 className="heading-md mb-16 text-center">Showdown cards</h2>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 24 }}>
            {roomState.players.map(p => {
              const card = bluff.showdownCards?.[p.id] ?? bluff.cards[p.id];
              const isWinner = p.id === bluff.winnerId;
              return (
                <div key={p.id} style={{ textAlign: 'center' }}>
                  <div className="text-xs text-muted mb-8" style={{ fontWeight: 700 }}>
                    {p.name}{p.id === myId ? ' (You)' : ''} {isWinner ? '👑' : ''}
                  </div>
                  <PlayingCard rank={card} />
                  <div className={`score-delta ${(bluff.points[p.id] ?? 0) > 0 ? 'delta-pos' : 'delta-zero'}`} style={{ marginTop: 8 }}>
                    +{bluff.points[p.id] ?? 0}
                  </div>
                </div>
              );
            })}
          </div>
          {myDelta > 0 && (
            <p className="text-center text-sm mt-16" style={{ color: 'var(--green-400)', fontWeight: 700 }}>
              +{myDelta} pt{myDelta === 1 ? '' : 's'} for you this round!
            </p>
          )}
        </div>

        {isHost ? (
          <button className="btn btn-lg btn-primary btn-full" onClick={onNextRound} id="next-bluff-round-btn">
            {isLastRound ? '🏆 View Final Leaderboard' : 'Next Round ➔'}
          </button>
        ) : (
          <p className="text-xs text-muted text-center" style={{ fontStyle: 'italic' }}>
            Waiting for host to continue…
          </p>
        )}
      </div>
    </div>
  );
}
