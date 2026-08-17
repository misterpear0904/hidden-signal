// Shared game types for Hidden Signal

export type GamePhase =
  | 'lobby'
  | 'role-reveal'
  | 'signal'
  | 'discuss'
  | 'guess'
  | 'reveal'
  | 'end'
  | 'chroma-play'
  | 'chroma-reveal'
  | 'territory-turn'
  | 'territory-reveal';

export interface ChromaOptions {
  difficulty: 'easy' | 'medium' | 'hard';
  playerDifficulties: Record<string, 'easy' | 'medium' | 'hard'>;
  fairPoints: boolean;
  extremeMode: boolean;
}

export interface TerritoryOptions {
  extremeMode: boolean;
}

export interface TerritoryShotEvent {
  id: string;
  playerId: string;
  playerName: string;
  team: 'red' | 'blue';
  col: number;
  timestamp: number;
  delta: number;
}

export interface ChromaRoundState {
  targetTileIndex: number;
  baseGradient: [string, string];
  targetGradient: [string, string];
  roundWinnerId: string | null;
  roundWinnerName: string | null;
  pointsAwarded: number;
  shiftDurationSec: number;
  seed: number;
}

export interface TerritoryColumnResolution {
  col: number;
  redPicks: string[];   // player names
  bluePicks: string[];  // player names
  oldFrontier: number;
  newFrontier: number;
  defenderAdvantageApplied: 'red' | 'blue' | null;
  clashResult: string;  // descriptive message
}

export interface TerritoryGameState {
  teams: {
    red: string[];  // player IDs
    blue: string[]; // player IDs
  };
  board: number[]; // 10 elements: frontier row index for Red (0 to 9 or 0 to 19).
  extremeMode?: boolean;
  boardHeight?: number; // 10 or 20
  energy?: Record<string, { shots: number; nextChargeTime: number | null; lastChargeMs: number }>;
  recentShots?: TerritoryShotEvent[];
  submittedPicks: Record<string, number>; // playerId -> col (0..9)
  lastResolutions: TerritoryColumnResolution[] | null;
  turnHistory: Array<{ turn: number; resolutions: TerritoryColumnResolution[] }>;
  winnerTeam: 'red' | 'blue' | null;
  turn: number;
}

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
  selectedGameId: string;
  chromaOptions: ChromaOptions;
  territoryOptions?: TerritoryOptions;
  chromaState: ChromaRoundState | null;
  territoryState: TerritoryGameState | null;
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
