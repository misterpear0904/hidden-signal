import type { FC } from 'react';

interface RestoreChoiceProps {
  roomCode: string;
  playerName: string;
  reason: string;
  onRejoin: () => void;
  onLeave: () => void;
}

const RestoreChoice: FC<RestoreChoiceProps> = ({ roomCode, playerName, reason, onRejoin, onLeave }) => {
  return (
    <div className="page" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, padding: 24 }}>
      <div className="glass" style={{ maxWidth: 480, width: '100%', borderRadius: 'var(--radius-xl)', padding: 40, textAlign: 'center', border: '2px solid rgba(251,191,36,0.4)', background: 'rgba(40,30,10,0.6)' }}>
        <div style={{ fontSize: '4rem', marginBottom: 16 }}>🔄</div>
        <h2 className="heading-lg" style={{ color: '#fbbf24', marginBottom: 8 }}>Session Restore</h2>
        <p className="text-muted text-sm" style={{ marginBottom: 12 }}>
          We couldn&apos;t restore your previous room
          {roomCode ? (
            <> <code className="font-mono text-base" style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: 4 }}>{roomCode}</code></>
          ) : null}
          {playerName ? <> as {playerName}</> : null}.
        </p>
        <p className="text-xs text-muted" style={{ marginBottom: 24, wordBreak: 'break-word' }}>{reason}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button type="button" className="btn btn-primary" onClick={onRejoin} style={{ width: '100%', padding: '16px 24px', fontSize: '1rem' }}>
            🔁 Rejoin game
          </button>
          <button type="button" className="btn" onClick={onLeave} style={{ width: '100%', padding: '16px 24px', fontSize: '1rem' }}>
            🚪 Leave room
          </button>
        </div>
      </div>
      <p className="text-xs text-muted" style={{ marginTop: 16, maxWidth: 480, textAlign: 'center' }}>
        Your previous session could not be resumed as a live game. Choose to retry the rejoin or return to the lobby.
      </p>
    </div>
  );
};

export default RestoreChoice;