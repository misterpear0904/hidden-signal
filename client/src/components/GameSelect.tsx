import React from 'react';

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
  },
];

interface Props {
  selectedGameId: string | null;
  playerCount: number;
  isHost: boolean;
  onSelect: (gameId: string) => void;
}

export default function GameSelect({ selectedGameId, playerCount, isHost, onSelect }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {GAME_CATALOGUE.map((game) => {
        const isSelected = selectedGameId === game.id;
        const canPlay = playerCount >= game.minPlayers;
        const isLocked = !game.available;

        return (
          <button
            key={game.id}
            id={`game-select-${game.id}`}
            disabled={isLocked || !isHost}
            onClick={() => isHost && !isLocked && onSelect(game.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              width: '100%',
              padding: '18px 20px',
              borderRadius: 'var(--radius-xl)',
              background: isSelected ? game.bgGradient : 'rgba(255,255,255,0.03)',
              border: `2px solid ${isSelected ? game.borderColor : 'var(--border)'}`,
              cursor: isLocked || !isHost ? 'default' : 'pointer',
              textAlign: 'left',
              transition: 'all 0.2s',
              opacity: isLocked ? 0.5 : 1,
              boxShadow: isSelected ? `0 0 24px ${game.borderColor}` : 'none',
              position: 'relative',
              overflow: 'hidden',
            }}
            className="game-card-btn"
          >
            {/* Shimmer on selected */}
            {isSelected && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.04), transparent)',
                  pointerEvents: 'none',
                }}
              />
            )}

            {/* Emoji icon */}
            <div
              style={{
                fontSize: '2.2rem',
                lineHeight: 1,
                flexShrink: 0,
                width: 52,
                height: 52,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: isSelected ? game.bgGradient : 'rgba(255,255,255,0.05)',
                borderRadius: 'var(--radius-lg)',
                border: `1px solid ${isSelected ? game.borderColor : 'var(--border)'}`,
              }}
            >
              {game.emoji}
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontSize: '1rem', color: isSelected ? game.accentColor : 'var(--text-primary)' }}>
                  {game.name}
                </span>
                {isLocked && (
                  <span className="badge badge-muted" style={{ fontSize: '0.55rem' }}>Coming Soon</span>
                )}
                {isSelected && (
                  <span className="badge badge-purple" style={{ fontSize: '0.55rem', background: game.bgGradient, borderColor: game.borderColor, color: game.accentColor }}>
                    Selected ✓
                  </span>
                )}
              </div>
              <div className="text-xs text-muted" style={{ marginBottom: 8, lineHeight: 1.4 }}>
                {game.tagline}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {/* Player limit */}
                <span
                  className="badge"
                  style={{
                    fontSize: '0.6rem',
                    background: canPlay ? 'rgba(74,222,128,0.1)' : 'rgba(251,113,133,0.1)',
                    border: `1px solid ${canPlay ? 'rgba(74,222,128,0.3)' : 'rgba(251,113,133,0.3)'}`,
                    color: canPlay ? 'var(--green-400)' : 'var(--rose-400)',
                  }}
                >
                  👥 {game.minPlayers}–{game.maxPlayers} players
                </span>
                {/* Rounds */}
                <span className="badge badge-muted" style={{ fontSize: '0.6rem' }}>
                  🔄 {game.rounds} rounds
                </span>
                {/* Tags */}
                {game.tags.map(tag => (
                  <span key={tag} className="badge badge-muted" style={{ fontSize: '0.6rem' }}>{tag}</span>
                ))}
              </div>
            </div>

            {/* Selection radio */}
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                border: `2px solid ${isSelected ? game.accentColor : 'var(--border)'}`,
                background: isSelected ? game.accentColor : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'all 0.2s',
              }}
            >
              {isSelected && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />}
            </div>
          </button>
        );
      })}
    </div>
  );
}
