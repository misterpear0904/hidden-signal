import type { RoomState } from '../types/game';
import { TOTAL_ROUNDS } from '../constants';
import { PipDice, sortDiceAsc } from './Dice';

interface Props {
  roomState: RoomState;
  myId: string;
  isHost?: boolean;
  isLastRound: boolean;
  onNextRound: () => void;
}

export default function LiarRevealPhase({ roomState, myId, isHost = false, isLastRound, onNextRound }: Props) {
  const isHostNow = roomState?.hostId != null ? roomState.hostId === myId : (isHost ?? false);
  const liar = roomState.liarState;
  if (!liar) return null;

  const nameOf = (id: string | null) => roomState.players.find(p => p.id === id)?.name ?? '???';
  const bid = liar.challengedBid;
  const iWon = liar.winnerId === myId;
  const myDelta = liar.points[myId] ?? 0;

  const lastBid = liar.bids?.[liar.bids.length - 1] ?? bid;
  const headline = liar.reason === 'timeout'
    ? (liar.bids?.length
        ? `⏱️ ${nameOf(liar.loserId)} ran out of time!`
        : `⏱️ ${nameOf(liar.loserId)} ran out of time before bidding!`)
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
          {bid && liar.reason !== 'timeout' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 8 }}>
              <p className="text-muted text-sm">
                Bid was{' '}<strong style={{ color: '#fff', fontSize: '1.1rem' }}>{bid.qty} ×</strong>                {' '}— actually <strong style={{ color: 'var(--amber-400)', fontSize: '1.1rem' }}>{liar.actualCount}</strong>
              </p>
              <PipDice value={bid.face} size={44} />
            </div>
          )}
          {liar.reason === 'timeout' && (
            <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 'var(--radius-md)', background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)', color: 'var(--amber-400)', fontWeight: 600, fontSize: '0.85rem', textAlign: 'center' }}>
              {lastBid
                ? <>Standing bid was{' '}<strong>{lastBid.qty} ×</strong>{' '}<PipDice value={lastBid.face} size={28} />{' '}—{' '}{nameOf(liar.loserId)} failed to raise, so{' '}{nameOf(liar.winnerId)} (last bidder) wins +1.</>                : <>No bid was placed —{' '}{nameOf(liar.winnerId)} (next in turn order) wins +1.</>}
            </div>
          )}
        </div>

        <div className="glass p-24" style={{ borderRadius: 'var(--radius-xl)', marginBottom: 20 }}>
          <h2 className="heading-md mb-16">All dice</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {roomState.players.map(p => (
              <div key={p.id} className="score-row" style={{ flexWrap: 'wrap', rowGap: 8 }}>
                <span style={{ fontWeight: 700, minWidth: 90 }}>
                  {p.name}{p.id === myId ? ' (You)' : ''}
                </span>
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {sortDiceAsc(liar.dice[p.id] ?? []).map((d, i) => <PipDice key={i} value={d} size={40} />)}
                </span>
                <span className={`score-delta ${(liar.points[p.id] ?? 0) > 0 ? 'delta-pos' : 'delta-zero'}`} style={{ marginLeft: 'auto' }}>
                  +{liar.points[p.id] ?? 0}
                </span>
              </div>
            ))}
          </div>
          {myDelta > 0 && (
            <p className="text-center text-sm mt-16" style={{ color: 'var(--green-400)', fontWeight: 700 }}>
              {`+${myDelta} pt${myDelta === 1 ? '' : 's'} for you this round!`}            </p>
          )}
        </div>

        {isHostNow ? (
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
