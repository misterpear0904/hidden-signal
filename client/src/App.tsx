import { useEffect, useCallback } from 'react';
import './index.css';
import { useSocket, type GuessData } from './hooks/useSocket';
import { useVersionCheck } from './hooks/useVersionCheck';
import type { ChromaOptions, TerritoryOptions, LiarOptions, BluffAction, MissileBuildAction, MissileLaunchAction, MissileTypeLaunchAction, MissileLoadAction, MissileKeepFireAction, MissileDesperationAction, MissileCommandOptions } from './types/game';
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
import MissileCommandGame from './components/missileCommand/MissileCommandGame';
import RoomExpired from './components/RoomExpired';
import RestoreChoice from './components/RestoreChoice';

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
    connectStartedAt,
    retryConnection,
    myId,
    roomCode,
    inRoom,
    roomState,
    myRole,
    roundReveal,
    error,
    clearError,
    setError,
    clearRoomExpired,
    roomExpired,
    restoreStatus,
    restoreChoice,
    resyncNotice,
    retryRestore,
    dismissRestoreChoice,
    clearResyncNotice,
    sendingAction,
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
    forceAdvance,
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
    requestRoomState,
    playAgain,
    leaveRoom,
    buildMissileBuilding,
    upgradeMissileBuilding,
    sellMissileBuilding,
    cancelMissileSell,
    rebuildRubble,
    loadMissile,
    launchMissile,
    launchMissileType,
    setKeepFire,
    fireDesperation,
    claimSupplyShip,
    updateMissileCommandOptions,
  } = useSocket();

  // Auto-dismiss error after 4 seconds
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 4000);
    return () => clearTimeout(t);
  }, [error, clearError]);

  // Server/client contract check — prompts for refresh on mismatch.
  const { mismatch: versionMismatch, serverVersion } = useVersionCheck();

  const me = roomState?.players.find(p => p.id === myId);
  // Host authority comes from the server's single source of truth (room.hostId),
  // not from a per-player flag that can drift during migration.
  const isHost = roomState?.hostId ? roomState.hostId === myId : (me?.isHost ?? false);
  const isLastRound = (roomState?.round ?? 0) >= TOTAL_ROUNDS;

  // Results watchdog: if we're on the reveal screen but never received the
  // round-reveal payload, pull a fresh snapshot instead of spinning forever.
  useEffect(() => {
    if (roomState?.phase !== 'reveal' || roundReveal || !roomCode) return;
    const t = setTimeout(() => requestRoomState?.(roomCode), 1500);
    return () => clearTimeout(t);
  }, [roomState?.phase, roundReveal, roomCode, requestRoomState]);

  const handleCreate = useCallback((name: string) => createRoom(name), [createRoom]);
  const handleJoin = useCallback((code: string, name: string) => joinRoom(code, name), [joinRoom]);
  const handleSelectGame = useCallback((gameId: string) => { if (roomCode) selectGame(roomCode, gameId); }, [roomCode, selectGame]);
  const handleUpdateChromaOptions = useCallback((options: Partial<ChromaOptions>) => { if (roomCode) updateChromaOptions(roomCode, options); }, [roomCode, updateChromaOptions]);
  const handleUpdateTerritoryOptions = useCallback((options: Partial<TerritoryOptions>) => { if (roomCode) updateTerritoryOptions(roomCode, options); }, [roomCode, updateTerritoryOptions]);
  const handleUpdateLiarOptions = useCallback((options: Partial<LiarOptions>) => { if (roomCode) updateLiarOptions(roomCode, options); }, [roomCode, updateLiarOptions]);
  const handleSetPlayerDifficulty = useCallback((diff: 'easy' | 'medium' | 'hard') => { if (roomCode) setPlayerDifficulty(roomCode, diff); }, [roomCode, setPlayerDifficulty]);
  const handleStartGame = useCallback(async () => { if (roomCode) await startGame(roomCode); }, [roomCode, startGame]);
  const handleGuessChromaTile = useCallback((tileIndex: number) => (
    roomCode ? submitChromaGuess(roomCode, tileIndex) : Promise.resolve({ ok: false, error: 'Not in a room' })
  ), [roomCode, submitChromaGuess]);
  const handleNextChromaRound = useCallback(() => (
    roomCode ? nextChromaRound(roomCode) : Promise.resolve({ ok: false, error: 'Not in a room' })
  ), [roomCode, nextChromaRound]);
  const handleSubmitTerritoryPick = useCallback((colIndex: number) => (
    roomCode ? submitTerritoryPick(roomCode, colIndex) : Promise.resolve({ ok: false, error: 'Not in a room' })
  ), [roomCode, submitTerritoryPick]);
  const handlePlaceTerritoryMine = useCallback((row: number, col: number) => (
    roomCode ? placeTerritoryMine(roomCode, row, col) : Promise.resolve({ ok: false, error: 'Not in a room' })
  ), [roomCode, placeTerritoryMine]);
  const handleNextTerritoryTurn = useCallback(() => (
    roomCode ? nextTerritoryTurn(roomCode) : Promise.resolve({ ok: false, error: 'Not in a room' })
  ), [roomCode, nextTerritoryTurn]);
  const handleSubmitSignal = useCallback((signal: string) => (
    roomCode ? submitSignal(roomCode, signal) : Promise.resolve({ ok: false, error: 'Not in a room' })
  ), [roomCode, submitSignal]);
  const handleSubmitGuess = useCallback((guessData: GuessData) => (
    roomCode ? submitGuess(roomCode, guessData) : Promise.resolve({ ok: false, error: 'Not in a room' })
  ), [roomCode, submitGuess]);
  const handleKickPlayer = useCallback(async (targetId: string) => {
    if (!roomCode) return;
    const ack = await kickPlayer(roomCode, targetId);
    if (ack?.ok) setError('Player kicked');
    else setError(ack?.error || 'Kick failed');
  }, [roomCode, kickPlayer]);
  const handleRequestEndVote = useCallback(() => { if (roomCode) requestEndVote(roomCode); }, [roomCode, requestEndVote]);
  const handleSubmitEndVote = useCallback((agree: boolean) => { if (roomCode) submitEndVote(roomCode, agree); }, [roomCode, submitEndVote]);
  const handleCancelEndVote = useCallback(() => { if (roomCode) cancelEndVote(roomCode); }, [roomCode, cancelEndVote]);
  const handleForceAdvance = useCallback(async () => {
    if (!roomCode) return;
    const ack = await forceAdvance(roomCode);
    if (!ack?.ok) console.warn('force advance rejected', ack?.error);
  }, [roomCode, forceAdvance]);
  const handleSubmitBlendClue = useCallback((word: string) => (
    roomCode ? submitBlendClue(roomCode, word) : Promise.resolve({ ok: false, error: 'Not in a room' })
  ), [roomCode, submitBlendClue]);
  const handleSubmitBlendVote = useCallback((targetId: string) => (
    roomCode ? submitBlendVote(roomCode, targetId) : Promise.resolve({ ok: false, error: 'Not in a room' })
  ), [roomCode, submitBlendVote]);
  const handleSubmitBlendGuess = useCallback((guess: string) => (
    roomCode ? submitBlendGuess(roomCode, guess) : Promise.resolve({ ok: false, error: 'Not in a room' })
  ), [roomCode, submitBlendGuess]);
  const handleSubmitLiarBid = useCallback((qty: number, face: number) => (
    roomCode ? submitLiarBid(roomCode, qty, face) : Promise.resolve({ ok: false, error: 'Not in a room' })
  ), [roomCode, submitLiarBid]);
  const handleSubmitLiarCall = useCallback((kind: 'liar' | 'exact') => (
    roomCode ? submitLiarCall(roomCode, kind) : Promise.resolve({ ok: false, error: 'Not in a room' })
  ), [roomCode, submitLiarCall]);
  const handleSubmitBluffAction = useCallback((action: BluffAction) => (
    roomCode ? submitBluffAction(roomCode, action) : Promise.resolve({ ok: false, error: 'Not in a room' })
  ), [roomCode, submitBluffAction]);
  const handleNextBlendRound = useCallback(() => { if (roomCode) nextBlendRound(roomCode); }, [roomCode, nextBlendRound]);
  const handleNextLiarRound = useCallback(() => { if (roomCode) nextLiarRound(roomCode); }, [roomCode, nextLiarRound]);
  const handleNextBluffRound = useCallback(() => { if (roomCode) nextBluffRound(roomCode); }, [roomCode, nextBluffRound]);
  const handleNextRound = useCallback(() => { if (roomCode) nextRound(roomCode); }, [roomCode, nextRound]);
  const handlePlayAgain = useCallback(() => { if (roomCode) playAgain(roomCode); }, [roomCode, playAgain]);
  // Task 20: one-click rematch — back to lobby then immediately start the
  // same game again. Both steps are server-acknowledged and host-gated; every
  // client rides the broadcasts (lobby flash, then the new game) together.
  const handleRematch = useCallback(async () => {
    if (!roomCode) return;
    const back = await playAgain(roomCode);
    if (!back?.ok) { setError(back?.error || 'Rematch failed — could not return to lobby'); return; }
    const started = await startGame(roomCode);
    if (!started?.ok) setError(started?.error || 'Back in lobby — press Start for the rematch');
  }, [roomCode, playAgain, startGame, setError]);
  const handleLeaveRoom = useCallback(async () => {
    if (!roomCode) return;
    if (!window.confirm('Leave this room?')) return;
    const ack = await leaveRoom(roomCode);
    if (!ack?.ok) setError(ack?.error || 'Leave failed');
  }, [roomCode, leaveRoom, setError]);
  const handleBuildMissile = useCallback(async (action: MissileBuildAction) => { if (roomCode) await buildMissileBuilding(roomCode, action); }, [roomCode, buildMissileBuilding]);
  const handleUpgradeMissile = useCallback(async (buildingId: string) => { if (roomCode) await upgradeMissileBuilding(roomCode, { buildingId }); }, [roomCode, upgradeMissileBuilding]);
  const handleSellMissile = useCallback(async (buildingId: string) => { if (roomCode) await sellMissileBuilding(roomCode, { buildingId }); }, [roomCode, sellMissileBuilding]);
  const handleCancelMissileSell = useCallback(async (buildingId: string) => { if (roomCode) await cancelMissileSell(roomCode, { buildingId }); }, [roomCode, cancelMissileSell]);
  const handleRebuildRubble = useCallback(async (rubbleId: string) => { if (roomCode) await rebuildRubble(roomCode, rubbleId); }, [roomCode, rebuildRubble]);
  const handleLaunchMissile = useCallback(async (action: MissileLaunchAction) => { if (roomCode) await launchMissile(roomCode, action); }, [roomCode, launchMissile]);
  const handleLaunchMissileType = useCallback(async (action: MissileTypeLaunchAction) => { if (roomCode) await launchMissileType(roomCode, action); }, [roomCode, launchMissileType]);
  const handleLoadMissile = useCallback(async (action: MissileLoadAction) => { if (roomCode) await loadMissile(roomCode, action); }, [roomCode, loadMissile]);
  const handleSetKeepFire = useCallback(async (action: MissileKeepFireAction) => { if (roomCode) await setKeepFire(roomCode, action); }, [roomCode, setKeepFire]);
  const handleFireDesperation = useCallback(async (action: MissileDesperationAction) => { if (roomCode) await fireDesperation(roomCode, action); }, [roomCode, fireDesperation]);
  const handleClaimSupplyShip = useCallback(async () => { if (roomCode) await claimSupplyShip(roomCode); }, [roomCode, claimSupplyShip]);
  const handleUpdateMissileCommandOptions = useCallback(async (options: Partial<MissileCommandOptions>) => { if (roomCode) await updateMissileCommandOptions(roomCode, options); }, [roomCode, updateMissileCommandOptions]);

  // ─── Phase Router ──────────────────────────────────────────────────────────
  const renderPhase = () => {
    if (!inRoom && restoreChoice) {
      return (
        <RestoreChoice
          roomCode={restoreChoice.roomCode}
          playerName={restoreChoice.playerName}
          reason={restoreChoice.reason}
          onRejoin={retryRestore}
          onLeave={dismissRestoreChoice}
        />
      );
    }

    if (!inRoom || !roomState) {
      return (
        <LandingPage
          onCreateRoom={handleCreate}
          onJoinRoom={handleJoin}
          connected={connected}
          connectionStatus={connectionStatus}
          connectError={connectError}
          retryCount={retryCount}
          connectStartedAt={connectStartedAt}
          retryConnection={retryConnection}
        />
      );
    }

    // Room expired — show explicit expired screen with way back
    if (roomExpired) {
      return (
        <RoomExpired
          roomCode={roomExpired.roomCode}
          reason={roomExpired.reason}
          onClear={clearRoomExpired}
        />
      );
    }

    switch (roomState.phase) {
      case 'lobby':
        return (
          <Lobby
            roomState={roomState}
            myId={myId}
            connected={connected}
            connectionStatus={connectionStatus}
            onRetryConnection={retryConnection}
            onSelectGame={handleSelectGame}
            onUpdateChromaOptions={handleUpdateChromaOptions}
            onUpdateTerritoryOptions={handleUpdateTerritoryOptions}
            onUpdateLiarOptions={handleUpdateLiarOptions}
            onUpdateMissileCommandOptions={handleUpdateMissileCommandOptions}
            onSetPlayerDifficulty={handleSetPlayerDifficulty}
            onKickPlayer={handleKickPlayer}
            onStartGame={handleStartGame}
            onLeaveRoom={handleLeaveRoom}
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

      case 'missile-command-build':
      case 'missile-command-play':
      case 'missile-command-end':
        return (
          <MissileCommandGame
            roomState={roomState}
            myId={myId}
            isHost={isHost}
            onBuild={handleBuildMissile}
            onUpgrade={handleUpgradeMissile}
            onSell={handleSellMissile}
            onCancelSell={handleCancelMissileSell}
            onRebuild={handleRebuildRubble}
            onLoad={handleLoadMissile}
            onLaunch={handleLaunchMissile}
            onLaunchType={handleLaunchMissileType}
            onSetKeepFire={handleSetKeepFire}
            onFireDesperation={handleFireDesperation}
            onClaimSupplyShip={handleClaimSupplyShip}
            onPlayAgain={handlePlayAgain}
            onRematch={handleRematch}
            onLeaveRoom={handleLeaveRoom}
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
            onRematch={handleRematch}
            onLeaveRoom={handleLeaveRoom}
          />
        );

      default:
        return <LoadingScreen text="Connecting..." />;
    }
  };

  return (
    <>
      <div className="bg-mesh" />
      {versionMismatch && (
        <div
          role="alert"
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 2000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
            padding: '10px 16px', background: 'rgba(124,45,18,0.97)',
            borderBottom: '2px solid rgba(251,191,36,0.7)', color: '#fff',
            fontWeight: 800, fontSize: '0.9rem', textAlign: 'center',
          }}
        >
          <span>🔄 A new version is available (server v{serverVersion}) — refresh to keep playing.</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 18px', borderRadius: 999, fontWeight: 800, fontSize: '0.85rem',
              color: '#000', background: '#fbbf24', border: 'none', cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Refresh now
          </button>
        </div>
      )}
      <ErrorBoundary>
        {renderPhase()}
      </ErrorBoundary>
      {/* Task 1: while a game action awaits its server ack, say so — the UI
          may not claim success until the ack lands, so the wait is visible. */}
      {inRoom && sendingAction && (
        <div
          role="status"
          style={{
            position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 1800,
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 16px', borderRadius: 999,
            background: 'rgba(15,23,42,0.92)', border: '1px solid rgba(148,163,184,0.35)',
            color: '#fff', fontWeight: 700, fontSize: '0.8rem', whiteSpace: 'nowrap',
          }}
        >
          <span className="spinner" style={{ width: 14, height: 14 }} aria-hidden="true" />
          <span>⏳ {sendingAction} — waiting for server…</span>
        </div>
      )}
      {/* Offline banner: in-room screens otherwise look identical live or
          dead, which is how rooms "die silently" from the host's view. */}
      {inRoom && !connected && (
        <div
          role="alert"
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1900,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
            padding: '10px 16px',
            background: connectionStatus === 'failed' ? 'rgba(127,29,29,0.97)' : 'rgba(124,45,18,0.97)',
            borderBottom: `2px solid ${connectionStatus === 'failed' ? 'rgba(248,113,113,0.7)' : 'rgba(251,191,36,0.7)'}`,
            color: '#fff', fontWeight: 800, fontSize: '0.9rem', textAlign: 'center',
          }}
        >
          <span>
            {connectionStatus === 'failed'
              ? '📡 Disconnected — actions won’t work until you reconnect.'
              : '📡 Reconnecting — actions won’t work until you’re back.'}
          </span>
          {connectionStatus === 'failed' && (
            <button
              type="button"
              onClick={retryConnection}
              style={{
                padding: '8px 18px', borderRadius: 999, fontWeight: 800, fontSize: '0.85rem',
                color: '#000', background: '#fca5a5', border: 'none', cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Retry now
            </button>
          )}
        </div>
      )}
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
      {inRoom && roomState && roomState.phase !== 'lobby' && roomState.phase !== 'end' && roomState.phase !== 'missile-command-end' && (
        <button
          type="button"
          onClick={handleLeaveRoom}
          className="btn btn-sm btn-secondary"
          id="leave-room-btn"
          title="Leave this room"
          style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 500, opacity: 0.9 }}
        >
          🚪 Leave Room
        </button>
      )}
      {inRoom && roomState && roomState.phase !== 'lobby' && roomState.phase !== 'end' && isHost && (
        <button
          type="button"
          onClick={handleForceAdvance}
          className="btn btn-sm btn-secondary"
          id="force-advance-btn"
          title="Host: force advance the current phase/round"
          style={{ position: 'fixed', bottom: 16, left: 16, zIndex: 500, opacity: 0.85 }}
        >
          ⏩ Force advance
        </button>
      )}
      {inRoom && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed', top: 8, right: 8, zIndex: 1850,
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px', borderRadius: 999,
            background: 'rgba(15,23,42,0.85)', border: '1px solid rgba(148,163,184,0.35)',
            color: '#fff', fontWeight: 700, fontSize: '0.75rem', whiteSpace: 'nowrap',
          }}
        >
          <span className={connected ? 'conn-dot online' : (connectionStatus === 'connecting' || connectionStatus === 'reconnecting' || connectionStatus === 'server_sleeping' ? 'conn-dot pulsing' : 'conn-dot offline')} />
          <span>{connected ? 'Connected' : (connectionStatus === 'reconnecting' ? 'Reconnecting...' : connectionStatus === 'connecting' ? 'Connecting...' : connectionStatus === 'server_sleeping' ? 'Server waking...' : 'Disconnected')}</span>
          {!connected && (
            <button
              type="button"
              onClick={retryConnection}
              style={{ padding: '2px 8px', borderRadius: 999, fontWeight: 800, fontSize: '0.7rem', color: '#000', background: '#fca5a5', border: 'none', cursor: 'pointer' }}
            >
              Reconnect
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="toast" role="alert" onClick={clearError} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') clearError(); }} tabIndex={0} id="error-toast">
          {`⚠ ${error}`}
        </div>
      )}
      {resyncNotice && (
        <div className="toast" role="status" onClick={clearResyncNotice} tabIndex={0} id="resync-notice">
          {`🔄 ${resyncNotice}`}
        </div>
      )}
    </>
  );
}
