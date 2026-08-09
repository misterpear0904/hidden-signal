import React, { useEffect, useState, useCallback } from 'react';

interface Props {
  endTime: number;
  color?: 'purple' | 'amber';
}

export default function TimerBar({ endTime, color = 'purple' }: Props) {
  const totalMs = useCallback(() => {
    // We don't know the original duration exactly from just endTime,
    // so we store the first render's remaining as total
    return Math.max(endTime - Date.now(), 0);
  }, [endTime]);

  const [pct, setPct] = useState(100);
  const [secsLeft, setSecsLeft] = useState(0);
  const [initialMs] = useState(() => Math.max(endTime - Date.now(), 1000));

  useEffect(() => {
    const update = () => {
      const remaining = Math.max(endTime - Date.now(), 0);
      setPct((remaining / initialMs) * 100);
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
