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
  | 'territory-reveal'
  | 'blend-word'
  | 'blend-vote'
  | 'blend-guess'
  | 'blend-reveal'
  | 'liar-bid'
  | 'liar-reveal'
  | 'bluff-bet'
  | 'bluff-reveal';

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

export interface ChromaSolver {
  playerId: string;
  playerName: string;
  points: number;
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
  // 10s race after first finder: others can solve for half points
  raceEndAt: number | null;
  firstFinderId: string | null;
  firstFinderName: string | null;
  firstFinderPoints: number;
  solvers: ChromaSolver[];
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

export interface TerritoryBonusSquare {
  row: number;
  col: number;
  initialTeam: 'red' | 'blue';
}

export interface TerritoryMine {
  playerId: string;
  playerName: string;
  team: 'red' | 'blue';
  row: number;
  col: number;
  placedAt: number;
}

export interface TerritoryMineExplosion {
  id: string;
  minePlayerId: string;
  minePlayerName: string;
  team: 'red' | 'blue';
  row: number;
  col: number;
  timestamp: number;
  affectedCols: number[];
  destroyedMines?: Array<{ playerId: string; playerName: string; team: 'red' | 'blue'; row: number; col: number }>;
  message: string;
}

export interface TerritoryGameState {
  teams: {
    red: string[];  // player IDs
    blue: string[]; // player IDs
  };
  board: number[]; // 10 elements: frontier row index for Red (0 to 9 or 0 to 19).
  extremeMode?: boolean;
  boardHeight?: number; // 10 or 20
  bonusSquares?: TerritoryBonusSquare[];
  mines?: Record<string, TerritoryMine>; // playerId -> mine
  recentExplosions?: TerritoryMineExplosion[];
  energy?: Record<string, { shots: number; nextChargeTime: number | null; lastChargeMs: number; chargeIntervalMs?: number }>;
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

export interface EndVoteState {
  initiatorId: string;
  initiatorName: string;
  yesIds: string[];                // players who agreed (initiator auto-yes)
  startedAt: number;
}

export interface BlendClue {
  playerId: string;
  word?: string;                   // hidden during word phase (submitted flag only)
}

export interface BlendVote {
  playerId: string;
  targetId: string;
}

export interface BlendGameState {
  category: string;
  secretWord: string | null;       // null for the chameleon until reveal
  amChameleon: boolean;
  chameleonId: string | null;      // null until reveal
  chameleonName: string | null;    // null until reveal
  clues: BlendClue[];
  clueCount: number;
  votes: BlendVote[];              // only at reveal
  voteCount: number;
  accusedId: string | null;        // public once voting resolves
  caught: boolean | null;
  chameleonGuess: string | null;   // only at reveal
  stealSuccess: boolean | null;    // only at reveal
  points: Record<string, number>;  // only at reveal
}

export interface LiarBid {
  playerId: string;
  playerName: string;
  qty: number;
  face: number;
}

export interface LiarGameState {
  dice: Record<string, number[]>;  // only your own hand until reveal
  diceEach: number;
  bids: LiarBid[];
  toActId: string | null;
  starterId: string | null;
  winnerId: string | null;         // only at reveal
  winnerName: string | null;       // only at reveal
  loserId: string | null;          // only at reveal
  reason: 'liar' | 'exact' | 'timeout' | null;  // only at reveal
  challengedBid: { qty: number; face: number; bidderId: string } | null;
  actualCount: number | null;      // only at reveal
  points: Record<string, number>;  // only at reveal
}

export type BluffAction = 'check' | 'bet' | 'call' | 'fold';

export interface BluffHistoryEntry {
  playerId: string;
  playerName: string;
  action: BluffAction;
}

export interface BluffGameState {
  cards: Record<string, 'J' | 'Q' | 'K'>;  // only your own card until reveal
  firstId: string | null;
  history: BluffHistoryEntry[];
  toActId: string | null;
  facingBet: boolean;
  winnerId: string | null;         // only at reveal
  winnerName: string | null;       // only at reveal
  loserId: string | null;          // only at reveal
  reason: 'showdown' | 'fold' | 'timeout' | null;  // only at reveal
  bluffWin: boolean;
  showdownCards: Record<string, 'J' | 'Q' | 'K'> | null;  // only at reveal
  points: Record<string, number>;  // only at reveal
}

export interface RoomState {
  code: string;
  selectedGameId: string;
  chromaOptions: ChromaOptions;
  territoryOptions?: TerritoryOptions;
  chromaState: ChromaRoundState | null;
  territoryState: TerritoryGameState | null;
  blendState: BlendGameState | null;
  liarState: LiarGameState | null;
  bluffState: BluffGameState | null;
  phase: GamePhase;
  round: number;
  players: Player[];
  signals: Signal[];
  guesses: Guess[];
  hiddenPairIds: string[];
  secretCode: string | null;
  timerEnd: number | null;
  endVote: EndVoteState | null;
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
