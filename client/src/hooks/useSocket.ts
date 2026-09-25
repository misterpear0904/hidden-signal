import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { RoomState, RoleData, RoundRevealData, ChromaOptions, TerritoryOptions } from '../types/game';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export type GuessData =
  | { guessedPartnerId: string }
  | { guessedPlayerId: string };

export interface SocketHookReturn {
  socket: Socket | null;
  connected: boolean;
  connectError: string | null;
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
  setPlayerDifficulty: (roomCode: string, difficulty: 'easy' | 'medium' | 'hard') => void;
  submitChromaGuess: (roomCode: string, tileIndex: number) => void;
  nextChromaRound: (roomCode: string) => void;
  submitTerritoryPick: (roomCode: string, colIndex: number) => void;
  placeTerritoryMine: (roomCode: string, row: number, col: number) => void;
  nextTerritoryTurn: (roomCode: string) => void;
  submitSignal: (roomCode: string, signal: string) => void;
  submitGuess: (roomCode: string, guessData: GuessData) => void;
  kickPlayer: (roomCode: string, targetId: string) => void;
  nextRound: (roomCode: string) => void;
  playAgain: (roomCode: string) => void;
}

export function useSocket(): SocketHookReturn {
  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [myId, setMyId] = useState<string>('');
  const [roomCode, setRoomCode] = useState<string>('');
  const [inRoom, setInRoom] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [myRole, setMyRole] = useState<RoleData | null>(null);
  const [roundReveal, setRoundReveal] = useState<RoundRevealData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = io(SERVER_URL, { autoConnect: true });
    socketRef.current = s;
    setSocket(s);

    const onConnect = () => { setConnected(true); setConnectError(null); };
    const onDisconnect = () => {
      setConnected(false);
      // Clear stale room UI so user isn't stuck in a dead game
      setInRoom(false);
      setRoomState(null);
      setMyRole(null);
      setRoundReveal(null);
    };
    const onConnectError = (err: Error) => setConnectError(err?.message ?? 'Connection failed');
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

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', onConnectError);
    s.on('room-joined', onRoomJoined);
    s.on('room-state', onRoomState);
    s.on('your-role', onRole);
    s.on('round-reveal', onReveal);
    s.on('error', onError);
    s.on('kicked', onKicked);

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('connect_error', onConnectError);
      s.off('room-joined', onRoomJoined);
      s.off('room-state', onRoomState);
      s.off('your-role', onRole);
      s.off('round-reveal', onReveal);
      s.off('error', onError);
      s.off('kicked', onKicked);
      s.disconnect();
      socketRef.current = null;
    };
  }, []);

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

  return {
    socket,
    connected,
    connectError,
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
    setPlayerDifficulty,
    submitChromaGuess,
    nextChromaRound,
    submitTerritoryPick,
    placeTerritoryMine,
    nextTerritoryTurn,
    submitSignal,
    submitGuess,
    kickPlayer,
    nextRound,
    playAgain,
  };
}
