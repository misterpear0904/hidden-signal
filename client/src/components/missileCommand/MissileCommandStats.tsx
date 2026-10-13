// missileCommand/MissileCommandStats.tsx — SILO'D post-game breakdown for Missile Command.
// Pure SVG/div charts (no chart dependency). Remove this file to remove the report.

import { Fragment } from 'react';
import type { MissileCommandState, MissilePlayerStats, Player } from '../../types/game';

export function emptyStats(): MissilePlayerStats {
  return {
    damageDealt: 0,
    shieldAbsorbedByEnemy: 0,
    shieldBlocked: 0,
    structureDamage: 0,
    coreDamage: 0,
    missilesLaunched: 0,
    volleys: 0,
    buildingsBuilt: 0,
    buildingsLost: 0,
    buildingsDestroyed: 0,
    buildingsSold: 0,
    incomeEconomy: 0,
    incomeCore: 0,
    incomeSupply: 0,
    supplyClaims: 0,
    shieldHealed: 0,
  };
}

export function statsOf(mc: MissileCommandState | null | undefined, pid: string): MissilePlayerStats {
  const s = mc?.stats?.[pid];
  return s ? { ...emptyStats(), ...s } : emptyStats();
}

export function totalIncome(s: MissilePlayerStats): number {
  return (s.incomeEconomy ?? 0) + (s.incomeCore ?? 0) + (s.incomeSupply ?? 0);
}

export function matchDurationSec(mc: MissileCommandState): number {
  const end = mc.gameEndTime ?? Date.now();
  return Math.max(0, Math.round((end - (mc.gameStartTime ?? end)) / 1000));
}

export interface IncomePoint { t: number; top: number; bottom: number; }

// Normalized income-rate series for the post-game chart. Tolerates short,
// missing, or malformed histories (old servers predate tracking).
export function incomeSeries(mc: MissileCommandState | null | undefined): IncomePoint[] {
  const raw = mc?.incomeHistory?.samples ?? [];
  const out: IncomePoint[] = [];
  for (const s of raw) {
    if (!Array.isArray(s) || s.length < 3) continue;
    const t = Number(s[0]), top = Number(s[1]), bottom = Number(s[2]);
    if (!Number.isFinite(t) || !Number.isFinite(top) || !Number.isFinite(bottom)) continue;
    out.push({ t: Math.max(0, t), top: Math.max(0, top), bottom: Math.max(0, bottom) });
  }
  return out;
}

function IncomeChart({ mc, topName, botName }: { mc: MissileCommandState; topName: string; botName: string }) {
  const series = incomeSeries(mc);
  if (series.length === 0) {
    return <div className="text-xs text-muted">Income history unavailable for this match.</div>;
  }
  // Cap rendered points so marathon games stay a cheap polyline.
  const stride = Math.max(1, Math.ceil(series.length / 240));
  const pts = series.filter((_, i) => i % stride === 0 || i === series.length - 1);
  const maxT = Math.max(matchDurationSec(mc), pts[pts.length - 1].t, 1);
  const maxV = Math.max(1, ...pts.map(p => Math.max(p.top, p.bottom)));
  const yMax = Math.ceil(maxV * 1.15);
  const W = 480, H = 150, padL = 36, padB = 20, padT = 10, padR = 10;
  const iw = W - padL - padR, ih = H - padT - padB;
  const x = (t: number) => padL + (Math.min(t, maxT) / maxT) * iw;
  const y = (v: number) => padT + ih - (Math.min(v, yMax) / yMax) * ih;
  const last = pts[pts.length - 1];
  const gridVals = [0, yMax / 2, yMax];
  return (
    <div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: '0.78rem', fontWeight: 700, marginBottom: 6 }}>
        <span style={{ color: '#22d3ee' }}>● {topName} — {last.top.toFixed(1)}/s</span>
        <span style={{ color: '#fb7185' }}>● {botName} — {last.bottom.toFixed(1)}/s</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }} role="img" aria-label={`Income per second over time for ${topName} versus ${botName}`}>
        {gridVals.map(v => (
          <Fragment key={v}>
            <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
            <text x={padL - 5} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="rgba(255,255,255,0.55)">{v >= 10 ? Math.round(v) : v.toFixed(1)}</text>
          </Fragment>
        ))}
        {[0, maxT / 2, maxT].map(t => (
          <text key={t} x={x(t)} y={H - 5} textAnchor="middle" fontSize={10} fill="rgba(255,255,255,0.55)">{formatDuration(Math.round(t))}</text>
        ))}
        <polyline points={pts.map(p => `${x(p.t).toFixed(1)},${y(p.bottom).toFixed(1)}`).join(' ')} fill="none" stroke="#fb7185" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={pts.map(p => `${x(p.t).toFixed(1)},${y(p.top).toFixed(1)}`).join(' ')} fill="none" stroke="#22d3ee" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(last.t)} cy={y(last.bottom)} r={3.5} fill="#fb7185" />
        <circle cx={x(last.t)} cy={y(last.top)} r={3.5} fill="#22d3ee" />
      </svg>
      <div className="text-xs text-muted" style={{ marginTop: 4 }}>Income / second over the match — watch the snowball take off</div>
    </div>
  );
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function Bar({ a, b, colorA = '#22d3ee', colorB = '#fb7185' }: { a: number; b: number; colorA?: string; colorB?: string }) {
  const total = a + b;
  const pa = total > 0 ? (a / total) * 100 : 50;
  return (
    <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'rgba(255,255,255,0.08)', minWidth: 80 }}>
      <div style={{ width: `${pa}%`, background: colorA }} />
      <div style={{ width: `${100 - pa}%`, background: colorB }} />
    </div>
  );
}

