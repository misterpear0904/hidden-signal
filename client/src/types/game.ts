// Shared game types for Hidden Signal

export type GamePhase =
  | 'lobby'
  | 'role-reveal'
  | 'signal'
  | 'discuss'
  | 'guess'
  | 'reveal'
  | 'end';

export interface Player {
  id: string;
  name: string;
  score: number;
  isHost: boolean;
  connected: boolean;
}

export interface RoleData {
  playerId: string;
  role: 'hidden' | 'neutral';
  secretCode: string | null;
}

export interface Signal {
  playerId: string;
  signal?: string;
  submitted?: boolean; // during signal phase, only submitted flag is shown
}

export interface Guess {
  playerId: string;
  guessedPartnerId?: string;       // for hidden pair
  guessedPlayerId?: string;        // for neutral players (single pick)
}

export interface RoomState {
  code: string;
  phase: GamePhase;
  round: number;
  players: Player[];
  signals: Signal[];
  guesses: Guess[];
  hiddenPairIds: string[];
  secretCode: string | null;
  timerEnd: number | null;
  submittedSignalCount: number;
  submittedGuessCount: number;
  totalPlayers: number;
}

export interface RoundRevealData {
  hiddenPairIds: string[];
  secretCode: string;
  roles: RoleData[];
  signals: Signal[];
  guesses: Guess[];
  scoreDeltas: Record<string, number>;
  players: Player[];
}
