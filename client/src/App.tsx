import { useEffect, useCallback } from 'react';
import './index.css';
import { useSocket, type GuessData } from './hooks/useSocket';
import type { ChromaOptions, TerritoryOptions, LiarOptions, BluffAction } from './types/game';
import { TOTAL_ROUNDS } from './constants';
import ErrorBoundary from './components/ErrorBoundary';
import LandingPage from './components/LandingPage';
import Lobby from './components/Lobby';
import RoleReveal from './components/RoleReveal';
import SignalPhase from './components/SignalPhase';
import DiscussPhase from './components/DiscussPhase';
import GuessPhase from './components/GuessPhase';
import RoundReveal from './components/RoundReveal';
import FinalLeaderboard from './components/FinalLeaderboard';
import EndGameVote from './components/EndGameVote';

import ChromaShiftGame from './components/ChromaShiftGame';
import TerritoryPushGame from './components/TerritoryPushGame';
import BlendWordPhase from './components/BlendWordPhase';
import BlendVotePhase from './components/BlendVotePhase';
import BlendGuessPhase from './components/BlendGuessPhase';
import BlendRevealPhase from './components/BlendRevealPhase';
import LiarBidPhase from './components/LiarBidPhase';
import LiarRevealPhase from './components/LiarRevealPhase';
import BluffBetPhase from './components/BluffBetPhase';
import BluffRevealPhase from './components/BluffRevealPhase';

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
    connectionStatus,
    connectError,
    retryCount,
    retryConnection,
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
  } = useSocket();

  // Auto-dismiss error after 4 seconds
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 4000);
    return () => clearTimeout(t);
  }, [error, clearError]);

  const me = roomState?.players.find(p => p.id === myId);
  const isHost = me?.isHost ?? false;
  const isLastRound = (roomState?.round ?? 0) >= TOTAL_ROUNDS;

  const handleCreate = useCallback((name: string) => createRoom(name), [createRoom]);
  const handleJoin = useCallback((code: string, name: string) => joinRoom(code, name), [joinRoom]);
  const handleSelectGame = useCallback((gameId: string) => { if (roomCode) selectGame(roomCode, gameId); }, [roomCode, selectGame]);
  const handleUpdateChromaOptions = useCallback((options: Partial<ChromaOptions>) => { if (roomCode) updateChromaOptions(roomCode, options); }, [roomCode, updateChromaOptions]);
  const handleUpdateTerritoryOptions = useCallback((options: Partial<TerritoryOptions>) => { if (roomCode) updateTerritoryOptions(roomCode, options); }, [roomCode, updateTerritoryOptions]);
  const handleUpdateLiarOptions = useCallback((options: Partial<LiarOptions>) => { if (roomCode) updateLiarOptions(roomCode, options); }, [roomCode, updateLiarOptions]);
  const handleSetPlayerDifficulty = useCallback((diff: 'easy' | 'medium' | 'hard') => { if (roomCode) setPlayerDifficulty(roomCode, diff); }, [roomCode, setPlayerDifficulty]);
  const handleStartGame = useCallback(() => { if (roomCode) startGame(roomCode); }, [roomCode, startGame]);
  const handleGuessChromaTile = useCallback((tileIndex: number) => { if (roomCode) submitChromaGuess(roomCode, tileIndex); }, [roomCode, submitChromaGuess]);
  const handleNextChromaRound = useCallback(() => { if (roomCode) nextChromaRound(roomCode); }, [roomCode, nextChromaRound]);
  const handleSubmitTerritoryPick = useCallback((colIndex: number) => { if (roomCode) submitTerritoryPick(roomCode, colIndex); }, [roomCode, submitTerritoryPick]);
  const handlePlaceTerritoryMine = useCallback((row: number, col: number) => { if (roomCode) placeTerritoryMine(roomCode, row, col); }, [roomCode, placeTerritoryMine]);
  const handleNextTerritoryTurn = useCallback(() => { if (roomCode) nextTerritoryTurn(roomCode); }, [roomCode, nextTerritoryTurn]);
  const handleSubmitSignal = useCallback((signal: string) => { if (roomCode) submitSignal(roomCode, signal); }, [roomCode, submitSignal]);
  const handleSubmitGuess = useCallback((guessData: GuessData) => { if (roomCode) submitGuess(roomCode, guessData); }, [roomCode, submitGuess]);
  const handleKickPlayer = useCallback((targetId: string) => { if (roomCode) kickPlayer(roomCode, targetId); }, [roomCode, kickPlayer]);
  const handleRequestEndVote = useCallback(() => { if (roomCode) requestEndVote(roomCode); }, [roomCode, requestEndVote]);
  const handleSubmitEndVote = useCallback((agree: boolean) => { if (roomCode) submitEndVote(roomCode, agree); }, [roomCode, submitEndVote]);
  const handleCancelEndVote = useCallback(() => { if (roomCode) cancelEndVote(roomCode); }, [roomCode, cancelEndVote]);
  const handleSubmitBlendClue = useCallback((word: string) => { if (roomCode) submitBlendClue(roomCode, word); }, [roomCode, submitBlendClue]);
  const handleSubmitBlendVote = useCallback((targetId: string) => { if (roomCode) submitBlendVote(roomCode, targetId); }, [roomCode, submitBlendVote]);
  const handleSubmitBlendGuess = useCallback((guess: string) => { if (roomCode) submitBlendGuess(roomCode, guess); }, [roomCode, submitBlendGuess]);
  const handleNextBlendRound = useCallback(() => { if (roomCode) nextBlendRound(roomCode); }, [roomCode, nextBlendRound]);
  const handleSubmitLiarBid = useCallback((qty: number, face: number) => { if (roomCode) submitLiarBid(roomCode, qty, face); }, [roomCode, submitLiarBid]);
  const handleSubmitLiarCall = useCallback((kind: 'liar' | 'exact') => { if (roomCode) submitLiarCall(roomCode, kind); }, [roomCode, submitLiarCall]);
  const handleNextLiarRound = useCallback(() => { if (roomCode) nextLiarRound(roomCode); }, [roomCode, nextLiarRound]);
  const handleSubmitBluffAction = useCallback((action: BluffAction) => { if (roomCode) submitBluffAction(roomCode, action); }, [roomCode, submitBluffAction]);
  const handleNextBluffRound = useCallback(() => { if (roomCode) nextBluffRound(roomCode); }, [roomCode, nextBluffRound]);
  const handleNextRound = useCallback(() => { if (roomCode) nextRound(roomCode); }, [roomCode, nextRound]);
  const handlePlayAgain = useCallback(() => { if (roomCode) playAgain(roomCode); }, [roomCode, playAgain]);

  // ─── Phase Router ──────────────────────────────────────────────────────────
  const renderPhase = () => {
    if (!inRoom || !roomState) {
      return (
        <LandingPage
          onCreateRoom={handleCreate}
          onJoinRoom={handleJoin}
          connected={connected}
          connectionStatus={connectionStatus}
          connectError={connectError}
          retryCount={retryCount}
          retryConnection={retryConnection}
        />
      );
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
            onUpdateLiarOptions={handleUpdateLiarOptions}
            onSetPlayerDifficulty={handleSetPlayerDifficulty}
            onKickPlayer={handleKickPlayer}
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
            onPlaceMine={handlePlaceTerritoryMine}
            onNextTurn={handleNextTerritoryTurn}
          />
        );

      case 'blend-word':
        return (
          <BlendWordPhase
            roomState={roomState}
            myId={myId}
            onSubmitClue={handleSubmitBlendClue}
          />
        );

      case 'blend-vote':
        return (
          <BlendVotePhase
            roomState={roomState}
            myId={myId}
            onSubmitVote={handleSubmitBlendVote}
          />
        );

      case 'blend-guess':
        return (
          <BlendGuessPhase
            roomState={roomState}
            myId={myId}
            onSubmitGuess={handleSubmitBlendGuess}
          />
        );

      case 'blend-reveal':
        return (
          <BlendRevealPhase
            roomState={roomState}
            myId={myId}
            isHost={isHost}
            isLastRound={isLastRound}
            onNextRound={handleNextBlendRound}
          />
        );

      case 'liar-bid':
        return (
          <LiarBidPhase
            roomState={roomState}
            myId={myId}
            onBid={handleSubmitLiarBid}
            onCall={handleSubmitLiarCall}
          />
        );

      case 'liar-reveal':
        return (
          <LiarRevealPhase
            roomState={roomState}
            myId={myId}
            isHost={isHost}
            isLastRound={isLastRound}
            onNextRound={handleNextLiarRound}
          />
        );

      case 'bluff-bet':
        return (
          <BluffBetPhase
            roomState={roomState}
            myId={myId}
            onAction={handleSubmitBluffAction}
          />
        );

      case 'bluff-reveal':
        return (
          <BluffRevealPhase
            roomState={roomState}
            myId={myId}
            isHost={isHost}
            isLastRound={isLastRound}
            onNextRound={handleNextBluffRound}
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
            onRequestEndVote={handleRequestEndVote}
          />
        );

      default:
        return <LoadingScreen text="Connecting..." />;
    }
  };

  return (
    <>
      <div className="bg-mesh" />
      <ErrorBoundary>
        {renderPhase()}
      </ErrorBoundary>
      {inRoom && roomState && roomState.phase !== 'lobby' && roomState.phase !== 'end' && (
        <EndGameVote
          roomState={roomState}
          myId={myId}
          isHost={isHost}
          onRequest={handleRequestEndVote}
          onVote={handleSubmitEndVote}
          onCancel={handleCancelEndVote}
        />
      )}
      {error && (
        <div className="toast" role="alert" onClick={clearError} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') clearError(); }} tabIndex={0} id="error-toast">
          ⚠ {error}
        </div>
      )}
    </>
  );
}
