import { useState } from 'react';

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
    id: 'missile-command',
    name: 'Missile Command',
    emoji: '🚀',
    tagline: 'Two islands battle — build economy, shields & launch missiles!',
    minPlayers: 2,
    maxPlayers: 2,
    rounds: 1,
    tags: ['RTS', 'Real-time', '1v1', 'Economy'],
    accentColor: 'var(--amber-400)',
    bgGradient: 'linear-gradient(135deg, rgba(251,191,36,0.12), rgba(245,158,11,0.06))',
    borderColor: 'rgba(251,191,36,0.35)',
    available: true,
    rules: [
      { icon: '🏝️', text: 'Two players on 13×7 grid islands (Top vs Bottom) — every building takes one 1×1 square. Build only on your side!' },
      { icon: '💰', text: 'Tap an empty square to build. Generators pay continuous income (+2/s at Lv1, up to +20/s). Your ⭐ Core also pays +5/s baseline!' },
      { icon: '🛡️', text: 'Shield Generators guard ≈ 13 squares (range 2, no diagonals) and FULLY block blasts while charged. Cheap at 40cr with 150 HP, plus slow self-repair — hide Generators inside!' },
      { icon: '⚕️', text: 'Shield Healers repair 8/s (up to 65/s) but only ONE shield at a time — always the weakest in range (green beam shows it)!' },
      { icon: '🚀', text: 'Missile Launchers stockpile up to 3 missiles (5s each, ＋ button in the launcher list, or 🤖 Autobuild toggle per launcher). Firing launches the WHOLE volley in quick succession! Single (1 sq) • Scatter (plus) • Cluster (4 bomblets)' },
      { icon: '⬆️', text: 'Tap any building for its stats dialog with exact numbers: upgrade to Level 5, load missiles, or pick a target and FIRE!' },
      { icon: '⏱️', text: 'Buildings take time to construct: 3s → 5s → 10s → 20s → 30s by level. Everything builds in parallel!' },
      { icon: '💥', text: 'Destroy the enemy Core (⭐, 2000 HP + slow regen) to win!' },
      { icon: '🔍', text: 'Drag to pan, wheel/pinch to zoom. Mobile-friendly tap controls.' },
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
      { icon: '🧩', text: '25 tiles on screen starting with the same initial gradient (100 tiles in Extreme 10x10)' },
      { icon: '👁️', text: 'Exactly ONE tile slowly changes its gradient over time — watch closely!' },
      { icon: '⚡', text: 'First player to click the correct changing tile wins the round!' },
      { icon: '⚠️', text: 'Clicking the wrong tile costs 1 point (-1 pt penalty) and round continues' },
      { icon: '⚙️', text: 'Easy (Static grid) | Medium (Floating movement) | Hard (Faster drift + dynamic tile sizes 0.5x-2x)' },
      { icon: '⚖️', text: 'Fair Points mode: Easy wins +1 pt, Medium wins +2 pts, Hard wins +3 pts per round' },
      { icon: '🏆', text: '5 total rounds — highest overall score wins!' },
    ],
  },
  {
    id: 'blend-in',
    name: 'Blend In',
    emoji: '🦎',
    tagline: 'One player is the chameleon — spot the outsider by their words!',
    minPlayers: 3,
    maxPlayers: 12,
    rounds: 5,
    tags: ['Deduction', 'Bluffing', 'Wordplay'],
    accentColor: 'var(--amber-400)',
    bgGradient: 'linear-gradient(135deg, rgba(251,191,36,0.12), rgba(251,113,133,0.06))',
    borderColor: 'rgba(251,191,36,0.35)',
    available: true,
    rules: [
      { icon: '🦎', text: 'One random player is secretly the Chameleon — they see the category but NOT the secret word' },
      { icon: '💬', text: 'Everyone submits one clue word. Innocents hint at the word; the chameleon bluffs to blend in' },
      { icon: '🗳️', text: 'All clues are revealed, then everyone secretly votes for who they think the chameleon is' },
      { icon: '🎯', text: 'Caught the chameleon? Each correct voter scores +1 pt — but the chameleon gets one last guess at the word to steal +2 pts!' },
      { icon: '😎', text: 'Chameleon escapes (wrong accusation or tie)? They score +2 pts and nobody else scores' },
      { icon: '🏆', text: '5 total rounds — highest overall score wins!' },
    ],
  },
  {
    id: 'liar-dice',
    name: "Liar's Dice",
    emoji: '🎲',
    tagline: 'Bluff, bid, and call lies — 2 to 12 players!',
    minPlayers: 2,
    maxPlayers: 12,
    rounds: 5,
    tags: ['Bluffing', 'Dice', '2-12 Players'],
    accentColor: 'var(--green-400)',
    bgGradient: 'linear-gradient(135deg, rgba(74,222,128,0.12), rgba(16,185,129,0.06))',
    borderColor: 'rgba(74,222,128,0.35)',
    available: true,
    rules: [
      { icon: '🎲', text: 'Each player secretly rolls 3 dice (9 in Extreme) — only you see yours' },
      { icon: '📣', text: 'Take turns bidding ("at least three 4s"). Raise quantity or match with higher face' },
      { icon: '🤥', text: "Can't beat it? Call LIAR! All dice revealed — win +1 pt if the bid was false" },
      { icon: '🎯', text: 'Feeling precise? Call EXACT! Win +2 pts if the count matches the bid exactly' },
      { icon: '⚠️', text: 'Wrong call hands the round (+1 pt) to your opponent. Slow play times out the round' },
      { icon: '🔥', text: 'Extreme Mode: 9 dice each (3x dice)! More dice = bigger bluffs, wilder calls' },
      { icon: '🏆', text: '5 total rounds — highest overall score wins!' },
    ],
  },
  {
    id: 'bluff-card',
    name: 'Bluff Card',
    emoji: '🃏',
    tagline: 'Bet, raise, and bluff — Joker beats King!',
    minPlayers: 2,
    maxPlayers: 2,
    rounds: 5,
    tags: ['Duel', 'Bluffing', 'Cards'],
    accentColor: 'var(--rose-400)',
    bgGradient: 'linear-gradient(135deg, rgba(239,68,68,0.12), rgba(127,29,29,0.06))',
    borderColor: 'rgba(239,68,68,0.35)',
    available: true,
    rules: [
      { icon: '🃏', text: 'Deck: Joker (beats King) · J · Q · K — one hidden card each' },
      { icon: '🙈', text: 'Check, Bet, Raise, Call, or Fold — round ends only on Fold or Call' },
      { icon: '💰', text: 'Showdown: best card wins (+1 pt), Joker beats King but loses to Q/J' },
      { icon: '😎', text: 'Bluff with a Jack → opponent folds = +2 pts bonus!' },
      { icon: '🔥', text: 'Raise the stakes! Re-raise allowed after a bet' },
      { icon: '🏆', text: '5 rounds — highest score wins!' },
    ],
  },
  {
    id: 'territory-push',
    name: 'Territory Push',
    emoji: '⚔️',
    tagline: 'Tactical 10x10 territory push for even player teams!',
    minPlayers: 2,
    maxPlayers: 12,
    rounds: 20,
    tags: ['Even Players', 'Simultaneous', 'Tactical'],
    accentColor: 'var(--rose-400)',
    bgGradient: 'linear-gradient(135deg, rgba(244,63,94,0.12), rgba(225,29,72,0.06))',
    borderColor: 'rgba(244,63,94,0.35)',
    available: true,
    rules: [
      { icon: '👥', text: 'Requires an EVEN number of players (2, 4, 6, 8...). Players are randomly split into Team Red (Top) and Team Blue (Bottom)' },
      { icon: '🗺️', text: '10x10 Grid: Goal is to push your team\'s territory to the opponent\'s back row (Row 9 for Red, Row 0 for Blue)' },
      { icon: '🔒', text: 'Simultaneous Turns: Each player secretly selects 1 column to push. Choices are hidden until all players locked in' },
      { icon: '⚡', text: 'Team Stacking: Multiple teammates picking the same column multiply your push force!' },
      { icon: '🛡️', text: 'Defender Advantage: Clashes in your home half give your team +2 Defender Bonus force to repel invaders!' },
      { icon: '⚖️', text: 'Center Clash: Equal opposing picks at center cancel out with no movement' },
      { icon: '🔥', text: 'Host Extreme Mode: Double-height 10x20 board + Real-time energy charging with 8 randomized booster squares (+10% team recharge speed each) & instant firing!' },
      { icon: '🏆', text: 'First team to reach the opposing last row wins!' },
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
