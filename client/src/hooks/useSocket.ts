import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { RoomState, RoleData, RoundRevealData, ChromaOptions, TerritoryOptions, LiarOptions, BluffAction, MissileBuildAction, MissileUpgradeAction, MissileLaunchAction, MissileTypeLaunchAction, MissileLoadAction, MissileKeepFireAction, MissileDesperationAction, MissileCommandOptions } from '../types/game';
import { saveRoomSession, clearRoomSession, readRoomSession } from '../utils/roomSession';import { applyMissileTick, type MissileTickPayload } from '../components/missileCommand/mcTick';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

// Server-acknowledged action settings (Task 1). Per-attempt deadline, then
// retries with backoff while the action stays unanswered.
const ACK_TIMEOUT_MS = 8000;
const ACK_RETRY_DELAYS_MS = [400, 1200]; // 3 attempts total

// Application-level heartbeat (Task 5): socket.io's own ping/pong can take
// ~45s to declare a dead connection, which is far too long for a party game.
// We send our own heartbeat every few seconds and treat a missing ack as a
// drop within HEARTBEAT_TIMEOUT_MS.
const HEARTBEAT_INTERVAL_MS = 4000;
const HEARTBEAT_TIMEOUT_MS = 8000;

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

// Result of a server-acknowledged action (Task 1). A game action may only be
// treated as recorded once the server returns ok:true for its requestId.
export interface ActionAck {
  ok: boolean;
  error?: string;
}

export interface SocketHookReturn {
  socket: Socket | null;
  connected: boolean;
  connectionStatus: ConnectionStatus;
  connectError: string | null;
  retryCount: number;
  // Wall-clock ms when the CURRENT wait began (first entry into
  // connecting/reconnecting/server_sleeping). Null once connected — drives
  // the home-screen "waiting Ns" countdown. Survives transitions between
  // waiting states so it measures the total wait, not the last hop.
  connectStartedAt: number | null;
  myId: string;
  roomCode: string;
  inRoom: boolean;
  roomState: RoomState | null;
  myRole: RoleData | null;
  roundReveal: RoundRevealData | null;
  error: string | null;
  clearError: () => void;
  setError: (msg: string | null) => void;
  clearRoomExpired: () => void;
  roomExpired: { roomCode: string; reason: string } | null;
  // Session-restore state (Task 9). 'restoring' while a reload is walking
  // back into a stored session; 'failed' lands on a lobby-safe choice screen
  // instead of resurrecting a frozen snapshot.
  restoreStatus: 'idle' | 'restoring' | 'restored' | 'failed';
  restoreChoice: { roomCode: string; playerName: string; reason: string } | null;
  resyncNotice: string | null;
  retryRestore: () => void;
  dismissRestoreChoice: () => void;
  clearResyncNotice: () => void;
  // Label of the game action currently awaiting a server ack (Task 1) —
  // drives global "sending" feedback; per-control states come from the
  // returned promise.
  sendingAction: string | null;
  createRoom: (playerName: string) => void;
  joinRoom: (roomCode: string, playerName: string) => void;
  startGame: (roomCode: string) => Promise<ActionAck>;
  selectGame: (roomCode: string, gameId: string) => Promise<ActionAck>;
  updateChromaOptions: (roomCode: string, options: Partial<ChromaOptions>) => Promise<ActionAck>;
  updateTerritoryOptions: (roomCode: string, options: Partial<TerritoryOptions>) => Promise<ActionAck>;
  updateLiarOptions: (roomCode: string, options: Partial<LiarOptions>) => Promise<ActionAck>;
  setPlayerDifficulty: (roomCode: string, difficulty: 'easy' | 'medium' | 'hard') => Promise<ActionAck>;
  submitChromaGuess: (roomCode: string, tileIndex: number) => Promise<ActionAck>;
  nextChromaRound: (roomCode: string) => Promise<ActionAck>;
  submitTerritoryPick: (roomCode: string, colIndex: number) => Promise<ActionAck>;
  placeTerritoryMine: (roomCode: string, row: number, col: number) => Promise<ActionAck>;
  nextTerritoryTurn: (roomCode: string) => Promise<ActionAck>;
  submitSignal: (roomCode: string, signal: string) => Promise<ActionAck>;
  submitGuess: (roomCode: string, guessData: GuessData) => Promise<ActionAck>;
  kickPlayer: (roomCode: string, targetId: string) => Promise<ActionAck>;
  requestEndVote: (roomCode: string) => Promise<ActionAck>;
  submitEndVote: (roomCode: string, agree: boolean) => Promise<ActionAck>;
  cancelEndVote: (roomCode: string) => Promise<ActionAck>;
  forceAdvance: (roomCode: string) => Promise<ActionAck>;
  endRound: (roomCode: string) => Promise<ActionAck>;
  submitBlendClue: (roomCode: string, word: string) => Promise<ActionAck>;
  submitBlendVote: (roomCode: string, targetId: string) => Promise<ActionAck>;
  submitBlendGuess: (roomCode: string, guess: string) => Promise<ActionAck>;
  nextBlendRound: (roomCode: string) => Promise<ActionAck>;
  submitLiarBid: (roomCode: string, qty: number, face: number) => Promise<ActionAck>;
  submitLiarCall: (roomCode: string, kind: 'liar' | 'exact') => Promise<ActionAck>;
  nextLiarRound: (roomCode: string) => Promise<ActionAck>;
  submitBluffAction: (roomCode: string, action: BluffAction) => Promise<ActionAck>;
  nextBluffRound: (roomCode: string) => Promise<ActionAck>;
  nextRound: (roomCode: string) => Promise<ActionAck>;
  requestRoomState: (roomCode: string) => void;
  playAgain: (roomCode: string) => Promise<ActionAck>;
  leaveRoom: (roomCode: string) => Promise<ActionAck>;
  retryConnection: () => void;
  // Missile Command
  buildMissileBuilding: (roomCode: string, action: MissileBuildAction) => Promise<ActionAck>;
  upgradeMissileBuilding: (roomCode: string, action: MissileUpgradeAction) => Promise<ActionAck>;
  sellMissileBuilding: (roomCode: string, action: MissileUpgradeAction) => Promise<ActionAck>;
  cancelMissileSell: (roomCode: string, action: MissileUpgradeAction) => Promise<ActionAck>;
  rebuildRubble: (roomCode: string, rubbleId: string) => Promise<ActionAck>;
  loadMissile: (roomCode: string, action: MissileLoadAction) => Promise<ActionAck>;
  launchMissile: (roomCode: string, action: MissileLaunchAction) => Promise<ActionAck>;
  launchMissileType: (roomCode: string, action: MissileTypeLaunchAction) => Promise<ActionAck>;
  setKeepFire: (roomCode: string, action: MissileKeepFireAction) => Promise<ActionAck>;
  fireDesperation: (roomCode: string, action: MissileDesperationAction) => Promise<ActionAck>;
  claimSupplyShip: (roomCode: string) => Promise<ActionAck>;
  updateMissileCommandOptions: (roomCode: string, options: Partial<MissileCommandOptions>) => Promise<ActionAck>;
}

