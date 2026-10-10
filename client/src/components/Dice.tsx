// Dice.tsx — platform-independent pip dice (emoji dice render black on
// some platforms). Used by Liar's Dice bid + reveal phases.

const PIPS: Record<number, Array<[number, number]>> = {
  1: [[2, 2]],
  2: [[1, 1], [3, 3]],
  3: [[1, 1], [2, 2], [3, 3]],
  4: [[1, 1], [1, 3], [3, 1], [3, 3]],
  5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
  6: [[1, 1], [1, 3], [2, 1], [2, 3], [3, 1], [3, 3]],
};

const FACE_COLORS = [
  '#ef4444', // 1 - red
  '#14b8a6', // 2 - teal
  '#eab308', // 3 - yellow
  '#22c55e', // 4 - green
  '#ec4899', // 5 - pink
  '#8b5cf6', // 6 - purple
];

export function PipDice({ value, size = 56 }: { value: number; size?: number }) {
  const pips = PIPS[value] ?? [];
  const color = FACE_COLORS[value - 1] ?? '#888';
  const dot = Math.max(4, Math.round(size * 0.16));
  return (
    <div
      role="img"
      aria-label={`Die showing ${value}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(6, Math.round(size * 0.18)),
        background: '#f8fafc',
        border: `3px solid ${color}`,
        boxShadow: `0 0 12px ${color}55, 0 4px 10px rgba(0,0,0,0.4)`,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'repeat(3, 1fr)',
        padding: Math.round(size * 0.12),
        boxSizing: 'border-box',
        flexShrink: 0,
      }}
    >
      {Array.from({ length: 9 }).map((_, i) => {
        const r = Math.floor(i / 3) + 1;
        const c = (i % 3) + 1;
        const on = pips.some(([pr, pc]) => pr === r && pc === c);
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {on && <div style={{ width: dot, height: dot, borderRadius: '50%', background: '#0f172a' }} />}
          </div>
        );
      })}
    </div>
  );
}

export function sortDiceAsc(dice: number[]): number[] {
  return [...dice].sort((a, b) => a - b);
}