function StackedBar({ parts }: { parts: Array<{ value: number; color: string }> }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total <= 0) {
    return <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.08)' }} />;
  }
  return (
    <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'rgba(255,255,255,0.08)' }}>
      {parts.map((p, i) => (
        <div key={i} title={`${fmt(p.value)}`} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
      ))}
    </div>
  );
}

interface Props {
  mc: MissileCommandState;
  players: Player[];
  myId: string;
}

export default function MissileCommandStats({ mc, players, myId }: Props) {
  const topId = mc.sides.top;
  const botId = mc.sides.bottom;
  const nameOf = (pid: string) => players.find(p => p.id === pid)?.name ?? (pid === myId ? 'You' : 'Enemy');
  const top = statsOf(mc, topId);
  const bot = statsOf(mc, botId);
  const topName = nameOf(topId);
  const botName = nameOf(botId);
  const dur = formatDuration(matchDurationSec(mc));

  const rows: Array<{
    label: string;
    get: (s: MissilePlayerStats) => number;
    format?: (n: number) => string;
    chart?: boolean;
  }> = [
    { label: 'Damage dealt (structure + core)', get: s => s.damageDealt, chart: true },
    { label: 'Core damage', get: s => s.coreDamage, chart: true },
    { label: 'Structure damage', get: s => s.structureDamage, chart: true },
    { label: 'Blocked by enemy shields', get: s => s.shieldAbsorbedByEnemy, chart: true },
  ];
  const defRows: Array<{ label: string; get: (s: MissilePlayerStats) => number }> = [
    { label: 'Shield damage blocked', get: s => s.shieldBlocked },
    { label: 'Shield HP healed', get: s => s.shieldHealed },
  ];
  const incomeRows: Array<{ label: string; get: (s: MissilePlayerStats) => number }> = [
    { label: 'Generator income', get: s => s.incomeEconomy },
    { label: 'Core income', get: s => s.incomeCore },
    { label: 'Supply credits', get: s => s.incomeSupply },
  ];

  const dmgPerMissile = (s: MissilePlayerStats) =>
    s.missilesLaunched > 0 ? (s.damageDealt + s.shieldAbsorbedByEnemy) / s.missilesLaunched : 0;

  return (
    <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '52vh', overflowY: 'auto', paddingRight: 2 }}>
      <div className="text-xs text-muted" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span>Match length {dur}</span>
        <span>Missiles {fmt(top.missilesLaunched + bot.missilesLaunched)}</span>
        <span>Buildings destroyed {top.buildingsDestroyed + bot.buildingsDestroyed}</span>
      </div>

      {/* Damage comparison */}
      <section>
        <h3 style={{ fontSize: '0.8rem', fontWeight: 800, opacity: 0.8, marginBottom: 8 }}>DAMAGE</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '6px 10px', fontSize: '0.82rem', alignItems: 'center' }}>
          <span />
          <span style={{ fontWeight: 800, color: '#22d3ee', textAlign: 'right', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis' }}>{topName}</span>
          <span style={{ fontWeight: 800, color: '#fb7185', textAlign: 'right', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis' }}>{botName}</span>
          {rows.map(r => (
            <Fragment key={r.label}>
              <span className="text-muted">{r.label}</span>
              <span style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(r.get(top))}</span>
              <span style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(r.get(bot))}</span>
            </Fragment>
          ))}
        </div>
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Bar a={top.damageDealt} b={bot.damageDealt} />
          <div className="text-xs text-muted">Damage share (structure + core)</div>
        </div>
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[top, bot].map((s, i) => (
            <div key={i}>
              <div className="text-xs text-muted" style={{ marginBottom: 4 }}>{i === 0 ? topName : botName} dealt</div>
              <StackedBar parts={[
                { value: s.coreDamage, color: '#a78bfa' },
                { value: s.structureDamage, color: '#fbbf24' },
                { value: s.shieldAbsorbedByEnemy, color: '#38bdf8' },
              ]} />
              <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                <span style={{ color: '#a78bfa' }}>core</span> · <span style={{ color: '#fbbf24' }}>structure</span> · <span style={{ color: '#38bdf8' }}>absorbed</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Defense */}
      <section>
        <h3 style={{ fontSize: '0.8rem', fontWeight: 800, opacity: 0.8, marginBottom: 8 }}>SHIELDS</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '6px 10px', fontSize: '0.82rem' }}>
          <span />
          <span style={{ fontWeight: 800, color: '#22d3ee', textAlign: 'right' }}>{topName}</span>
          <span style={{ fontWeight: 800, color: '#fb7185', textAlign: 'right' }}>{botName}</span>
          {defRows.map(r => (
            <Fragment key={r.label}>
              <span className="text-muted">{r.label}</span>
              <span style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(r.get(top))}</span>
              <span style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(r.get(bot))}</span>
            </Fragment>
          ))}
        </div>
        <div style={{ marginTop: 8 }}>
          <Bar a={top.shieldBlocked} b={bot.shieldBlocked} colorA="#38bdf8" colorB="#60a5fa" />
          <div className="text-xs text-muted" style={{ marginTop: 4 }}>Shield damage blocked share</div>
        </div>
      </section>

      {/* Income */}
      <section>
        <h3 style={{ fontSize: '0.8rem', fontWeight: 800, opacity: 0.8, marginBottom: 8 }}>INCOME (TOTAL EARNED)</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '6px 10px', fontSize: '0.82rem' }}>
          <span />
          <span style={{ fontWeight: 800, color: '#22d3ee', textAlign: 'right' }}>{topName}</span>
          <span style={{ fontWeight: 800, color: '#fb7185', textAlign: 'right' }}>{botName}</span>
          {incomeRows.map(r => (
            <Fragment key={r.label}>
              <span className="text-muted">{r.label}</span>
              <span style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(r.get(top))}</span>
              <span style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(r.get(bot))}</span>
            </Fragment>
          ))}
          <span className="text-muted" style={{ fontWeight: 800 }}>Total</span>
          <span style={{ textAlign: 'right', fontWeight: 800 }}>{fmt(totalIncome(top))}</span>
          <span style={{ textAlign: 'right', fontWeight: 800 }}>{fmt(totalIncome(bot))}</span>
        </div>
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[top, bot].map((s, i) => (
            <div key={i}>
              <div className="text-xs text-muted" style={{ marginBottom: 4 }}>{i === 0 ? topName : botName} income mix</div>
              <StackedBar parts={[
                { value: s.incomeEconomy, color: '#fbbf24' },
                { value: s.incomeCore, color: '#4ade80' },
                { value: s.incomeSupply, color: '#22d3ee' },
              ]} />
              <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                <span style={{ color: '#fbbf24' }}>generators</span> · <span style={{ color: '#4ade80' }}>core</span> · <span style={{ color: '#22d3ee' }}>supply</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8 }}>
          <Bar a={totalIncome(top)} b={totalIncome(bot)} colorA="#fbbf24" colorB="#f59e0b" />
          <div className="text-xs text-muted" style={{ marginTop: 4 }}>Total income share</div>
        </div>
        <div style={{ marginTop: 10 }}>
          <div className="text-xs text-muted" style={{ marginBottom: 4, fontWeight: 700 }}>INCOME OVER TIME (/s)</div>
          <IncomeChart mc={mc} topName={topName} botName={botName} />
        </div>
      </section>

      {/* Fire + buildings */}
      <section>
        <h3 style={{ fontSize: '0.8rem', fontWeight: 800, opacity: 0.8, marginBottom: 8 }}>FIRE &amp; BUILDINGS</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '6px 10px', fontSize: '0.82rem' }}>
          <span />
          <span style={{ fontWeight: 800, color: '#22d3ee', textAlign: 'right' }}>{topName}</span>
          <span style={{ fontWeight: 800, color: '#fb7185', textAlign: 'right' }}>{botName}</span>
          <span className="text-muted">Missiles launched</span>
          <span style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(top.missilesLaunched)}</span>
          <span style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(bot.missilesLaunched)}</span>
          <span className="text-muted">Volleys fired</span>
          <span style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(top.volleys)}</span>
          <span style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(bot.volleys)}</span>
          <span className="text-muted">Damage / missile</span>
          <span style={{ textAlign: 'right', fontWeight: 700 }}>{dmgPerMissile(top).toFixed(1)}</span>
          <span style={{ textAlign: 'right', fontWeight: 700 }}>{dmgPerMissile(bot).toFixed(1)}</span>
          <span className="text-muted">Buildings built</span>
          <span style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(top.buildingsBuilt)}</span>
          <span style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(bot.buildingsBuilt)}</span>
          <span className="text-muted">Buildings destroyed</span>
          <span style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(top.buildingsDestroyed)}</span>
          <span style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(bot.buildingsDestroyed)}</span>
          <span className="text-muted">Buildings lost</span>
          <span style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(top.buildingsLost)}</span>
          <span style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(bot.buildingsLost)}</span>
          <span className="text-muted">Buildings sold</span>
          <span style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(top.buildingsSold)}</span>
          <span style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(bot.buildingsSold)}</span>
          <span className="text-muted">Supply claims</span>
          <span style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(top.supplyClaims)}</span>
          <span style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(bot.supplyClaims)}</span>
        </div>
      </section>
    </div>
  );
}