export function useSocket(): SocketHookReturn {
  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const connectedRef = useRef(false);
  useEffect(() => { connectedRef.current = connected; }, [connected]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [connectStartedAt, setConnectStartedAt] = useState<number | null>(null);

  // Stamp the wait start on first entry into a waiting state; clear it on
  // connect. Deliberately keyed off connectionStatus (not each setter) so
  // every path that flips status is covered.
  useEffect(() => {
    if (connectionStatus === 'connected') {
      setConnectStartedAt(null);
    } else if (
      (connectionStatus === 'connecting' ||
        connectionStatus === 'reconnecting' ||
        connectionStatus === 'server_sleeping')
    ) {
      setConnectStartedAt(prev => prev ?? Date.now());
    }
  }, [connectionStatus]);
  const [myId, setMyId] = useState<string>('');
  const [roomCode, setRoomCode] = useState<string>('');
  const roomCodeRef = useRef<string>('');
  // Player name, kept so a reconnect can reclaim our slot (socket ids change,
  // so the server matches us back by room code + name).
  const playerNameRef = useRef<string>('');
  const [inRoom, setInRoom] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [myRole, setMyRole] = useState<RoleData | null>(null);
  const [roundReveal, setRoundReveal] = useState<RoundRevealData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roomExpired, setRoomExpired] = useState<{ roomCode: string; reason: string } | null>(null);
  const reconnectingRef = useRef(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverSleepingRef = useRef(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastHeartbeatSentRef = useRef<number>(0);
  const lastHeartbeatAckRef = useRef<number>(0);
  const heartbeatDeadRef = useRef<boolean>(false);
  const forcedReconnectRef = useRef<boolean>(false);
  // Last server bootId seen. A changed bootId means the process restarted and
  // every in-memory room is gone — stale room screens must never look alive.
  const bootIdRef = useRef<string | null>(null);

  // Restore a session after an accidental refresh — helpers in
  // utils/roomSession (unit-tested). sessionStorage survives reloads but is
  // per-tab, so a second tab can never steal this slot.
  const saveSession = saveRoomSession;
  const clearSession = clearRoomSession;
  const readSession = readRoomSession;
  // One restore attempt per mount: guards the refresh race where the old
  // socket's disconnect hasn't been processed yet when we rejoin.
  const restoreAttemptedRef = useRef(false);
  const restoreInProgressRef = useRef(false);
  const pendingRestoreRef = useRef<{ roomCode: string; playerName: string } | null>(null);
  const [restoreStatus, setRestoreStatus] = useState<'idle' | 'restoring' | 'restored' | 'failed'>('idle');
  const [restoreChoice, setRestoreChoice] = useState<{ roomCode: string; playerName: string; reason: string } | null>(null);
  const [resyncNotice, setResyncNotice] = useState<string | null>(null);

  // Keep roomCodeRef in sync with roomCode
  useEffect(() => {
    roomCodeRef.current = roomCode;
  }, [roomCode]);

  // ─── Server-acknowledged actions (Task 1) ──────────────────────────────
  // Root cause this guards against: a plain socket.emit can be lost (dead
  // socket, queue-after-disconnect, rate limit, phase race) while the UI
  // already rendered "✓ Locked in!". Every game action therefore carries a
  // client requestId, requires a server ack, retries with backoff on silence,
  // and reconciles from the server snapshot when it can't be confirmed.
  //
  // Rejections settle immediately (no retry): the server answered, so the
  // action was *seen* — replaying an identical action can't help.
  // Missed acks retry with the SAME requestId; the server-side idempotency
  // log (server/actionAck.js) replays the stored result, so a retry can never
  // double-apply the action.
  const actionSeqRef = useRef(0);
  const [sendingAction, setSendingAction] = useState<string | null>(null);

  const sendAction = useCallback(
    (event: string, payload: Record<string, unknown>, label: string): Promise<ActionAck> => {
      return new Promise<ActionAck>((resolve) => {
        const seq = ++actionSeqRef.current;
        const requestId = `a${seq.toString(36)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        let settled = false;

        const settle = (res: ActionAck) => {
          if (settled) return; // late ack from a superseded attempt
          settled = true;
          setSendingAction(null);
          resolve(res);
        };

        // Pull the authoritative snapshot back over our local state after a
        // lost or rejected submit — never reconcile from stale local guesses.
        const reconcile = () => {
          const s = socketRef.current;
          if (s?.connected && payload.roomCode) {
            s.emit('room-state-request', { roomCode: payload.roomCode });
          }
        };

        const fail = (msg: string) => {
          console.warn('[action] not confirmed', { event, requestId, msg });
          setError(msg);
          reconcile();
          settle({ ok: false, error: msg });
        };

        const attempt = (triesLeft: number) => {
          const s = socketRef.current;
          // Never queue onto a dead socket: the send could land later with no
          // ack to prove it — exactly the silent-drop this pipeline prevents.
          if (!s || !s.connected || !connectedRef.current) {
            setSendingAction(null);
            fail(`⚠ ${label} not sent — you are offline. Reconnecting and resyncing from the server; try again once you're back.`);
            return;
          }
          setSendingAction(label);
          s.timeout(ACK_TIMEOUT_MS).emit(event, { ...payload, requestId }, (err?: Error, res?: ActionAck) => {
            if (settled) return;
            if (!err && res && res.ok !== false) {
              settle({ ok: true });
              return;
            }
            if (!err && res && res.ok === false) {
              // Game rules rejected it — show the server's actual reason.
              console.warn('[action] rejected by server', { event, requestId, error: res.error });
              setError(res.error ?? `${label} rejected by the server`);
              reconcile();
              settle({ ok: false, error: res.error });
              return;
            }
            // Timeout — no server confirmation. Retry with backoff.
            if (triesLeft > 0) {
              window.setTimeout(() => attempt(triesLeft - 1), ACK_RETRY_DELAYS_MS[ACK_RETRY_DELAYS_MS.length - triesLeft] ?? 1200);
            } else {
              fail(`⚠ ${label} not confirmed by the server. Re-syncing from the server snapshot — check whether it recorded your ${label.toLowerCase()} before trying again.`);
            }
          });
        };

        attempt(ACK_RETRY_DELAYS_MS.length);
      });
    },
    [],
  );

  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const clearRoomExpired = useCallback(() => {
    setRoomExpired(null);
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
    connectedRef.current = false;
    reconnectingRef.current = true;
    forcedReconnectRef.current = true;
    console.log('[socket] manual retry attempt', { retryCount: retryCount + 1 });

    // Force a fresh connection so a half-dead socket actually drops.
    try { s.disconnect(); } catch {}
    window.setTimeout(() => { try { s.connect(); } catch {} }, 0);
  }, [clearRetryTimeout]);

  useEffect(() => {
    const s = io(SERVER_URL, { 
      autoConnect: true, 
      reconnection: true, 
      reconnectionAttempts: 50,        // more attempts for mobile background/foreground
      reconnectionDelay: 1000,         // faster initial retry
      reconnectionDelayMax: 30000,     // up to 30s between retries
      randomizationFactor: 0.5,        // jitter to avoid thundering herd
      timeout: 60000,                  // longer connection timeout
      transports: ['websocket', 'polling'], // try websocket first
      // Mobile: don't close on background - wait for visibility change
      // Socket.io client handles this via document.visibilityState
    });
    socketRef.current = s;
    setSocket(s);

    setConnectionStatus('connecting');
    setConnectError('Connecting to server...');
    console.log('[socket] connecting to', SERVER_URL);

    const onConnect = () => {
      connectedRef.current = true;
      setConnected(true);
      setConnectError(null);
      setConnectionStatus('connected');
      setRetryCount(0);
      serverSleepingRef.current = false;
      console.log('[socket] connected, id:', s.id);
      if (restoreInProgressRef.current && pendingRestoreRef.current && !roomCodeRef.current) {
        // Retry an in-flight restore on a fresh connection.
        const sess = pendingRestoreRef.current;
        playerNameRef.current = sess.playerName;
        s.emit('rejoin-room', { roomCode: sess.roomCode, playerName: sess.playerName });
      } else if (reconnectingRef.current) {
        reconnectingRef.current = false;
        // Reclaim our player slot: the fresh socket has a new id, so the
        // server matches us back by room code + name and remaps everything.
        if (roomCodeRef.current && playerNameRef.current) {
          s.emit('rejoin-room', { roomCode: roomCodeRef.current, playerName: playerNameRef.current });
        } else if (roomCodeRef.current) {
          s.emit('room-state-request', { roomCode: roomCodeRef.current });
        }
      } else if (!restoreAttemptedRef.current && !roomCodeRef.current) {
        // Fresh mount (e.g. after an accidental refresh): walk back into the
        // stored session. Single attempt, with one delayed retry for the race
        // where the old socket's disconnect hasn't landed server-side yet.
        restoreAttemptedRef.current = true;
        const attemptRestore = () => {
          if (roomCodeRef.current) return; // joined manually meanwhile
          const session = readSession();
          if (!session) return;
          playerNameRef.current = session.playerName;
          pendingRestoreRef.current = session;
          restoreInProgressRef.current = true;
          setRestoreStatus('restoring');
          setRestoreChoice(null);
          console.log('[socket] restoring session for room', session.roomCode);
          s.emit('rejoin-room', { roomCode: session.roomCode, playerName: session.playerName });
        };
        attemptRestore();
        setTimeout(() => {
          if (!roomCodeRef.current && restoreInProgressRef.current) attemptRestore();
        }, 2500);
      }
      // Reset heartbeat tracking for this fresh connection.
      heartbeatDeadRef.current = false;
      lastHeartbeatSentRef.current = 0;
      lastHeartbeatAckRef.current = 0;

      // Probe immediately so a dead connection is detected quickly even if it
      // drops right after connect.
      if (s.connected && roomCodeRef.current) {
        const ts = Date.now();
        lastHeartbeatSentRef.current = ts;
        s.emit('heartbeat', { roomCode: roomCodeRef.current, timestamp: ts });
      }

      // Start heartbeat to detect dead rooms / dead sockets (Task 5).
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        if (s.connected && roomCodeRef.current) {
          const ts = Date.now();
          lastHeartbeatSentRef.current = ts;
          s.emit('heartbeat', { roomCode: roomCodeRef.current, timestamp: ts });
        }
      }, HEARTBEAT_INTERVAL_MS);

      // Watchdog: if a heartbeat goes unanswered past the timeout, treat the
      // connection as dead immediately instead of waiting for socket.io.
      if (heartbeatWatchdogRef.current) clearInterval(heartbeatWatchdogRef.current);
      heartbeatWatchdogRef.current = setInterval(() => {
        if (heartbeatDeadRef.current) return;
        if (!s.connected) return;
        if (!roomCodeRef.current) return;
        const sent = lastHeartbeatSentRef.current;
        if (!sent) return;
        if (lastHeartbeatAckRef.current >= sent) return;
        if (Date.now() - sent <= HEARTBEAT_TIMEOUT_MS) return;
        // Missed ack -> drop.
        heartbeatDeadRef.current = true;
        reconnectingRef.current = true;
        forcedReconnectRef.current = true;
        connectedRef.current = false;
        setConnected(false);
        setConnectionStatus('reconnecting');
        setConnectError('Connection lost. Reconnecting...');
        try { s.disconnect(); } catch {}
        window.setTimeout(() => { try { s.connect(); } catch {} }, 0);
      }, 1000);
    };

    // Handle visibility change: force reconnect when tab becomes visible
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && s && !s.connected) {
        console.log('[socket] tab became visible, forcing reconnect');
        s.connect();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    const onDisconnect = (reason: string) => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (heartbeatWatchdogRef.current) {
        clearInterval(heartbeatWatchdogRef.current);
        heartbeatWatchdogRef.current = null;
      }
      const forced = forcedReconnectRef.current;
      forcedReconnectRef.current = false;
      connectedRef.current = false;
      setConnected(false);
      console.log('[socket] disconnected:', reason, { forced });

      // A forced reconnect (heartbeat drop / manual retry) must never wipe the
      // room or look like a user-initiated leave.
      if (forced) {
        reconnectingRef.current = true;
        setConnectionStatus('reconnecting');
        setConnectError('Connection lost. Reconnecting...');
        return;
      }

      reconnectingRef.current = true;
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
      setRoomExpired(null);
      // Persist so an accidental refresh can walk straight back in.
      if (playerNameRef.current) saveSession(code, playerNameRef.current);
      // Restore success: the server snapshot is authoritative — say so briefly
      // instead of silently rewriting any frozen/stale client state.
      if (restoreInProgressRef.current) {
        restoreInProgressRef.current = false;
        pendingRestoreRef.current = null;
        setRestoreStatus('restored');
        setRestoreChoice(null);
        setResyncNotice('Resynced to the latest server state');
        window.setTimeout(() => setResyncNotice(null), 3000);
      }
    };
    const onRoomState = (state: RoomState) => {
      setRoomState(state);
      // Clear reveal when moving to a new round's role-reveal phase
      if (state.phase === 'role-reveal') {
        setRoundReveal(null);
        setMyRole(null);
      }
    };
    // Slim high-frequency missile stream: merges into the current room state
    // (FIFO with room-state is guaranteed on one socket, see mcTick.ts).
    const onMcTick = (payload: MissileTickPayload) => {
      setRoomState(prev => (prev ? applyMissileTick(prev, payload) : prev));
    };
    const onRole = (role: RoleData) => setMyRole(role);
    const onReveal = (data: RoundRevealData) => setRoundReveal(data);
    const onError = (msg: unknown) => {
      const message = typeof msg === 'string' ? msg : (msg as { message?: string })?.message ?? JSON.stringify(msg);
      setError(message);
      if (restoreInProgressRef.current) {
        restoreInProgressRef.current = false;
        const sess = pendingRestoreRef.current;
        pendingRestoreRef.current = null;
        setRestoreStatus('failed');
        if (sess) {
          setRestoreChoice({ roomCode: sess.roomCode, playerName: sess.playerName, reason: message });
        } else {
          const stored = readSession();
          if (stored) setRestoreChoice({ roomCode: stored.roomCode, playerName: stored.playerName, reason: message });
        }
      }
    };
    const onKicked = ({ roomCode: code }: { roomCode: string }) => {
      setInRoom(false);
      setRoomState(null);
      setMyRole(null);
      setRoundReveal(null);
      setRoomCode(code ?? '');
      clearSession();
      setError('You were kicked from the lobby by the host');
    };
     const onMembershipLost = ({ roomCode: code, reason }: { roomCode?: string; reason?: string }) => {
       const c = code ?? roomCodeRef.current ?? '';
       setInRoom(false);
       setRoomState(null);
       setMyRole(null);
       setRoundReveal(null);
       setRoomCode(c);
       setError(reason || 'You are no longer in this match. Rejoin with your name to continue.');
     };
    const onEndVoteFailed = ({ declinedBy }: { declinedBy: string }) => {
      setError(`${declinedBy} voted to keep playing — end-game vote failed`);
    };
    const onHostChanged = ({ newHostName }: { newHostId: string; newHostName?: string }) => {
      setError(`Host changed — ${newHostName || 'a new player'} is now the host`);
    };
    const onRoomExpired = ({ roomCode: code, reason }: { roomCode: string; reason: string }) => {
      console.log('[socket] room expired:', { code, reason });
      setRoomExpired({ roomCode: code, reason });
      setInRoom(false);
      setRoomState(null);
      setMyRole(null);
      setRoundReveal(null);
      setRoomCode(code ?? '');
      clearSession();
      if (restoreInProgressRef.current) {
        restoreInProgressRef.current = false;
        const sess = pendingRestoreRef.current;
        pendingRestoreRef.current = null;
        setRestoreStatus('failed');
        setRestoreChoice({ roomCode: code, playerName: sess?.playerName || '', reason: `Room ${code} no longer exists (${reason}).` });
      }
      // Landing on the landing page must say why — otherwise an expiry
      // looks identical to never having joined.
      setError(`Room ${code} no longer exists (${reason}). Create a new room.`);
    };
    const onServerHello = ({ bootId }: { bootId: string }) => {
      if (!bootId) return;
      if (bootIdRef.current && bootIdRef.current !== bootId) {
        console.log('[socket] server restarted (bootId changed), dropping stale room');
        if (roomCodeRef.current) {
          setError('Server restarted — your room was lost. Create a new room.');
        }
        setInRoom(false);
        setRoomState(null);
        setMyRole(null);
        setRoundReveal(null);
        setRoomCode('');
        roomCodeRef.current = '';
        setRoomExpired(null);
        clearSession();
      }
      bootIdRef.current = bootId;
    };

    const onHeartbeatAck = ({ clientTimestamp }: { serverTime?: number; clientTimestamp?: number }) => {
      const ts = clientTimestamp || Date.now();
      if (ts > lastHeartbeatAckRef.current) lastHeartbeatAckRef.current = ts;
      heartbeatDeadRef.current = false;
      if (s.connected) {
        connectedRef.current = true;
        setConnected(true);
        setConnectionStatus('connected');
        setConnectError(null);
      }
    };
    s.on('connect', onConnect);
    s.on('server-hello', onServerHello);
    s.on('heartbeat-ack', onHeartbeatAck);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', onConnectError);
    s.on('room-joined', onRoomJoined);
    s.on('room-state', onRoomState);
    s.on('mc-tick', onMcTick);
    s.on('your-role', onRole);
    s.on('round-reveal', onReveal);
    s.on('error', onError);
    s.on('kicked', onKicked);
    s.on('membership-lost', onMembershipLost);
    s.on('end-vote-failed', onEndVoteFailed);
    s.on('host-changed', onHostChanged);
    s.on('room-expired', onRoomExpired);

    return () => {
      clearRetryTimeout();
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (heartbeatWatchdogRef.current) {
        clearInterval(heartbeatWatchdogRef.current);
        heartbeatWatchdogRef.current = null;
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
      s.off('connect', onConnect);
      s.off('server-hello', onServerHello);
      s.off('heartbeat-ack', onHeartbeatAck);
      s.off('disconnect', onDisconnect);
      s.off('connect_error', onConnectError);
      s.off('room-joined', onRoomJoined);
      s.off('room-state', onRoomState);
      s.off('mc-tick', onMcTick);
      s.off('your-role', onRole);
      s.off('round-reveal', onReveal);
      s.off('error', onError);
      s.off('kicked', onKicked);
      s.off('membership-lost', onMembershipLost);
      s.off('end-vote-failed', onEndVoteFailed);
      s.off('host-changed', onHostChanged);
      s.off('room-expired', onRoomExpired);
      s.disconnect();
      socketRef.current = null;
    };
  }, [handleServerSleeping, handleConnectionFailure, clearRetryTimeout]);

  const clearError = useCallback(() => setError(null), []);

  const retryRestore = useCallback(() => {
    const sess = restoreChoice || readSession();
    if (!sess?.roomCode || !sess?.playerName) return;
    pendingRestoreRef.current = { roomCode: sess.roomCode, playerName: sess.playerName };
    playerNameRef.current = sess.playerName;
    restoreInProgressRef.current = true;
    setRestoreStatus('restoring');
    setRestoreChoice(null);
    const s = socketRef.current;
    if (s?.connected) {
      s.emit('rejoin-room', { roomCode: sess.roomCode, playerName: sess.playerName });
    } else {
      retryConnection();
    }
  }, [restoreChoice, retryConnection]);

  const dismissRestoreChoice = useCallback(() => {
    restoreInProgressRef.current = false;
    pendingRestoreRef.current = null;
    setRestoreChoice(null);
    setRestoreStatus('idle');
    setInRoom(false);
    setRoomState(null);
    setMyRole(null);
    setRoundReveal(null);
    setRoomCode('');
    roomCodeRef.current = '';
    playerNameRef.current = '';
    clearSession();
  }, [clearSession]);

  const clearResyncNotice = useCallback(() => setResyncNotice(null), []);

  const createRoom = useCallback((playerName: string) => {
    playerNameRef.current = playerName;
    restoreInProgressRef.current = false;
    pendingRestoreRef.current = null;
    setRestoreChoice(null);
    setRestoreStatus('idle');
    socketRef.current?.emit('create-room', { playerName });
  }, []);

  const joinRoom = useCallback((code: string, playerName: string) => {
    playerNameRef.current = playerName;
    restoreInProgressRef.current = false;
    pendingRestoreRef.current = null;
    setRestoreChoice(null);
    setRestoreStatus('idle');
    socketRef.current?.emit('join-room', { roomCode: code, playerName });
  }, []);

  const startGame = useCallback((code: string) =>
    sendAction('start-game', { roomCode: code }, 'Start game'), [sendAction]);

  const submitSignal = useCallback((code: string, signal: string) =>
    sendAction('submit-signal', { roomCode: code, signal }, 'Signal'), [sendAction]);

  const submitGuess = useCallback((code: string, guessData: GuessData) =>
    sendAction('submit-guess', { roomCode: code, guessData }, 'Guess'), [sendAction]);

  const nextRound = useCallback((code: string) =>
    sendAction('next-round', { roomCode: code }, 'Next round'), [sendAction]);

  // Pull a fresh authoritative snapshot (used as a fallback when a results
  // payload is missed, e.g. a reload landing on "Calculating results…").
  const requestRoomState = useCallback((code: string) => {
    const s = socketRef.current;
    if (s?.connected && code) s.emit('room-state-request', { roomCode: code });
  }, []);

  const playAgain = useCallback((code: string) =>
    sendAction('play-again', { roomCode: code }, 'Back to lobby'), [sendAction]);

  const leaveRoom = useCallback(async (code: string) => {
    const ack = await sendAction('leave-room', { roomCode: code }, 'Leave room');
    if (ack?.ok) {
      // Drop the local session immediately so a reconnect doesn't reclaim a
      // seat we just freed server-side.
      setInRoom(false);
      setRoomState(null);
      setMyRole(null);
      setRoundReveal(null);
      setRoomCode('');
      roomCodeRef.current = '';
      playerNameRef.current = '';
      clearSession();
    }
    return ack ?? { ok: false, error: 'No response' };
  }, [sendAction, clearSession]);

  const selectGame = useCallback((code: string, gameId: string) =>
    sendAction('select-game', { roomCode: code, gameId }, 'Game change'), [sendAction]);

  const updateChromaOptions = useCallback((code: string, options: Partial<ChromaOptions>) =>
    sendAction('update-chroma-options', { roomCode: code, options }, 'Options change'), [sendAction]);

  const updateTerritoryOptions = useCallback((code: string, options: Partial<TerritoryOptions>) =>
    sendAction('update-territory-options', { roomCode: code, options }, 'Options change'), [sendAction]);

  const updateLiarOptions = useCallback((code: string, options: Partial<LiarOptions>) =>
    sendAction('update-liar-options', { roomCode: code, options }, 'Options change'), [sendAction]);

  const setPlayerDifficulty = useCallback((code: string, difficulty: 'easy' | 'medium' | 'hard') =>
    sendAction('set-player-difficulty', { roomCode: code, difficulty }, 'Difficulty change'), [sendAction]);

  const submitChromaGuess = useCallback((code: string, tileIndex: number) =>
    sendAction('submit-chroma-guess', { roomCode: code, tileIndex }, 'Tile guess'), [sendAction]);

  const nextChromaRound = useCallback((code: string) =>
    sendAction('next-chroma-round', { roomCode: code }, 'Next round'), [sendAction]);

  const submitTerritoryPick = useCallback((code: string, colIndex: number) =>
    sendAction('submit-territory-pick', { roomCode: code, colIndex }, 'Column pick'), [sendAction]);

  const placeTerritoryMine = useCallback((code: string, row: number, col: number) =>
    sendAction('place-territory-mine', { roomCode: code, row, col }, 'Mine'), [sendAction]);

  const nextTerritoryTurn = useCallback((code: string) =>
    sendAction('next-territory-turn', { roomCode: code }, 'Next turn'), [sendAction]);

  const kickPlayer = useCallback((code: string, targetId: string) =>
    sendAction('kick-player', { roomCode: code, targetId }, 'Kick'), [sendAction]);

  const requestEndVote = useCallback((code: string) =>
    sendAction('request-end-vote', { roomCode: code }, 'End-game vote'), [sendAction]);

  const submitEndVote = useCallback((code: string, agree: boolean) =>
    sendAction('submit-end-vote', { roomCode: code, agree }, 'End-game vote'), [sendAction]);

  const cancelEndVote = useCallback((code: string) =>
    sendAction('cancel-end-vote', { roomCode: code }, 'End-game vote'), [sendAction]);
  const forceAdvance = useCallback((code: string) =>
    sendAction('force-advance', { roomCode: code }, 'Force advance'), [sendAction]);
  const endRound = useCallback((code: string) =>
    sendAction('end-round', { roomCode: code }, 'End round'), [sendAction]);

  const submitBlendClue = useCallback((code: string, word: string) =>
    sendAction('submit-blend-clue', { roomCode: code, word }, 'Clue'), [sendAction]);

  const submitBlendVote = useCallback((code: string, targetId: string) =>
    sendAction('submit-blend-vote', { roomCode: code, targetId }, 'Vote'), [sendAction]);

  const submitBlendGuess = useCallback((code: string, guess: string) =>
    sendAction('submit-blend-guess', { roomCode: code, guess }, 'Word guess'), [sendAction]);

  const nextBlendRound = useCallback((code: string) =>
    sendAction('next-blend-round', { roomCode: code }, 'Next round'), [sendAction]);

  const submitLiarBid = useCallback((code: string, qty: number, face: number) =>
    sendAction('submit-liar-bid', { roomCode: code, qty, face }, 'Bid'), [sendAction]);

  const submitLiarCall = useCallback((code: string, kind: 'liar' | 'exact') =>
    sendAction('submit-liar-call', { roomCode: code, kind }, 'Challenge'), [sendAction]);

  const nextLiarRound = useCallback((code: string) =>
    sendAction('next-liar-round', { roomCode: code }, 'Next round'), [sendAction]);

  const submitBluffAction = useCallback((code: string, action: BluffAction) =>
    sendAction('submit-bluff-action', { roomCode: code, action }, 'Bet'), [sendAction]);

  const nextBluffRound = useCallback((code: string) =>
    sendAction('next-bluff-round', { roomCode: code }, 'Next round'), [sendAction]);

  // Missile Command
  const buildMissileBuilding = useCallback((code: string, action: MissileBuildAction) =>
    sendAction('build-missile-building', { roomCode: code, action }, 'Build'), [sendAction]);

  const upgradeMissileBuilding = useCallback((code: string, action: MissileUpgradeAction) =>
    sendAction('upgrade-missile-building', { roomCode: code, action }, 'Upgrade'), [sendAction]);

  const sellMissileBuilding = useCallback((code: string, action: MissileUpgradeAction) =>
    sendAction('sell-missile-building', { roomCode: code, buildingId: action.buildingId }, 'Sell'), [sendAction]);

  const cancelMissileSell = useCallback((code: string, action: MissileUpgradeAction) =>
    sendAction('cancel-missile-sell', { roomCode: code, buildingId: action.buildingId }, 'Cancel sale'), [sendAction]);

  const rebuildRubble = useCallback((code: string, rubbleId: string) =>
    sendAction('rebuild-rubble', { roomCode: code, rubbleId }, 'Rebuild'), [sendAction]);

  const launchMissile = useCallback((code: string, action: MissileLaunchAction) =>
    sendAction('launch-missile', { roomCode: code, action }, 'Launch'), [sendAction]);

  // NOTE: most missile emits nest args under `action`; these two spread
  // instead. The server defensively accepts both shapes (see the
  // launch-missile-type / fire-desperation handlers in server/index.js),
  // so keep them as-is unless both sides change together.
  const launchMissileType = useCallback((code: string, action: MissileTypeLaunchAction) =>
    sendAction('launch-missile-type', { roomCode: code, ...action }, 'Launch'), [sendAction]);

  const loadMissile = useCallback((code: string, action: MissileLoadAction) =>
    sendAction('load-missile', { roomCode: code, launcherId: action.launcherId }, 'Load'), [sendAction]);

  const setKeepFire = useCallback((code: string, action: MissileKeepFireAction) =>
    sendAction('set-keep-fire', { roomCode: code, action }, 'Keep-fire'), [sendAction]);

  const fireDesperation = useCallback((code: string, action: MissileDesperationAction) =>
    sendAction('fire-desperation', { roomCode: code, ...action }, 'Desperation fire'), [sendAction]);

  const claimSupplyShip = useCallback((code: string) =>
    sendAction('claim-supply-ship', { roomCode: code }, 'Freighter claim'), [sendAction]);

  const updateMissileCommandOptions = useCallback((code: string, options: Partial<MissileCommandOptions>) =>
    sendAction('update-missile-command-options', { roomCode: code, options }, 'Options change'), [sendAction]);

  return {
    socket,
    connected,
    connectionStatus,
    connectError,
    retryCount,
    connectStartedAt,
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
    endRound,
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
    retryConnection,
    // Missile Command
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
  };
}
