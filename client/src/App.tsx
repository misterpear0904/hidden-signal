import { useEffect, useCallback } from 'react';
import './index.css';
import { useSocket } from './hooks/useSocket';
import LandingPage from './components/LandingPage';
import Lobby from './components/Lobby';
import RoleReveal from './components/RoleReveal';
import SignalPhase from './components/SignalPhase';
import DiscussPhase from './components/DiscussPhase';
import GuessPhase from './components/GuessPhase';
import RoundReveal from './components/RoundReveal';
import FinalLeaderboard from './components/FinalLeaderboard';

import ChromaShiftGame from './components/ChromaShiftGame';
import TerritoryPushGame from './components/TerritoryPushGame';

function LoadingScreen({ text }: { text: string }) {
  return (
    <div className="page">
      <div className="flex flex-col items-center gap-16">
        <div className="spinner" />
        <p className="text-muted text-sm">{text}</p>
      </div>
    </div>
  );
}

export default function App() {
  const {
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
    selectGame,
    updateChromaOptions,
    updateTerritoryOptions,
    setPlayerDifficulty,
    submitChromaGuess,
    nextChromaRound,
    submitTerritoryPick,
    nextTerritoryTurn,
    submitSignal,
    submitGuess,
    nextRound,
    playAgain,
  } = useSocket();

  // Auto-dismiss error after 4 seconds
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 4000);
    return () => clearTimeout(t);
  }, [error, clearError]);

  const me = roomState?.players.find(p => p.id === myId);
  const isHost = me?.isHost ?? false;
  const isLastRound = (roomState?.round ?? 0) >= 5;

  const handleCreate = useCallback((name: string) => createRoom(name), [createRoom]);
  const handleJoin = useCallback((code: string, name: string) => joinRoom(code, name), [joinRoom]);
  const handleSelectGame = useCallback((gameId: string) => { if (roomCode) selectGame(roomCode, gameId); }, [roomCode, selectGame]);
  const handleUpdateChromaOptions = useCallback((options: Partial<import('./types/game').ChromaOptions>) => { if (roomCode) updateChromaOptions(roomCode, options); }, [roomCode, updateChromaOptions]);
  const handleUpdateTerritoryOptions = useCallback((options: Partial<import('./types/game').TerritoryOptions>) => { if (roomCode) updateTerritoryOptions(roomCode, options); }, [roomCode, updateTerritoryOptions]);
  const handleSetPlayerDifficulty = useCallback((diff: 'easy' | 'medium' | 'hard') => { if (roomCode) setPlayerDifficulty(roomCode, diff); }, [roomCode, setPlayerDifficulty]);
  const handleStartGame = useCallback(() => { if (roomCode) startGame(roomCode); }, [roomCode, startGame]);
  const handleGuessChromaTile = useCallback((tileIndex: number) => { if (roomCode) submitChromaGuess(roomCode, tileIndex); }, [roomCode, submitChromaGuess]);
  const handleNextChromaRound = useCallback(() => { if (roomCode) nextChromaRound(roomCode); }, [roomCode, nextChromaRound]);
  const handleSubmitTerritoryPick = useCallback((colIndex: number) => { if (roomCode) submitTerritoryPick(roomCode, colIndex); }, [roomCode, submitTerritoryPick]);
  const handleNextTerritoryTurn = useCallback(() => { if (roomCode) nextTerritoryTurn(roomCode); }, [roomCode, nextTerritoryTurn]);
  const handleSubmitSignal = useCallback((signal: string) => { if (roomCode) submitSignal(roomCode, signal); }, [roomCode, submitSignal]);
  const handleSubmitGuess = useCallback((guessData: object) => { if (roomCode) submitGuess(roomCode, guessData); }, [roomCode, submitGuess]);
  const handleNextRound = useCallback(() => { if (roomCode) nextRound(roomCode); }, [roomCode, nextRound]);
  const handlePlayAgain = useCallback(() => { if (roomCode) playAgain(roomCode); }, [roomCode, playAgain]);

  // ─── Phase Router ──────────────────────────────────────────────────────────
  const renderPhase = () => {
    if (!inRoom || !roomState) {
      return <LandingPage onCreateRoom={handleCreate} onJoinRoom={handleJoin} connected={connected} />;
    }

    switch (roomState.phase) {
      case 'lobby':
        return (
          <Lobby
            roomState={roomState}
            myId={myId}
            onSelectGame={handleSelectGame}
            onUpdateChromaOptions={handleUpdateChromaOptions}
            onUpdateTerritoryOptions={handleUpdateTerritoryOptions}
            onSetPlayerDifficulty={handleSetPlayerDifficulty}
            onStartGame={handleStartGame}
          />
        );

      case 'chroma-play':
      case 'chroma-reveal':
        return (
          <ChromaShiftGame
            roomState={roomState}
            myId={myId}
            isHost={isHost}
            onGuessTile={handleGuessChromaTile}
            onNextRound={handleNextChromaRound}
          />
        );

      case 'territory-turn':
      case 'territory-reveal':
        return (
          <TerritoryPushGame
            roomState={roomState}
            myId={myId}
            isHost={isHost}
            onSubmitPick={handleSubmitTerritoryPick}
            onNextTurn={handleNextTerritoryTurn}
          />
        );

      case 'role-reveal':
        if (!myRole) return <LoadingScreen text="Loading your role..." />;
        return <RoleReveal myRole={myRole} roomState={roomState} myId={myId} />;

      case 'signal':
        if (!myRole) return <LoadingScreen text="Preparing signal phase..." />;
        return (
          <SignalPhase
            myRole={myRole}
            roomState={roomState}
            myId={myId}
            onSubmitSignal={handleSubmitSignal}
          />
        );

      case 'discuss':
        if (!myRole) return <LoadingScreen text="Loading signals..." />;
        return <DiscussPhase roomState={roomState} myId={myId} myRole={myRole} />;

      case 'guess':
        if (!myRole) return <LoadingScreen text="Preparing guess phase..." />;
        return (
          <GuessPhase
            myRole={myRole}
            roomState={roomState}
            myId={myId}
            onSubmitGuess={handleSubmitGuess}
          />
        );

      case 'reveal':
        if (!roundReveal) return <LoadingScreen text="Calculating results..." />;
        return (
          <RoundReveal
            revealData={roundReveal}
            roomState={roomState}
            myId={myId}
            isHost={isHost}
            isLastRound={isLastRound}
            onNextRound={handleNextRound}
          />
        );

      case 'end':
        return (
          <FinalLeaderboard
            roomState={roomState}
            myId={myId}
            isHost={isHost}
            onPlayAgain={handlePlayAgain}
          />
        );

      default:
        return <LoadingScreen text="Connecting..." />;
    }
  };

  return (
    <>
      <div className="bg-mesh" />
      {renderPhase()}
      {error && (
        <div className="toast" onClick={clearError} id="error-toast">
          ⚠ {error}
        </div>
      )}
    </>
  );
}
