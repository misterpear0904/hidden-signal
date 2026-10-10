import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { RoomState, RoleData, RoundRevealData, ChromaOptions, TerritoryOptions, LiarOptions, BluffAction, MissileBuildAction, MissileUpgradeAction, MissileLaunchAction, MissileLoadAction, MissileCommandOptions } from '../types/game';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export type GuessData =
  | { guessedPartnerId: string }
  | { guessedPlayerId: string };

export type ConnectionStatus = 
  | 'disconnected' 
  | 'connecting' 
  | 'connected' 
  | 'reconnecting' 
  | 'server_sleeping' 
  | 'failed';

export interface SocketHookReturn {
  socket: Socket | null;
  connected: boolean;
  connectionStatus: ConnectionStatus;
  connectError: string | null;
  retryCount: number;
  myId: string;
  roomCode: string;
  inRoom: boolean;
  roomState: RoomState | null;
  myRole: RoleData | null;
  roundReveal: RoundRevealData | null;
  error: string | null;
  clearError: () => void;
  createRoom: (playerName: string) => void;
  joinRoom: (roomCode: string, playerName: string) => void;
  startGame: (roomCode: string) => void;
  selectGame: (roomCode: string, gameId: string) => void;
  updateChromaOptions: (roomCode: string, options: Partial<ChromaOptions>) => void;
  updateTerritoryOptions: (roomCode: string, options: Partial<TerritoryOptions>) => void;
  updateLiarOptions: (roomCode: string, options: Partial<LiarOptions>) => void;
  setPlayerDifficulty: (roomCode: string, difficulty: 'easy' | 'medium' | 'hard') => void;
  submitChromaGuess: (roomCode: string, tileIndex: number) => void;
  nextChromaRound: (roomCode: string) => void;
  submitTerritoryPick: (roomCode: string, colIndex: number) => void;
  placeTerritoryMine: (roomCode: string, row: number, col: number) => void;
  nextTerritoryTurn: (roomCode: string) => void;
  submitSignal: (roomCode: string, signal: string) => void;
  submitGuess: (roomCode: string, guessData: GuessData) => void;
  kickPlayer: (roomCode: string, targetId: string) => void;
  requestEndVote: (roomCode: string) => void;
  submitEndVote: (roomCode: string, agree: boolean) => void;
  cancelEndVote: (roomCode: string) => void;
  submitBlendClue: (roomCode: string, word: string) => void;
  submitBlendVote: (roomCode: string, targetId: string) => void;
  submitBlendGuess: (roomCode: string, guess: string) => void;
  nextBlendRound: (roomCode: string) => void;
  submitLiarBid: (roomCode: string, qty: number, face: number) => void;
  submitLiarCall: (roomCode: string, kind: 'liar' | 'exact') => void;
  nextLiarRound: (roomCode: string) => void;
  submitBluffAction: (roomCode: string, action: BluffAction) => void;
  nextBluffRound: (roomCode: string) => void;
  nextRound: (roomCode: string) => void;
  playAgain: (roomCode: string) => void;
  retryConnection: () => void;
  // Missile Command
  buildMissileBuilding: (roomCode: string, action: MissileBuildAction) => void;
  upgradeMissileBuilding: (roomCode: string, action: MissileUpgradeAction) => void;
  loadMissile: (roomCode: string, action: MissileLoadAction) => void;
  launchMissile: (roomCode: string, action: MissileLaunchAction) => void;
  updateMissileCommandOptions: (roomCode: string, options: Partial<MissileCommandOptions>) => void;
}

