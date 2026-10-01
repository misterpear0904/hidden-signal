import type { RoomState } from '../types/game';
import { TOTAL_ROUNDS, avatarColor, avatarInitial } from '../constants';

interface Props {
  roomState: RoomState;
  myId: string;
  isHost: boolean;
  isLastRound: boolean;
  onNextRound: () => void;
}

export default function BlendRevealPhase({ roomState, myId, isHost, isLastRound, onNextRound }: Props) {
  const blend = roomState.blendState;
  if (!blend) return null;

  const nameOf = (id: string) => roomState.players.find(p => p.id === id)?.name ?? '???';
  const voters = blend.votes.filter(v => v.targetId === blend.chameleonId);
  const iScored = (blend.points[myId] ?? 0) > 0;

  return (
    <div className="page-top">
      <div className="container animate-fade-up">
        <div className="text-center" style={{ marginBottom: 28 }}>
          <div style={{ fontSize: '3.5rem', marginBottom: 8 }}>🦎</div>
          <h1 className="heading-xl mb-8">
            {blend.caught ? 'Caught!' : 'Escaped!'}
          </h1>
          <p className="text-muted text-sm">
            The chameleon was <strong style={{ color: 'var(--amber-400)' }}>{blend.chameleonName}</strong>
            {' '}· secret word was <strong style={{ color: 'var(--cyan-400)' }}>“{blend.secretWord}”</strong> ({blend.category})
          </p>
        </div>

        <div
          className="glass text-center"
          style={{ padding: '20px', borderRadius: 'var(--radius-xl)', marginBottom: 20 }}
        >
          {blend.caught ? (
            blend.stealSuccess ? (
              <div style={{ fontWeight: 700 }}>🤯 {blend.chameleonName} guessed “{blend.chameleonGuess}” and stole it! (+2 pts)</div>
            ) : (
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  🎯 {voters.length} player{voters.length === 1 ? '' : 's'} spotted the chameleon (+1 pt each)
                </div>
                <div className="text-xs text-muted">
                  {blend.chameleonGuess
                    ? `${blend.chameleonName} guessed “${blend.chameleonGuess}” — wrong!`
                    : `${blend.chameleonName} couldn't guess the word.`}
                </div>
              </div>
            )
          ) : (
            <div style={{ fontWeight: 700 }}>
              😎 {blend.chameleonName} blended in! {blend.accusedId ? `${nameOf(blend.accusedId)} took the blame.` : 'No majority accusation.'} (+2 pts)
            </div>
          )}
        </div>

        <div className="glass p-24" style={{ borderRadius: 'var(--radius-xl)', marginBottom: 20 }}>
          <h2 className="heading-md mb-16">Votes & clues</h2>
          <div className="flex flex-col gap-8">
            {roomState.players.map((p, i) => {
              const clue = blend.clues.find(c => c.playerId === p.id)?.word ?? '…';
              const voted = blend.votes.find(v => v.playerId === p.id);
              const delta = blend.points[p.id] ?? 0;
              const isCham = p.id === blend.chameleonId;
              return (
                <div key={p.id} className="score-row" style={isCham ? { background: 'rgba(251,191,36,0.06)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(251,191,36,0.2)' } : {}}>
                  <div className="player-avatar" style={{ width: 36, height: 36, fontSize: '0.9rem', background: avatarColor(i) }}>
                    {avatarInitial(p.name)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {p.name}
                      {p.id === myId && <span className="badge badge-cyan" style={{ fontSize: '0.55rem' }}>You</span>}
                      {isCham && <span className="badge badge-amber" style={{ fontSize: '0.55rem' }}>🦎 Chameleon</span>}
                    </div>
                    <div className="text-xs text-muted">“{clue}” → voted {voted ? nameOf(voted.targetId) : '—'}</div>
                  </div>
                  <div className={`score-delta ${delta > 0 ? 'delta-pos' : 'delta-zero'}`}>+{delta}</div>
                </div>
              );
            })}
          </div>
          {iScored && <p className="text-center text-sm mt-16" style={{ color: 'var(--green-400)', fontWeight: 700 }}>+{blend.points[myId]} pts for you this round!</p>}
        </div>

        {isHost ? (
          <button className="btn btn-lg btn-primary btn-full" onClick={onNextRound} id="next-blend-round-btn">
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
