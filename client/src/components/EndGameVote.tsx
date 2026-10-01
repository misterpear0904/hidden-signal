import type { RoomState } from '../types/game';

interface Props {
  roomState: RoomState;
  myId: string;
  isHost: boolean;
  onRequest: () => void;
  onVote: (agree: boolean) => void;
  onCancel: () => void;
}

export default function EndGameVote({ roomState, myId, isHost, onRequest, onVote, onCancel }: Props) {
  const vote = roomState.endVote;

  // No vote running: host gets a subtle propose button
  if (!vote) {
    if (!isHost) return null;
    return (
      <button
        type="button"
        onClick={() => {
          if (window.confirm('Propose ending the game? Everyone must agree to return to the lobby (scores reset).')) {
            onRequest();
          }
        }}
        className="btn btn-sm btn-secondary"
        id="propose-end-game-btn"
        title="Propose ending the game early — requires everyone to agree"
        style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 500, opacity: 0.85 }}
      >
        End game…
      </button>
    );
  }

  const connected = roomState.players.filter(p => p.connected);
  const agreed = connected.filter(p => vote.yesIds.includes(p.id));
  const iAgreed = vote.yesIds.includes(myId);
  const iAmInitiator = vote.initiatorId === myId;

  return (
    <div
      className="glass animate-fade-up"
      role="alert"
      style={{
        position: 'fixed',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        maxWidth: 440,
        width: 'calc(100% - 32px)',
        borderRadius: 'var(--radius-xl)',
        padding: '14px 18px',
        background: 'linear-gradient(135deg, rgba(251,191,36,0.15), rgba(239,68,68,0.1))',
        border: '2px solid var(--amber-400)',
        textAlign: 'center',
      }}
    >
      <div style={{ fontWeight: 800, fontSize: '0.95rem', color: '#fff' }}>
        🗳️ {vote.initiatorName} wants to end the game
      </div>
      <p className="text-xs text-muted" style={{ margin: '4px 0 0' }}>
        Return to lobby (scores reset) — needs everyone ({agreed.length}/{connected.length} agreed)
      </p>
      {!iAgreed && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button type="button" className="btn btn-sm btn-primary btn-full" onClick={() => onVote(true)} id="end-vote-yes-btn">
            ✓ End it
          </button>
          <button type="button" className="btn btn-sm btn-secondary btn-full" onClick={() => onVote(false)} id="end-vote-no-btn">
            ✖ Keep playing
          </button>
        </div>
      )}
      {iAgreed && !iAmInitiator && (
        <p className="text-xs text-muted" style={{ margin: '8px 0 0', fontStyle: 'italic' }}>
          You agreed — waiting for {connected.length - agreed.length} more…
        </p>
      )}
      {iAmInitiator && (
        <button
          type="button"
          onClick={onCancel}
          className="btn btn-sm btn-secondary"
          id="end-vote-cancel-btn"
          style={{ marginTop: 10 }}
        >
          Cancel vote
        </button>
      )}
    </div>
  );
}
