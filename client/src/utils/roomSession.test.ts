// Unit tests for per-tab room session persistence.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SESSION_KEY,
  saveRoomSession,
  readRoomSession,
  clearRoomSession,
} from './roomSession';

function mockStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('sessionStorage', mockStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('roomSession', () => {
  it('round-trips room code and player name', () => {
    saveRoomSession('ABCD', 'ALPHA');
    expect(readRoomSession()).toEqual({ roomCode: 'ABCD', playerName: 'ALPHA' });
  });

  it('overwrites the previous session', () => {
    saveRoomSession('ABCD', 'ALPHA');
    saveRoomSession('WXYZ', 'BRAVO');
    expect(readRoomSession()).toEqual({ roomCode: 'WXYZ', playerName: 'BRAVO' });
  });

  it('clear removes the session', () => {
    saveRoomSession('ABCD', 'ALPHA');
    clearRoomSession();
    expect(readRoomSession()).toBeNull();
  });

  it('returns null when nothing is stored', () => {
    expect(readRoomSession()).toBeNull();
  });

  it('rejects garbage payloads', () => {
    sessionStorage.setItem(SESSION_KEY, 'not-json{{{');
    expect(readRoomSession()).toBeNull();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode: 'ABCD' }));
    expect(readRoomSession()).toBeNull();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode: 123, playerName: 'X' }));
    expect(readRoomSession()).toBeNull();
  });

  it('survives missing or throwing storage', () => {
    vi.stubGlobal('sessionStorage', undefined);
    expect(readRoomSession()).toBeNull();
    expect(() => saveRoomSession('A', 'B')).not.toThrow();
    expect(() => clearRoomSession()).not.toThrow();
  });
});
