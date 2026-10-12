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
