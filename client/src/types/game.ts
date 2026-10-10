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
  | 'bluff-reveal'
  | 'missile-command-build'
  | 'missile-command-play'
  | 'missile-command-end';

export interface ChromaOptions {
  difficulty: 'easy' | 'medium' | 'hard';
  playerDifficulties: Record<string, 'easy' | 'medium' | 'hard'>;
  fairPoints: boolean;
  extremeMode: boolean;
}

export interface TerritoryOptions {
  extremeMode: boolean;
}

export interface LiarOptions {
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

// ─── Missile Command Types ────────────────────────────────

export type MissileBuildingType = 'economy' | 'shield' | 'healer' | 'launcher' | 'core';
export type MissileLauncherType = 'single' | 'scatter' | 'cluster';
export type PlayerSide = 'top' | 'bottom';

export interface MissileBuilding {
  id: string;
  type: MissileBuildingType;
  side: PlayerSide;
  gx: number;       // grid column 0..gridCols-1
  gy: number;       // grid row 0..gridRows-1
  level: number;    // 1-5
  ownerId: string;  // player ID
  hp?: number;
  maxHp?: number;
  
  // Economy building
  incomePerSec?: number;
  
  // Shield generator (square coverage: shieldTiles Chebyshev distance)
  shieldHp?: number;
  maxShieldHp?: number;
  
  // Healer (Manhattan coverage: healerTiles range, one shield at a time)
  healPerSec?: number;
  healTargetId?: string | null;
  
  // Launcher (bankable stockpile, max 3 — firing launches the whole volley)
  launcherType?: MissileLauncherType;
  missileCost?: number;
  missileDamage?: number;
  blast?: number; // blast tiles (Manhattan radius)
  missileSpeed?: number;
  stock?: number;
  maxStock?: number;
  cooldownMs?: number;
  lastFiredAt?: number;
  
  // Core
  coreHp?: number;
  maxCoreHp?: number;
  coreRegenPerSec?: number;
}

export interface MissileInFlight {
  id: string;
  ownerId: string;
  launcherId: string;
  launcherType: MissileLauncherType;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  targetGx: number;
  targetGy: number;
  currentX: number;
  currentY: number;
  damage: number;
  blast: number;
  speed: number; // normalized units per second
  createdAt: number;
  deployAt?: number; // volley stagger — missile holds at launcher until this time
  // For cluster missiles
  subMissiles?: Array<{ gx: number; gy: number; x: number; y: number; damage: number }>;
}

export interface MissileCommandState {
  sides: { top: string; bottom: string };
  gridCols: number;
  gridRows: number;
  shieldTiles: number;
  healerTiles: number;
  coreIncomePerSec?: number;
  buildings: Record<string, MissileBuilding>;
  missiles: MissileInFlight[];
  resources: Record<string, number>;
  gameStartTime: number;
  lastEconomyTick: number;
  winnerId: string | null;
  winReason: 'core_destroyed' | 'timeout' | null;
}

export interface MissileBuildAction {
  buildingType: MissileBuildingType;
  launcherType?: MissileLauncherType;
  gx: number;
  gy: number;
}

export interface MissileUpgradeAction {
  buildingId: string;
}

export interface MissileLaunchAction {
  launcherId: string;
  targetGx: number;
  targetGy: number;
}

export interface MissileLoadAction {
  launcherId: string;
}

export interface MissileCommandOptions {
  startingResources: number;
  economyTickMs: number;
  maxLevel: number;
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

export type BluffAction = 'check' | 'bet' | 'raise' | 'call' | 'fold';

export interface BluffHistoryEntry {
  playerId: string;
  playerName: string;
  action: BluffAction;
}

export interface BluffGameState {
  cards: Record<string, 'Joker' | 'J' | 'Q' | 'K'>;  // only your own card until reveal
  firstId: string | null;
  history: BluffHistoryEntry[];
  toActId: string | null;
  facingBet: boolean;
  winnerId: string | null;         // only at reveal
  winnerName: string | null;       // only at reveal
  loserId: string | null;          // only at reveal
  reason: 'showdown' | 'fold' | 'timeout' | null;  // only at reveal
  bluffWin: boolean;
  showdownCards: Record<string, 'Joker' | 'J' | 'Q' | 'K'> | null;  // only at reveal
  points: Record<string, number>;  // only at reveal
}

export interface RoomState {
  code: string;
  selectedGameId: string;
  chromaOptions: ChromaOptions;
  territoryOptions?: TerritoryOptions;
  liarOptions?: LiarOptions;
  chromaState: ChromaRoundState | null;
  territoryState: TerritoryGameState | null;
  blendState: BlendGameState | null;
  liarState: LiarGameState | null;
  bluffState: BluffGameState | null;
  missileCommandState: MissileCommandState | null;
  missileCommandOptions: MissileCommandOptions;
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
