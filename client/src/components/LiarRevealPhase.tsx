import type { RoomState } from '../types/game';
import { TOTAL_ROUNDS } from '../constants';
import { DICE_FACES } from './LiarBidPhase';

interface Props {
  roomState: RoomState;
  myId: string;
  isHost: boolean;
  isLastRound: boolean;
  onNextRound: () => void;
}

export default function LiarRevealPhase({ roomState, myId, isHost, isLastRound, onNextRound }: Props) {
  const liar = roomState.liarState;
  if (!liar) return null;

  const nameOf = (id: string | null) => roomState.players.find(p => p.id === id)?.name ?? '???';
  const bid = liar.challengedBid;
  const iWon = liar.winnerId === myId;
  const myDelta = liar.points[myId] ?? 0;

  const headline = liar.reason === 'timeout'
    ? `⏱️ ${nameOf(liar.loserId)} ran out of time!`
    : liar.reason === 'exact'
    ? (liar.winnerId === bid?.bidderId
        ? `🎯 Count wasn't exact — ${nameOf(liar.winnerId)} takes it!`
        : `🎯 EXACT! ${nameOf(liar.winnerId)} nailed it! (+2 pts)`)
    : (liar.winnerId === bid?.bidderId
      ? `🤥 The bid was TRUE — ${nameOf(liar.winnerId)} takes it!`
      : `🤥 LIAR! The bid was false — ${nameOf(liar.winnerId)} takes it!`);

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
            <div className="badge badge-purple">🎲 Revealed</div>
          </div>
          <div style={{ fontSize: '3.5rem', marginBottom: 8 }}>{iWon ? '🏆' : '🎲'}</div>
          <h1 className="heading-xl mb-8">{headline}</h1>
          {bid && (
            <p className="text-muted text-sm">
              Bid was <strong style={{ color: '#fff' }}>{bid.qty} × {DICE_FACES[bid.face - 1]}</strong>
              {' '}— actually <strong style={{ color: 'var(--amber-400)' }}>{liar.actualCount}</strong>
            </p>
          )}
        </div>

        <div className="glass p-24" style={{ borderRadius: 'var(--radius-xl)', marginBottom: 20 }}>
          <h2 className="heading-md mb-16">All dice</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {roomState.players.map(p => (
              <div key={p.id} className="score-row">
                <span style={{ fontWeight: 700, minWidth: 90 }}>
                  {p.name}{p.id === myId ? ' (You)' : ''}
                </span>
                <span style={{ fontSize: '2rem', lineHeight: 1 }}>
                  {(liar.dice[p.id] ?? []).map((d, i) => <span key={i}>{DICE_FACES[d - 1]}</span>)}
                </span>
                <span className={`score-delta ${(liar.points[p.id] ?? 0) > 0 ? 'delta-pos' : 'delta-zero'}`} style={{ marginLeft: 'auto' }}>
                  +{liar.points[p.id] ?? 0}
                </span>
              </div>
            ))}
          </div>
          {myDelta > 0 && (
            <p className="text-center text-sm mt-16" style={{ color: 'var(--green-400)', fontWeight: 700 }}>
              +{myDelta} pt{myDelta === 1 ? '' : 's'} for you this round!
            </p>
          )}
        </div>

        {isHost ? (
          <button className="btn btn-lg btn-primary btn-full" onClick={onNextRound} id="next-liar-round-btn">
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
