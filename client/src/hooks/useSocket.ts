import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { RoomState, RoleData, RoundRevealData } from '../types/game';

const SERVER_URL = 'http://localhost:3001';

export interface SocketHookReturn {
  socket: Socket | null;
  connected: boolean;
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
  submitSignal: (roomCode: string, signal: string) => void;
  submitGuess: (roomCode: string, guessData: object) => void;
  nextRound: (roomCode: string) => void;
  playAgain: (roomCode: string) => void;
}

export function useSocket(): SocketHookReturn {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [myId, setMyId] = useState<string>('');
  const [roomCode, setRoomCode] = useState<string>('');
  const [inRoom, setInRoom] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [myRole, setMyRole] = useState<RoleData | null>(null);
  const [roundReveal, setRoundReveal] = useState<RoundRevealData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const socket = io(SERVER_URL, { autoConnect: true });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('room-joined', ({ roomCode: code, playerId }: { roomCode: string; playerId: string }) => {
      setMyId(playerId);
      setRoomCode(code);
      setInRoom(true);
    });

    socket.on('room-state', (state: RoomState) => {
      setRoomState(state);
      // Clear reveal when moving to a new round's role-reveal phase
      if (state.phase === 'role-reveal') {
        setRoundReveal(null);
        setMyRole(null);
      }
    });

    socket.on('your-role', (role: RoleData) => {
      setMyRole(role);
    });

    socket.on('round-reveal', (data: RoundRevealData) => {
      setRoundReveal(data);
    });

    socket.on('error', (msg: string) => {
      setError(msg);
    });

    return () => {
      socket.disconnect();
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

  const submitGuess = useCallback((code: string, guessData: object) => {
    socketRef.current?.emit('submit-guess', { roomCode: code, guessData });
  }, []);

  const nextRound = useCallback((code: string) => {
    socketRef.current?.emit('next-round', { roomCode: code });
  }, []);

  const playAgain = useCallback((code: string) => {
    socketRef.current?.emit('play-again', { roomCode: code });
  }, []);

  return {
    socket: socketRef.current,
    connected,
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
    submitSignal,
    submitGuess,
    nextRound,
    playAgain,
  };
}
