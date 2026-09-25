import { useEffect, useState } from 'react';

interface Props {
  endTime: number;
  color?: 'purple' | 'amber';
}

export default function TimerBar({ endTime, color = 'purple' }: Props) {
  const [pct, setPct] = useState(100);
  const [secsLeft, setSecsLeft] = useState(0);
  const [initialMs, setInitialMs] = useState(() => Math.max(endTime - Date.now(), 1000));

  // Reset denominator when phase/round changes
  useEffect(() => {
    setInitialMs(Math.max(endTime - Date.now(), 1000));
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

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <span className="text-xs text-muted">Time remaining</span>
        <span
          className="text-mono text-sm"
          role="timer"
          aria-live="off"
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
