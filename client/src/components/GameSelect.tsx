import React, { useState } from 'react';

export interface GameRule {
  icon: string;
  text: string;
}

export interface GameDefinition {
  id: string;
  name: string;
  emoji: string;
  tagline: string;
  minPlayers: number;
  maxPlayers: number;
  rounds: number;
  tags: string[];
  accentColor: string;
  bgGradient: string;
  borderColor: string;
  available: boolean;
  rules: GameRule[];
}

export const GAME_CATALOGUE: GameDefinition[] = [
  {
    id: 'hidden-signal',
    name: 'Hidden Signal',
    emoji: '🕵️',
    tagline: 'Social deduction of secrets, signals & strategy',
    minPlayers: 4,
    maxPlayers: 12,
    rounds: 5,
    tags: ['Deduction', 'Bluffing', 'Team'],
    accentColor: 'var(--purple-400)',
    bgGradient: 'linear-gradient(135deg, rgba(139,92,246,0.12), rgba(109,40,217,0.06))',
    borderColor: 'rgba(139,92,246,0.35)',
    available: true,
    rules: [
      { icon: '🕵️', text: '2 players are secretly the Hidden Pair — they share a hidden signal but don\'t know who each other are' },
      { icon: '💬', text: 'Players are now free to have discussions openly as a group' },
      { icon: '⚡', text: 'At any time, a player may submit a guess, ending the round for everyone' },
      { icon: '🤝', text: 'Hidden Pair: Guess your partner → +1 pt each if correct' },
      { icon: '🎯', text: 'Neutral players: Pick ONE player you think is part of the hidden pair → +1 pt if correct' },
      { icon: '🛡️', text: 'Any wrong guess -> -3 pt penalty' },
      { icon: '🏆', text: 'Highest total score after 5 rounds wins!' },
    ],
  },
  {
    id: 'chroma-shift',
    name: 'Chroma Shift',
    emoji: '🎨',
    tagline: 'Race to spot the single tile slowly shifting color!',
    minPlayers: 2,
    maxPlayers: 12,
    rounds: 5,
    tags: ['Perception', 'Reaction', '2+ Players'],
    accentColor: 'var(--cyan-400)',
    bgGradient: 'linear-gradient(135deg, rgba(6,182,212,0.12), rgba(14,165,233,0.06))',
    borderColor: 'rgba(6,182,212,0.35)',
    available: true,
    rules: [
      { icon: '🧩', text: '25 tiles on screen starting with the same initial gradient' },
      { icon: '👁️', text: 'Exactly ONE tile slowly changes its gradient over time — watch closely!' },
      { icon: '⚡', text: 'First player to click the correct changing tile wins the round!' },
      { icon: '⚠️', text: 'Clicking the wrong tile costs 1 point (-1 pt penalty) and round continues' },
      { icon: '⚙️', text: 'Easy (Static grid) | Medium (Floating movement) | Hard (Faster drift + dynamic tile sizes 0.5x-2x)' },
      { icon: '⚖️', text: 'Fair Points mode: Easy wins +1 pt, Medium wins +2 pts, Hard wins +3 pts per round' },
      { icon: '🏆', text: '5 total rounds — highest overall score wins!' },
    ],
  },
];

interface Props {
  selectedGameId: string | null;
  playerCount: number;
  isHost: boolean;
  onSelect: (gameId: string) => void;
}

