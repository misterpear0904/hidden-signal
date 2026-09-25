import type { RoomState } from '../types/game';
import { avatarColor, avatarInitial } from '../constants';

interface Props {
  roomState: RoomState;
  myId: string;
  isHost: boolean;
  onPlayAgain: () => void;
}

const MEDALS = ['🥇', '🥈', '🥉'];

function rankLabel(i: number): string {
  const n = i + 1;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export default function FinalLeaderboard({ roomState, myId, isHost, onPlayAgain }: Props) {
  const sorted = [...roomState.players].sort((a, b) => b.score - a.score);
  const topScore = sorted[0]?.score ?? 0;
  const winners = sorted.filter(p => p.score === topScore);
  const iWin = winners.some(p => p.id === myId);
  const winner = sorted[0];
  const myRank = sorted.findIndex(p => p.id === myId);

  return (
    <div className="page-top">
      <div className="container animate-fade-up">
        {/* Trophy & Winner */}
        <div className="text-center" style={{ marginBottom: 32 }}>
          <div style={{ fontSize: '4rem', marginBottom: 12, animation: 'fade-up 0.5s ease' }}>
            {iWin ? '🏆' : '🎮'}
          </div>
          <h1 className="heading-xl mb-8">
            {iWin ? (
              <>You <span className="gradient-amber">Won!</span></>
            ) : (
              <>Game <span className="gradient-purple">Over!</span></>
            )}
          </h1>
          <p className="text-muted text-sm">
            {iWin
              ? winners.length > 1
                ? `Tied for first with ${winners.filter(p => p.id !== myId).map(p => p.name).join(', ')} — masterful deduction!`
                : 'Masterful deduction — you outsmarted everyone!'
              : winners.length > 1
              ? `${winners.map(p => p.name).join(' & ')} tie for the win!`
              : `${winner.name} takes the win!`}
          </p>
        </div>

        {/* Winner Spotlight */}
        {!iWin && (
          <div
            className="glass text-center"
            style={{
              padding: '28px',
              borderRadius: 'var(--radius-xl)',
              marginBottom: 20,
              background: 'linear-gradient(135deg, rgba(251,191,36,0.12), rgba(251,113,133,0.06))',
              border: '1px solid rgba(251,191,36,0.35)',
              boxShadow: '0 4px 40px rgba(251,191,36,0.15)',
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: 8 }}>🥇</div>
            <div
              className="player-avatar"
              style={{
                width: 72, height: 72, fontSize: '1.8rem',
                background: avatarColor(roomState.players.findIndex(p => p.id === winner.id)),
                margin: '0 auto 12px',
              }}
            >
              {avatarInitial(winner.name)}
            </div>
            <div className="heading-lg mb-4">{winner.name}</div>
            <div className="text-mono" style={{ fontSize: '2rem', color: 'var(--amber-400)', fontWeight: 700 }}>
              {winner.score} pts
            </div>
          </div>
        )}

        {/* Full Leaderboard */}
        <div className="glass p-24" style={{ borderRadius: 'var(--radius-xl)', marginBottom: 24 }}>
          <h2 className="heading-md mb-20">Final Standings</h2>
          {sorted.map((p, i) => {
            const pIdx = roomState.players.findIndex(rp => rp.id === p.id);
            const isMe = p.id === myId;
            return (
              <div
                key={p.id}
                className={`leaderboard-row animate-fade-up ${i === 0 ? 'first' : ''}`}
                style={{ animationDelay: `${i * 0.08}s` }}
                id={`leaderboard-row-${i}`}
              >
                <div className="rank-num">
                  {i < 3 ? MEDALS[i] : <span className="text-muted">{rankLabel(i)}</span>}
                </div>
                <div
                  className="player-avatar"
                  style={{
                    width: 44, height: 44, fontSize: '1.1rem',
                    background: avatarColor(pIdx),
                    flexShrink: 0,
                  }}
                >
                  {avatarInitial(p.name)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{p.name}</div>
                  {isMe && <div className="badge badge-cyan" style={{ fontSize: '0.6rem', marginTop: 2 }}>You</div>}
                </div>
                <div className="score-big">{p.score}</div>
              </div>
            );
          })}
        </div>

        {/* My Performance */}
        <div
          className="glass"
          style={{
            padding: '16px 20px',
            borderRadius: 'var(--radius-lg)',
            marginBottom: 24,
            background: 'rgba(139,92,246,0.06)',
            border: '1px solid rgba(139,92,246,0.2)',
          }}
        >
          <div className="text-xs text-muted mb-4" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Your Result
          </div>
          <div className="flex items-center gap-12">
            <span style={{ fontSize: '1.4rem' }}>{myRank === 0 ? '🏆' : myRank === 1 ? '🥈' : myRank === 2 ? '🥉' : '🎮'}</span>
            <span style={{ fontWeight: 600 }}>{rankLabel(myRank)} place</span>
            <span className="text-mono" style={{ marginLeft: 'auto', color: 'var(--purple-400)', fontWeight: 700, fontSize: '1.2rem' }}>
              {roomState.players.find(p => p.id === myId)?.score ?? 0} pts
            </span>
          </div>
        </div>

        {/* Play Again */}
        {isHost ? (
          <button
            className="btn btn-primary btn-lg btn-full"
            onClick={onPlayAgain}
            id="play-again-btn"
          >
            🔄 Play Again
          </button>
        ) : (
          <div className="glass text-center" style={{ padding: '20px', borderRadius: 'var(--radius-lg)' }}>
            <p className="text-muted text-sm">Waiting for host to start a new game...</p>
          </div>
        )}
      </div>
    </div>
  );
}