export function useSocket(): SocketHookReturn {
  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [myId, setMyId] = useState<string>('');
  const [roomCode, setRoomCode] = useState<string>('');
  const roomCodeRef = useRef<string>('');
  const [inRoom, setInRoom] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [myRole, setMyRole] = useState<RoleData | null>(null);
  const [roundReveal, setRoundReveal] = useState<RoundRevealData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reconnectingRef = useRef(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverSleepingRef = useRef(false);

  // Keep roomCodeRef in sync with roomCode
  useEffect(() => {
    roomCodeRef.current = roomCode;
  }, [roomCode]);

  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const updateConnectionStatus = useCallback((status: ConnectionStatus) => {
    setConnectionStatus(status);
    if (status === 'connected') {
      setConnected(true);
      setConnectError(null);
      setRetryCount(0);
      serverSleepingRef.current = false;
    } else if (status === 'connecting' || status === 'reconnecting') {
      setConnected(false);
    } else if (status === 'server_sleeping') {
      setConnected(false);
    } else if (status === 'failed') {
      setConnected(false);
    } else {
      setConnected(false);
    }
  }, []);

  const handleServerSleeping = useCallback(() => {
    serverSleepingRef.current = true;
    setConnectionStatus('server_sleeping');
    setConnectError('Server is waking up... This may take up to 60 seconds on free tier hosting.');
  }, []);

  const handleConnectionFailure = useCallback((reason?: string) => {
    if (serverSleepingRef.current) return; // Don't override sleeping status
    setConnectionStatus('failed');
    const msg = reason || 'Unable to connect to server. The server may be sleeping (free tier spins down after inactivity).';
    setConnectError(msg);
  }, []);

  const retryConnection = useCallback(() => {
    clearRetryTimeout();
    const s = socketRef.current;
    if (!s) return;
    
    setRetryCount(prev => prev + 1);
    setConnectionStatus('reconnecting');
    setConnectError('Reconnecting...');
    console.log('[socket] manual retry attempt', { retryCount: retryCount + 1 });
    
    // Force a new connection attempt
    s.connect();
  }, [clearRetryTimeout]);

  useEffect(() => {
    const s = io(SERVER_URL, { 
      autoConnect: true, 
      reconnection: true, 
      reconnectionAttempts: 20, 
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      timeout: 30000,
      transports: ['polling', 'websocket']
    });
    socketRef.current = s;
    setSocket(s);

    setConnectionStatus('connecting');
    setConnectError('Connecting to server...');
    console.log('[socket] connecting to', SERVER_URL);

    const onConnect = () => { 
      setConnected(true); 
      setConnectError(null);
      setConnectionStatus('connected');
      setRetryCount(0);
      serverSleepingRef.current = false;
      console.log('[socket] connected, id:', s.id);
      if (reconnectingRef.current) {
        reconnectingRef.current = false;
        // Request fresh room state on reconnect
        if (roomCodeRef.current) {
          s.emit('room-state-request', { roomCode: roomCodeRef.current });
        }
      }
    };
    const onDisconnect = (reason: string) => {
      setConnected(false);
      reconnectingRef.current = true;
      console.log('[socket] disconnected:', reason);
      if (reason === 'io server disconnect') {
        // Server intentionally disconnected us
        setConnectionStatus('failed');
        setConnectError('Disconnected by server. Please refresh the page.');
      } else if (reason === 'ping timeout' || reason === 'transport close') {
        // Network issue or server sleeping
        setConnectionStatus('reconnecting');
        setConnectError('Connection lost. Reconnecting...');
      } else if (reason === 'io client disconnect') {
        // User intentionally disconnected
        setConnectionStatus('disconnected');
        setInRoom(false);
        setRoomState(null);
        setMyRole(null);
        setRoundReveal(null);
      } else {
        setConnectionStatus('reconnecting');
        setConnectError(`Disconnected: ${reason}. Reconnecting...`);
      }
    };
    const onConnectError = (err: Error) => {
      const msg = err?.message ?? 'Connection failed';
      console.log('[socket] connect_error:', msg);
      if (msg.includes('503') || msg.includes('Service Unavailable')) {
        handleServerSleeping();
      } else if (msg.includes('429') || msg.includes('Too Many Requests')) {
        setConnectError('Server is busy (too many requests). Waiting 10s before retry...');
        setConnectionStatus('failed');
        // Auto-retry after 10 seconds for 429
        setTimeout(() => {
          if (socketRef.current) {
            setRetryCount(prev => prev + 1);
            setConnectionStatus('reconnecting');
            socketRef.current?.connect();
          }
        }, 10000);
      } else {
        handleConnectionFailure(msg);
      }
    };
    const onRoomJoined = ({ roomCode: code, playerId }: { roomCode: string; playerId: string }) => {
      setMyId(playerId);
      setRoomCode(code);
      setInRoom(true);
    };
    const onRoomState = (state: RoomState) => {
      setRoomState(state);
      // Clear reveal when moving to a new round's role-reveal phase
      if (state.phase === 'role-reveal') {
        setRoundReveal(null);
        setMyRole(null);
      }
    };
    const onRole = (role: RoleData) => setMyRole(role);
    const onReveal = (data: RoundRevealData) => setRoundReveal(data);
    const onError = (msg: unknown) => {
      setError(typeof msg === 'string' ? msg : (msg as { message?: string })?.message ?? JSON.stringify(msg));
    };
    const onKicked = ({ roomCode: code }: { roomCode: string }) => {
      setInRoom(false);
      setRoomState(null);
      setMyRole(null);
      setRoundReveal(null);
      setRoomCode(code ?? '');
      setError('You were kicked from the lobby by the host');
    };
    const onEndVoteFailed = ({ declinedBy }: { declinedBy: string }) => {
      setError(`${declinedBy} voted to keep playing — end-game vote failed`);
    };

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', onConnectError);
    s.on('room-joined', onRoomJoined);
    s.on('room-state', onRoomState);
    s.on('your-role', onRole);
    s.on('round-reveal', onReveal);
    s.on('error', onError);
    s.on('kicked', onKicked);
    s.on('end-vote-failed', onEndVoteFailed);

    return () => {
      clearRetryTimeout();
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('connect_error', onConnectError);
      s.off('room-joined', onRoomJoined);
      s.off('room-state', onRoomState);
      s.off('your-role', onRole);
      s.off('round-reveal', onReveal);
      s.off('error', onError);
      s.off('kicked', onKicked);
      s.off('end-vote-failed', onEndVoteFailed);
      s.disconnect();
      socketRef.current = null;
    };
  }, [handleServerSleeping, handleConnectionFailure, clearRetryTimeout]);

  const clearError = useCallback(() => setError(null), []);

  const createRoom = useCallback((playerName: string) => {
    socketRef.current?.emit('create-room', { playerName });
  }, []);

  const joinRoom = useCallback((code: string, playerName: string) => {
    socketRef.current?.emit('join-room', { roomCode: code, playerName });
  }, []);

  const startGame = useCallback((code: string) => {
    socketRef.current?.emit('start-game', { roomCode: code });
  }, []);

  const submitSignal = useCallback((code: string, signal: string) => {
    socketRef.current?.emit('submit-signal', { roomCode: code, signal });
  }, []);

  const submitGuess = useCallback((code: string, guessData: GuessData) => {
    socketRef.current?.emit('submit-guess', { roomCode: code, guessData });
  }, []);

  const nextRound = useCallback((code: string) => {
    socketRef.current?.emit('next-round', { roomCode: code });
  }, []);

  const playAgain = useCallback((code: string) => {
    socketRef.current?.emit('play-again', { roomCode: code });
  }, []);

  const selectGame = useCallback((code: string, gameId: string) => {
    socketRef.current?.emit('select-game', { roomCode: code, gameId });
  }, []);

  const updateChromaOptions = useCallback((code: string, options: Partial<ChromaOptions>) => {
    socketRef.current?.emit('update-chroma-options', { roomCode: code, options });
  }, []);

  const updateTerritoryOptions = useCallback((code: string, options: Partial<TerritoryOptions>) => {
    socketRef.current?.emit('update-territory-options', { roomCode: code, options });
  }, []);

  const updateLiarOptions = useCallback((code: string, options: Partial<LiarOptions>) => {
    socketRef.current?.emit('update-liar-options', { roomCode: code, options });
  }, []);

  const setPlayerDifficulty = useCallback((code: string, difficulty: 'easy' | 'medium' | 'hard') => {
    socketRef.current?.emit('set-player-difficulty', { roomCode: code, difficulty });
  }, []);

  const submitChromaGuess = useCallback((code: string, tileIndex: number) => {
    socketRef.current?.emit('submit-chroma-guess', { roomCode: code, tileIndex });
  }, []);

  const nextChromaRound = useCallback((code: string) => {
    socketRef.current?.emit('next-chroma-round', { roomCode: code });
  }, []);

  const submitTerritoryPick = useCallback((code: string, colIndex: number) => {
    socketRef.current?.emit('submit-territory-pick', { roomCode: code, colIndex });
  }, []);

  const placeTerritoryMine = useCallback((code: string, row: number, col: number) => {
    socketRef.current?.emit('place-territory-mine', { roomCode: code, row, col });
  }, []);

  const nextTerritoryTurn = useCallback((code: string) => {
    socketRef.current?.emit('next-territory-turn', { roomCode: code });
  }, []);

  const kickPlayer = useCallback((code: string, targetId: string) => {
    socketRef.current?.emit('kick-player', { roomCode: code, targetId });
  }, []);

  const requestEndVote = useCallback((code: string) => {
    socketRef.current?.emit('request-end-vote', { roomCode: code });
  }, []);

  const submitEndVote = useCallback((code: string, agree: boolean) => {
    socketRef.current?.emit('submit-end-vote', { roomCode: code, agree });
  }, []);

  const cancelEndVote = useCallback((code: string) => {
    socketRef.current?.emit('cancel-end-vote', { roomCode: code });
  }, []);

  const submitBlendClue = useCallback((code: string, word: string) => {
    socketRef.current?.emit('submit-blend-clue', { roomCode: code, word });
  }, []);

  const submitBlendVote = useCallback((code: string, targetId: string) => {
    socketRef.current?.emit('submit-blend-vote', { roomCode: code, targetId });
  }, []);

  const submitBlendGuess = useCallback((code: string, guess: string) => {
    socketRef.current?.emit('submit-blend-guess', { roomCode: code, guess });
  }, []);

  const nextBlendRound = useCallback((code: string) => {
    socketRef.current?.emit('next-blend-round', { roomCode: code });
  }, []);

  const submitLiarBid = useCallback((code: string, qty: number, face: number) => {
    socketRef.current?.emit('submit-liar-bid', { roomCode: code, qty, face });
  }, []);

  const submitLiarCall = useCallback((code: string, kind: 'liar' | 'exact') => {
    socketRef.current?.emit('submit-liar-call', { roomCode: code, kind });
  }, []);

  const nextLiarRound = useCallback((code: string) => {
    socketRef.current?.emit('next-liar-round', { roomCode: code });
  }, []);

  const submitBluffAction = useCallback((code: string, action: BluffAction) => {
    socketRef.current?.emit('submit-bluff-action', { roomCode: code, action });
  }, []);

  const nextBluffRound = useCallback((code: string) => {
    socketRef.current?.emit('next-bluff-round', { roomCode: code });
  }, []);

  // Missile Command
  const buildMissileBuilding = useCallback((code: string, action: MissileBuildAction) => {
    socketRef.current?.emit('build-missile-building', { roomCode: code, action });
  }, []);

  const upgradeMissileBuilding = useCallback((code: string, action: MissileUpgradeAction) => {
    socketRef.current?.emit('upgrade-missile-building', { roomCode: code, action });
  }, []);

  const launchMissile = useCallback((code: string, action: MissileLaunchAction) => {
    socketRef.current?.emit('launch-missile', { roomCode: code, action });
  }, []);

  const loadMissile = useCallback((code: string, action: MissileLoadAction) => {
    socketRef.current?.emit('load-missile', { roomCode: code, launcherId: action.launcherId });
  }, []);

  const updateMissileCommandOptions = useCallback((code: string, options: Partial<MissileCommandOptions>) => {
    socketRef.current?.emit('update-missile-command-options', { roomCode: code, options });
  }, []);

  return {
    socket,
    connected,
    connectionStatus,
    connectError,
    retryCount,
    myId,
    roomCode,
    inRoom,
    roomState,
    myRole,
    roundReveal,
    error,
    clearError,
    createRoom,
    joinRoom,
    startGame,
    selectGame,
    updateChromaOptions,
    updateTerritoryOptions,
    updateLiarOptions,
    setPlayerDifficulty,
    submitChromaGuess,
    nextChromaRound,
    submitTerritoryPick,
    placeTerritoryMine,
    nextTerritoryTurn,
    submitSignal,
    submitGuess,
    kickPlayer,
    requestEndVote,
    submitEndVote,
    cancelEndVote,
    submitBlendClue,
    submitBlendVote,
    submitBlendGuess,
    nextBlendRound,
    submitLiarBid,
    submitLiarCall,
    nextLiarRound,
    submitBluffAction,
    nextBluffRound,
    nextRound,
    playAgain,
    retryConnection,
    // Missile Command
    buildMissileBuilding,
    upgradeMissileBuilding,
    loadMissile,
    launchMissile,
    updateMissileCommandOptions,
  };
}
