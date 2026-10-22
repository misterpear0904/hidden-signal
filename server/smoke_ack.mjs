// Smoke test for Task 1 (server-acknowledged actions) — drives the REAL server
// + socket.io wire protocol over raw WebSocket frames:
//   engine.io open "0", namespace connect "40", event "42[...]",
//   event-with-ack "42<id>[...]", server ack reply "43<id>[...]".
// Proves end-to-end: game actions ack { ok }, duplicate requestIds replay the
// stored result without re-applying, rejections ack { ok:false, error }, and
// legacy emits without an ack callback still run the handler.
//
// Usage: node smoke_ack.mjs   (VERBOSE=1 node smoke_ack.mjs for frame traces)
import { spawn } from 'node:child_process';
import WebSocket from './node_modules/ws/index.js';

const PORT = 3999;
const VERBOSE = process.env.VERBOSE === '1';
const frameLog = (...a) => { if (VERBOSE) console.log(...a); };

process.env.PORT = String(PORT);
process.env.NODE_ENV = 'test';

const serverOut = [];
const server = spawn(process.execPath, ['index.js'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ['ignore', VERBOSE ? 'inherit' : 'pipe', 'inherit'],
});
server.stdout?.on('data', (d) => serverOut.push(d.toString()));

const results = [];
const check = (name, cond) => { results.push(cond); console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}`); };

let ackSeq = 0;

function makeClient(name = 'client') {
  let ws = null;
  let engineOpened = false;
  let nsRequested = false;
  const frames = [];   // unconsumed backlog
  const waiters = [];

  const deliver = (packet) => {
    frames.push(packet);
    let consumed = false;
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i];
      if (w.matcher(packet)) {
        if (waiters[i] === w) waiters.splice(i, 1); // matcher may already have self-cleaned
        consumed = true;
        w.resolve?.(packet);
      }
    }
    if (consumed) frames.splice(frames.indexOf(packet), 1); // don't leave stale duplicates
  };

  const handleData = (d) => {
    const packet = d.toString('utf8');
    frameLog(`[frame ${name}]`, packet.slice(0, 90));
    if (!packet) return;
    if (packet.startsWith('0')) {
      engineOpened = true; // engine.io handshake — now request the namespace
      return;
    }
    deliver(packet);
  };

  const start = () => new Promise((resolve) => {
    ws = new WebSocket(`ws://localhost:${PORT}/socket.io/?EIO=4&transport=websocket`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    ws.on('message', handleData);
    frameLog(`[ws ${name}] connecting`);
    resolve(); // connection failures surface as frame timeouts below
  });

  // EIO4/socket.io v4: request the default namespace once the engine.io
  // handshake lands; success = server's `40{sid}` reply.
  const connectNs = () => new Promise((resolve, reject) => {
    const iv = setInterval(() => {
      if (engineOpened && !nsRequested) { nsRequested = true; frameLog(`[tx ${name}] 40`); ws.send('40'); }
      if (nsRequested && frames.some(f => f.startsWith('40'))) { clearInterval(iv); resolve(); }
    }, 40);
    setTimeout(() => { clearInterval(iv); reject(new Error(`ns connect timeout (${name})`)); }, 6000);
  });

  const next = (matcher, ms = 5000) => new Promise((resolve, reject) => {
    // Drain: a frame that already arrived (e.g. while another readState was
    // pending) may be sitting in the backlog — consume the newest match first.
    for (let i = frames.length - 1; i >= 0; i--) {
      if (matcher(frames[i])) {
        const hit = frames[i];
        frames.splice(i, 1);
        return resolve(hit);
      }
    }
    const waiter = { resolve: null, matcher: () => false };
    let t = null;
    waiter.matcher = (f) => { if (matcher(f)) { if (t) clearTimeout(t); waiter.resolve?.(f); return true; } return false; };
    t = setTimeout(() => { const ix = waiters.indexOf(waiter); if (ix !== -1) waiters.splice(ix, 1); reject(new Error('frame timeout')); }, ms);
    waiter.resolve = resolve;
    waiters.push(waiter);
  });

  // Emit WITHOUT ack callback (legacy path — must not crash handlers).
  const emit = (event, payload) => {
    const wire = `42${JSON.stringify([event, payload])}`;
    frameLog(`[tx ${name}] ${wire.slice(0, 110)}`);
    ws.send(wire);
  };

  // Emit WITH ack callback; resolves the server's ack payload.
  const emitAck = (event, payload) => {
    const id = ++ackSeq;
    const wire = `42${id}${JSON.stringify([event, payload])}`;
    frameLog(`[tx ${name}] ${wire.slice(0, 110)}`);
    ws.send(wire);
    return next((f) => f.startsWith(`43${id}`)).then((f) => {
      let args = f.slice(`43${id}`.length);
      try { args = JSON.parse(args); } catch { /* string payload */ }
      return Array.isArray(args) ? args[0] : args;
    });
  };

  // Consume the next room-state broadcast addressed to us.
  const readState = () => next((mf) => mf.startsWith('42') && mf.includes('"room-state"'))
    .then((f) => JSON.parse(f.slice(f.indexOf('[')))[1]);

  return { start, connectNs, emit, emitAck, readState };
}

