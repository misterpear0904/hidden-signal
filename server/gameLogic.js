// gameLogic.js — Pure functions for role assignment and scoring

const SECRET_CODES = [
  '0','1','2','3','4','5','6','7','8','9',
  'A','B','C','D','E','F','G','H','J','K',
  'L','M','N','P','Q','R','S','T','U','V',
  'W','X','Y','Z'
];

/**
 * Assigns roles to players for a round.
 * Returns an array of player role objects.
 */
export function assignRoles(players) {
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  const secretCode = SECRET_CODES[Math.floor(Math.random() * SECRET_CODES.length)];

  const hiddenPairIds = [shuffled[0].id, shuffled[1].id];

  const roles = players.map(p => ({
    playerId: p.id,
    role: hiddenPairIds.includes(p.id) ? 'hidden' : 'neutral',
    secretCode: hiddenPairIds.includes(p.id) ? secretCode : null,
  }));

  return { roles, hiddenPairIds, secretCode };
}

/**
 * Calculates score deltas for a round.
 * @param {Array} guesses - [{playerId, guessedId}] for neutral, [{playerId, guessedPartnerId}] for hidden
 * @param {string[]} hiddenPairIds - IDs of the two hidden pair members
 * @param {Map} roleMap - playerId -> role ('hidden' | 'neutral')
 * @returns {Map} playerId -> points earned this round
 */
export function calculateScores(guesses, hiddenPairIds, roleMap) {
  const scores = new Map();

  for (const guess of guesses) {
    const role = roleMap.get(guess.playerId);

    if (role === 'hidden') {
      // Hidden pair: earn 2 points if they correctly guessed their partner, lose 1 point if wrong
      const partner = hiddenPairIds.find(id => id !== guess.playerId);
      if (guess.guessedPartnerId === partner) {
        scores.set(guess.playerId, (scores.get(guess.playerId) || 0) + 2);
      } else if (guess.guessedPartnerId) {
        scores.set(guess.playerId, (scores.get(guess.playerId) || 0) - 1);
      } else {
        scores.set(guess.playerId, scores.get(guess.playerId) || 0);
      }
    } else if (role === 'neutral') {
      // Neutral: +1 point per correct hidden pair member, -1 point per incorrect pick
      const correctIds = new Set(hiddenPairIds);
      const guessedIds = new Set(guess.guessedPairIds || []);
      let pts = 0;
      for (const id of guessedIds) {
        if (correctIds.has(id)) {
          pts += 1;
        } else {
          pts -= 1;
        }
      }
      scores.set(guess.playerId, (scores.get(guess.playerId) || 0) + pts);
    }
  }

  return scores;
}

export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
