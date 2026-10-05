import type { RoomState, BluffAction } from '../types/game';
import { TOTAL_ROUNDS } from '../constants';
import TimerBar from './TimerBar';

interface Props {
  roomState: RoomState;
  myId: string;
  onAction: (action: BluffAction) => void;
}

export function PlayingCard({ rank, hidden, small }: { rank?: 'Joker' | 'J' | 'Q' | 'K'; hidden?: boolean; small?: boolean }) {
  const isRed = rank === 'Q' || rank === 'K' || rank === 'Joker';
  return (
    <div
      style={{
        width: small ? 56 : 96,
        height: small ? 78 : 134,
        borderRadius: 10,
        background: hidden ? 'linear-gradient(135deg, #312e81, #4c1d95)' : '#f8fafc',
        border: `2px solid ${hidden ? 'var(--purple-400)' : '#cbd5e1'}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
        color: isRed ? '#dc2626' : '#0f172a',
        fontWeight: 800,
      }}
    >
      {hidden ? (
        <span style={{ fontSize: small ? '1.2rem' : '2rem', color: '#fff' }}>🂠</span>
      ) : (
        <>
          <span style={{ fontSize: small ? '1.6rem' : '3rem', lineHeight: 1 }}>{rank}</span>
          <span style={{ fontSize: small ? '0.6rem' : '0.7rem', letterSpacing: '0.1em' }}>
            {rank === 'J' ? 'JACK' : rank === 'Q' ? 'QUEEN' : rank === 'K' ? 'KING' : 'JOKER'}
          </span>
        </>
      )}
    </div>
  );
}

const ACTION_LABEL: Record<BluffAction, string> = {
  check: '➖ Checked',
  bet: '💰 Bet',
  raise: '📈 Raise',
  call: '📞 Called',
  fold: '🏳️ Folded',
};

export default function BluffBetPhase({ roomState, myId, onAction }: Props) {
  const bluff = roomState.bluffState;
  if (!bluff) return null;

  const myCard = bluff.cards[myId];
  const opponent = roomState.players.find(p => p.id !== myId);
  const myTurn = bluff.toActId === myId;
  const nameOf = (id: string) => roomState.players.find(p => p.id === id)?.name ?? '???';

  return (
    <div className="page-top">
      <div className="container animate-fade-up" style={{ maxWidth: 640 }}>
        <div className="text-center mb-28">
          <div className="flex items-center justify-center gap-12 mb-16">
            <div className="round-dots">
              {Array.from({ length: TOTAL_ROUNDS }).map((_, i) => (
                <div key={i} className={`round-dot ${i + 1 === roomState.round ? 'active' : i + 1 < roomState.round ? 'done' : ''}`} />
              ))}
            </div>
            <div className="badge badge-rose">🃏 Betting</div>
          </div>
          <h1 className="heading-xl">
            Bluff <span className="gradient-amber">Card</span>
          </h1>
          <p className="text-muted text-sm mt-8">
            {myTurn
              ? bluff.facingBet
                ? `${nameOf(bluff.history[bluff.history.length - 1]?.playerId ?? '')} bet — fold or call!`
                : 'Your move — check or bet!'
              : `Waiting for ${opponent?.name ?? 'opponent'}…`}
          </p>
          {roomState.timerEnd && (
            <div style={{ maxWidth: 400, margin: '16px auto 0' }}>
              <TimerBar endTime={roomState.timerEnd} color="amber" />
            </div>
          )}
        </div>

        {/* Table */}
        <div className="glass p-20" style={{ borderRadius: 'var(--radius-xl)', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ textAlign: 'center' }}>
              <div className="text-xs text-muted mb-8" style={{ fontWeight: 700, textTransform: 'uppercase' }}>You</div>
              <PlayingCard rank={myCard} />
            </div>
            <div style={{ textAlign: 'center', alignSelf: 'center' }} className="text-muted text-sm">vs</div>
            <div style={{ textAlign: 'center' }}>
              <div className="text-xs text-muted mb-8" style={{ fontWeight: 700, textTransform: 'uppercase' }}>{opponent?.name ?? 'Opponent'}</div>
              <PlayingCard hidden />
            </div>
          </div>
          <p className="text-xs text-muted text-center mt-12" style={{ fontStyle: 'italic' }}>
            Deck: Joker · J · Q · K — one card each, Joker beats King, loses to Q/J, higher card wins showdowns
          </p>
        </div>

        {/* History */}
        {bluff.history.length > 0 && (
          <div className="glass p-16" style={{ borderRadius: 'var(--radius-xl)', marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              {bluff.history.map((h, i) => (
                <span key={i} className="badge badge-muted" style={{ fontSize: '0.7rem' }}>
                  {h.playerName}: {ACTION_LABEL[h.action]}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="glass p-20" style={{ borderRadius: 'var(--radius-xl)' }}>
          {!myTurn ? (
            <p className="text-muted text-sm text-center" style={{ fontStyle: 'italic' }}>Opponent is thinking…</p>
          ) : bluff.facingBet ? (
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-secondary btn-lg btn-full" onClick={() => onAction('fold')} id="bluff-fold-btn">
                🏳️ Fold
              </button>
              <button className="btn btn-primary btn-lg btn-full" onClick={() => onAction('call')} id="bluff-call-btn">
                📞 Call — showdown!
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-secondary btn-lg btn-full" onClick={() => onAction('check')} id="bluff-check-btn">
                ➖ Check
              </button>
              <button className="btn btn-primary btn-lg btn-full" onClick={() => onAction('bet')} id="bluff-bet-btn">
                💰 Bet
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
