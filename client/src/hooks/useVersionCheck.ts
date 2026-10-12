import { useEffect, useState } from 'react';
import { PROTOCOL_VERSION } from '../buildInfo';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
const CHECK_INTERVAL_MS = 30000;

/**
 * Polls the server's /health endpoint and compares its protocolVersion with
 * the one embedded in this client bundle at build time. A mismatch means the
 * server was redeployed with a new client↔server contract (new events, state
 * shape, options) while this tab still runs the old bundle — game actions may
 * silently fail. Checked on mount, every 30s, and whenever the tab becomes
 * visible again (the mobile background/foreground case).
 */
export function useVersionCheck() {
  const [serverVersion, setServerVersion] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`${SERVER_URL}/health`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && typeof data.protocolVersion === 'number') {
          setServerVersion(data.protocolVersion);
        }
      } catch {
        // Offline/unreachable — the connection UI already covers that case.
      }
    };
    check();
    const id = setInterval(check, CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return {
    serverVersion,
    mismatch: serverVersion !== null && serverVersion !== PROTOCOL_VERSION,
  };
}
