// Per-tab room session persistence (survives reloads, never shared across
// tabs — so a second tab can never steal this slot on auto-restore).

export const SESSION_KEY = 'hs-session';

export interface RoomSession {
  roomCode: string;
  playerName: string;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): StorageLike | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function saveRoomSession(code: string, name: string): void {
  try {
    storage()?.setItem(SESSION_KEY, JSON.stringify({ roomCode: code, playerName: name }));
  } catch {
    // private mode — rejoin just won't survive reload
  }
}

export function clearRoomSession(): void {
  try {
    storage()?.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export function readRoomSession(): RoomSession | null {
  try {
    const raw = storage()?.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.roomCode === 'string' && typeof parsed?.playerName === 'string') {
      return { roomCode: parsed.roomCode, playerName: parsed.playerName };
    }
    return null;
  } catch {
    return null;
  }
}