export default function GameSelect({ selectedGameId, playerCount, isHost, onSelect }: Props) {
  // previewId tracks which card has its rules expanded (any player can do this)
  const [previewId, setPreviewId] = useState<string | null>(null);

  function handleCardClick(game: GameDefinition) {
    if (game.id === previewId) {
      // Clicking the already-previewed card collapses it (unless host selected it)
      setPreviewId(null);
    } else {
      setPreviewId(game.id);
    }
    // Only the host actually selects the game
    if (isHost && game.available) {
      onSelect(game.id);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {GAME_CATALOGUE.map((game) => {
        const isSelected = selectedGameId === game.id;
        const isPreviewed = previewId === game.id;
        const isExpanded = isSelected || isPreviewed;
        const isLocked = !game.available;
        const canPlay = playerCount >= game.minPlayers;

        return (
          <div key={game.id} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {/* ── Card row ── */}
            <button
              id={`game-select-${game.id}`}
              onClick={() => handleCardClick(game)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                width: '100%',
                padding: '18px 20px',
                borderRadius: isExpanded ? 'var(--radius-xl) var(--radius-xl) 0 0' : 'var(--radius-xl)',
                background: isSelected
                  ? game.bgGradient
                  : isPreviewed
                    ? 'rgba(255,255,255,0.05)'
                    : 'rgba(255,255,255,0.03)',
                border: `2px solid ${isSelected ? game.borderColor : isPreviewed ? 'rgba(255,255,255,0.15)' : 'var(--border)'}`,
                borderBottom: isExpanded ? 'none' : undefined,
                cursor: isLocked ? 'not-allowed' : 'pointer',
                textAlign: 'left',
                transition: 'all 0.2s',
                opacity: isLocked ? 0.5 : 1,
                boxShadow: isSelected ? `0 0 24px ${game.borderColor}` : 'none',
                position: 'relative',
                overflow: 'hidden',
              }}
              className="game-card-btn"
              title={isHost ? (isLocked ? 'Coming soon' : 'Click to select') : 'Click to view rules'}
            >
              {/* Selected shimmer */}
              {isSelected && (
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.04), transparent)',
                  pointerEvents: 'none',
                }} />
              )}

              {/* Emoji icon */}
              <div style={{
                fontSize: '2rem', lineHeight: 1, flexShrink: 0,
                width: 48, height: 48,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isSelected ? game.bgGradient : 'rgba(255,255,255,0.05)',
                borderRadius: 'var(--radius-lg)',
                border: `1px solid ${isSelected ? game.borderColor : 'var(--border)'}`,
              }}>
                {game.emoji}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{
                    fontWeight: 700, fontSize: '1rem',
                    color: isSelected ? game.accentColor : 'var(--text-primary)',
                  }}>
                    {game.name}
                  </span>
                  {isLocked && (
                    <span className="badge badge-muted" style={{ fontSize: '0.55rem' }}>Coming Soon</span>
                  )}
                  {isSelected && (
                    <span className="badge" style={{
                      fontSize: '0.55rem',
                      background: game.bgGradient,
                      border: `1px solid ${game.borderColor}`,
                      color: game.accentColor,
                    }}>
                      Selected ✓
                    </span>
                  )}
                  {!isHost && (
                    <span className="badge badge-cyan" style={{ fontSize: '0.55rem' }}>
                      📖 Click for Rules
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted" style={{ marginBottom: 8, lineHeight: 1.4 }}>
                  {game.tagline}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span className="badge" style={{
                    fontSize: '0.6rem',
                    background: canPlay ? 'rgba(74,222,128,0.1)' : 'rgba(251,113,133,0.1)',
                    border: `1px solid ${canPlay ? 'rgba(74,222,128,0.3)' : 'rgba(251,113,133,0.3)'}`,
                    color: canPlay ? 'var(--green-400)' : 'var(--rose-400)',
                  }}>
                    👥 {game.minPlayers}–{game.maxPlayers} players
                  </span>
                  <span className="badge badge-muted" style={{ fontSize: '0.6rem' }}>
                    🔄 {game.rounds} rounds
                  </span>
                  {game.tags.map(tag => (
                    <span key={tag} className="badge badge-muted" style={{ fontSize: '0.6rem' }}>{tag}</span>
                  ))}
                </div>
              </div>

              {/* Expand chevron / hint / radio */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                {isHost ? (
                  <div style={{
                    width: 20, height: 20, borderRadius: '50%',
                    border: `2px solid ${isSelected ? game.accentColor : 'var(--border)'}`,
                    background: isSelected ? game.accentColor : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.2s',
                  }}>
                    {isSelected && <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff' }} />}
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="text-xs" style={{ fontSize: '0.85rem', color: isExpanded ? 'var(--cyan-400)' : 'var(--text-muted)', fontWeight: 600 }}>
                      {isExpanded ? 'Hide Rules' : 'View Rules'}
                    </span>
                    <span style={{
                      fontSize: '1.8rem', color: isExpanded ? 'var(--cyan-400)' : 'var(--text-muted)',
                      transition: 'transform 0.2s',
                      transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                      display: 'inline-block',
                      lineHeight: 1,
                    }}>
                      ▾
                    </span>
                  </div>
                )}
              </div>
            </button>

            {/* ── Inline rules panel ── */}
            {isExpanded && (
              <div style={{
                background: isSelected
                  ? 'linear-gradient(180deg, rgba(139,92,246,0.07), rgba(109,40,217,0.03))'
                  : 'rgba(255,255,255,0.02)',
                border: `2px solid ${isSelected ? game.borderColor : 'rgba(255,255,255,0.1)'}`,
                borderTop: 'none',
                borderRadius: '0 0 var(--radius-xl) var(--radius-xl)',
                padding: '16px 20px 20px',
                animation: 'fadeUp 0.15s ease',
              }}>
                <p className="text-xs text-muted" style={{
                  fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
                  marginBottom: 12,
                }}>
                  How to Play
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {game.rules.map((rule, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <span style={{ fontSize: '1rem', flexShrink: 0, lineHeight: 1.4 }}>{rule.icon}</span>
                      <span className="text-sm text-muted" style={{ lineHeight: 1.5 }}>{rule.text}</span>
                    </div>
                  ))}
                </div>
                {!isHost && (
                  <p className="text-xs text-muted" style={{
                    marginTop: 14,
                    padding: '8px 12px',
                    background: 'rgba(255,255,255,0.04)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border)',
                    fontStyle: 'italic',
                  }}>
                    Only the host can choose the game to play.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
