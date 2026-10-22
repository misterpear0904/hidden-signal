import { useEffect, useRef, useState } from 'react';

interface Props {
  endTime: number;
  color?: 'purple' | 'amber';
}

export default function TimerBar({ endTime, color = 'purple' }: Props) {
  const [pct, setPct] = useState(100);
  const [secsLeft, setSecsLeft] = useState(0);
  const [initialMs, setInitialMs] = useState(() => Math.max(endTime - Date.now(), 1000));
  const beepedRef = useRef(false);

  // Reset denominator when phase/round changes
  useEffect(() => {
    setInitialMs(Math.max(endTime - Date.now(), 1000));
    beepedRef.current = false;
  }, [endTime]);

  useEffect(() => {
    const update = () => {
      const remaining = Math.max(endTime - Date.now(), 0);
      setPct(Math.min(100, Math.max(0, (remaining / initialMs) * 100)));
      setSecsLeft(Math.ceil(remaining / 1000));
    };
    update();
    const interval = setInterval(update, 250);
    return () => clearInterval(interval);
  }, [endTime, initialMs]);

  const isUrgent = secsLeft <= 10;
  const isCritical = secsLeft <= 5 && secsLeft > 0;

  // Distinct end-of-phase cue in the last 5s: one short beep (best effort,
  // silently skipped when audio is unavailable or blocked).
  useEffect(() => {
    if (!isCritical || beepedRef.current) return;
    beepedRef.current = true;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
      osc.onended = () => { void ctx.close().catch(() => {}); };
    } catch {
      /* audio unavailable — visual flash still applies */
    }
  }, [isCritical]);

  return (
    <div className={isCritical ? 'timer-critical' : undefined} role="timer" aria-live="off" aria-label={`${secsLeft} seconds remaining`}>
      <div className="flex justify-between items-center mb-8">
        <span className="text-xs text-muted">Time remaining</span>
        <span
          className="text-mono text-sm"
          style={{
            color: isUrgent ? 'var(--rose-400)' : color === 'purple' ? 'var(--purple-400)' : 'var(--amber-400)',
            fontWeight: 700,
            transition: 'color 0.3s',
          }}
        >
          {secsLeft}s
        </span>
      </div>
      <div className="timer-bar-wrap">
        <div
          className={`timer-bar ${color === 'purple' ? 'timer-bar-purple' : 'timer-bar-amber'}`}
          style={{
            width: `${pct}%`,
            background: isUrgent ? 'linear-gradient(90deg, var(--rose-500), var(--rose-400))' : undefined,
          }}
        />
      </div>
    </div>
  );
}
