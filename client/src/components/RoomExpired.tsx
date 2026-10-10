import { useEffect } from 'react';

interface RoomExpiredProps {
  roomCode: string;
  reason: string;
  onClear: () => void;
}

export default function RoomExpired({ roomCode, reason, onClear }: RoomExpiredProps) {
  useEffect(() => {
    console.log('[RoomExpired] displayed for', roomCode, reason);
  }, [roomCode, reason]);

  return (
    <div className="page" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, padding: 24 }}>
      <div className="glass" style={{ maxWidth: 480, width: '100%', borderRadius: 'var(--radius-xl)', padding: 40, textAlign: 'center', border: '2px solid rgba(244,63,94,0.4)', background: 'rgba(60,10,10,0.6)' }}>
        <div style={{ fontSize: '4rem', marginBottom: 16 }}>🏚️</div>
        <h2 className="heading-lg" style={{ color: '#fca5a5', marginBottom: 8 }}>Room Expired</h2>
        <p className="text-muted text-sm" style={{ marginBottom: 24 }}>
          The room <code className="font-mono text-base" style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: 4 }}>{roomCode}</code> no longer exists.
        </p>
        <p className="text-xs text-muted" style={{ marginBottom: 32, fontFamily: 'monospace', maxWidth: '90%', marginLeft: 'auto', marginRight: 'auto', wordBreak: 'break-all' }}>
          {reason}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onClear}
            style={{ width: '100%', padding: '16px 24px', fontSize: '1rem' }}
          >
            🔙 Return to Lobby
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => window.location.reload()}
            style={{ width: '100%', padding: '16px 24px', fontSize: '1rem' }}
          >
            🔄 Refresh Page
          </button>
        </div>
      </div>
      <p className="text-xs text-muted" style={{ marginTop: 16 }}>
        This usually happens when the server restarts or the room was cleaned up after all players left.
      </p>
    </div>
  );
}