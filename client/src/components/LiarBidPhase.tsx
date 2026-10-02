import { useState, useEffect } from 'react';
import type { RoomState } from '../types/game';
import { TOTAL_ROUNDS } from '../constants';
import TimerBar from './TimerBar';

interface Props {
  roomState: RoomState;
  myId: string;
  onBid: (qty: number, face: number) => void;
  onCall: (kind: 'liar' | 'exact') => void;
}

export const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

export default function LiarBidPhase({ roomState, myId, onBid, onCall }: Props) {
  const liar = roomState.liarState;
  const bids = liar?.bids ?? [];
  const lastBid = bids[bids.length - 1];
  const totalDice = (liar?.diceEach ?? 3) * roomState.players.length;

  const [qty, setQty] = useState(lastBid ? lastBid.qty : 1);
  const [face, setFace] = useState(1);

  // Sensible defaults whenever the opponent raises
  useEffect(() => {
    if (!lastBid) { setQty(1); setFace(1); return; }
    if (lastBid.face < 6) { setQty(lastBid.qty); setFace(lastBid.face + 1); }
    else if (lastBid.qty < totalDice) { setQty(lastBid.qty + 1); setFace(1); }
    else { setQty(lastBid.qty); setFace(lastBid.face); }
  }, [bids.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!liar) return null;
  const myDice = liar.dice[myId] ?? [];
  const opponent = roomState.players.find(p => p.id !== myId);
  const myTurn = liar.toActId === myId;
  const minQty = lastBid ? lastBid.qty : 1;
  const validBid = qty >= minQty && qty <= totalDice && face >= 1 && face <= 6 &&
    (!lastBid || qty > lastBid.qty || (qty === lastBid.qty && face > lastBid.face));

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
            <div className="badge badge-purple">🎲 Bidding</div>
          </div>
          <h1 className="heading-xl">
            Liar's <span className="gradient-purple">Dice</span>
          </h1>
          <p className="text-muted text-sm mt-8">
            {myTurn ? 'Your move — raise the bid or call it!' : `Waiting for ${opponent?.name ?? 'opponent'}…`}
          </p>
          {roomState.timerEnd && (
            <div style={{ maxWidth: 400, margin: '16px auto 0' }}>
              <TimerBar endTime={roomState.timerEnd} color="purple" />
            </div>
          )}
        </div>

        {/* Dice */}
        <div className="glass p-20" style={{ borderRadius: 'var(--radius-xl)', marginBottom: 16 }}>
          <div className="text-xs text-muted mb-8" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Your hidden dice
          </div>
          <div style={{ display: 'flex', gap: 10, fontSize: '3rem', lineHeight: 1 }}>
            {myDice.map((d, i) => <span key={i}>{DICE_FACES[d - 1]}</span>)}
          </div>
          <div className="text-xs text-muted mt-12">
            {opponent?.name} holds <strong>{liar.diceEach} hidden dice</strong> · {totalDice} total in play
          </div>
        </div>

        {/* Bid history */}
        {bids.length > 0 && (
          <div className="glass p-16" style={{ borderRadius: 'var(--radius-xl)', marginBottom: 16 }}>
            <div className="text-xs text-muted mb-8" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Bid history
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[...bids].reverse().map((b, i) => (
                <div key={bids.length - 1 - i} className="text-sm" style={{ color: i === 0 ? '#fff' : 'var(--text-muted)', fontWeight: i === 0 ? 700 : 400 }}>
                  {i === 0 ? '👉 ' : ''}{b.playerName}: at least <strong>{b.qty} × {DICE_FACES[b.face - 1]}</strong>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="glass p-20" style={{ borderRadius: 'var(--radius-xl)' }}>
          {!myTurn ? (
            <p className="text-muted text-sm text-center" style={{ fontStyle: 'italic' }}>Opponent is thinking…</p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 14 }}>
                <div className="input-group" style={{ flex: 1 }}>
                  <label className="input-label" htmlFor="liar-qty">How many? ({minQty}–{totalDice})</label>
                  <input
                    id="liar-qty"
                    type="number"
                    className="input"
                    style={{ textAlign: 'center', fontSize: '1.2rem' }}
                    min={minQty}
                    max={totalDice}
                    value={qty}
                    onChange={e => setQty(Number(e.target.value))}
                  />
                </div>
                <div className="input-group" style={{ flex: 2 }}>
                  <label className="input-label">Of which face?</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[1, 2, 3, 4, 5, 6].map(f => {
                      const disallowed = !!lastBid && qty === lastBid.qty && f <= lastBid.face;
                      return (
                        <button
                          key={f}
                          type="button"
                          disabled={disallowed}
                          onClick={() => setFace(f)}
                          aria-label={`Face ${f}`}
                          style={{
                            flex: 1,
                            fontSize: '1.6rem',
                            padding: '6px 0',
                            borderRadius: 'var(--radius-md)',
                            background: face === f ? 'rgba(139,92,246,0.25)' : 'rgba(255,255,255,0.04)',
                            border: `2px solid ${face === f ? 'var(--purple-400)' : 'var(--border)'}`,
                            opacity: disallowed ? 0.3 : 1,
                            cursor: disallowed ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {DICE_FACES[f - 1]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <button
                className={`btn btn-lg btn-full ${validBid ? 'btn-primary' : 'btn-secondary'}`}
                disabled={!validBid}
                onClick={() => validBid && onBid(qty, face)}
                id="liar-raise-btn"
                style={{ marginBottom: 10 }}
              >
                📣 Bid {qty} × {DICE_FACES[face - 1]}
              </button>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  className="btn btn-secondary btn-full"
                  disabled={!lastBid}
                  onClick={() => onCall('liar')}
                  id="liar-call-btn"
                  title="Challenge: the bid is NOT true"
                >
                  🤥 LIAR!
                </button>
                <button
                  className="btn btn-secondary btn-full"
                  disabled={!lastBid}
                  onClick={() => onCall('exact')}
                  id="liar-exact-btn"
                  title="Challenge: the count is EXACTLY right (+2 if correct)"
                >
                  🎯 EXACT!
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