// ── boot the real server, waiting for its "Server started" log line ─────
let code = 1;
try {
  const bootWait = new Promise((resolve, reject) => {
    const iv = setInterval(() => {
      if (serverOut.some(t => t.includes('Server started'))) { clearInterval(iv); resolve(); }
    }, 50);
    setTimeout(() => { clearInterval(iv); reject(new Error('server boot timeout')); }, 8000);
  });
  await bootWait;

  const host = makeClient('host');
  const guest = makeClient('guest');
  await host.start(); await host.connectNs();
  await guest.start(); await guest.connectNs();

  // ── connect two seats (host creates, guest joins) ─────────────────────
  host.emit('create-room', { playerName: 'HOST-1' });
  const state0 = await host.readState();
  const roomCode = state0.code;
  console.log('room', roomCode);

  guest.emit('join-room', { roomCode, playerName: 'GUEST-A' });
  await guest.readState();
  await host.readState();

  // ── 1. successful action acks ok ──────────────────────────────────────
  const ack1 = await host.emitAck('select-game', { roomCode, gameId: 'chroma-shift', requestId: 's1' });
  check('select-game ack ok:true', ack1 && ack1.ok === true);

  // ── 2. duplicate requestId replays stored ok WITHOUT applying again ───
  const ack2 = await host.emitAck('select-game', { roomCode, gameId: 'liar-dice', requestId: 's1' });
  check('duplicate action replays ok + duplicate flag',
    ack2 && ack2.ok === true && ack2.duplicate === true);
  // Replay must NOT have changed the game: still chroma-shift.
  const hostState = await host.readState();
  check('duplicate did not re-apply (game unchanged)', hostState.selectedGameId === 'chroma-shift');

  // ── 3. rejection acks ok:false with the real reason ───────────────────
  const ack3 = await guest.emitAck('start-game', { roomCode, requestId: 's2' });
  check('non-host start rejected via ack',
    ack3 && ack3.ok === false && ack3.error === 'Only the host can start');

  // ── 4. duplicate of a rejection replays the stored error ──────────────
  const ack4 = await guest.emitAck('start-game', { roomCode, requestId: 's2' });
  check('rejected duplicate replays error + duplicate flag',
    ack4 && ack4.ok === false && ack4.error === 'Only the host can start' && ack4.duplicate === true);

  // ── 5. legacy emits without ack callback still work handler-side ──────
  guest.emit('kick-player', { roomCode, targetId: 'nobody' });   // rejected, ack-free
  host.emit('update-chroma-options', { roomCode, options: { fairPoints: true } }); // no ack — must still apply
  const hostState2 = await host.readState();
  check('handler without ack still runs', hostState2.chromaOptions?.fairPoints === true);

  code = results.every(Boolean) ? 0 : 1;
  console.log(code === 0 ? 'SMOKE OK' : 'SMOKE FAILED');
} catch (e) {
  console.error('smoke error', e?.message ?? e);
  code = 1;
} finally {
  try { server.kill(); } catch {}
  setTimeout(() => process.exit(code), 200);
}
