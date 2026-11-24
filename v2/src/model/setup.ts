import { barDelta } from './cvd';
import { findFvgs } from './fvg';
import { findImbalances } from './imbalance';
import type { Bar } from './types';
import type { Zone } from './zones';

/** Order-flow confirmations from the course (Ch 12-15) plus the FVG guide's sharp turn. */
export type Signal = 'absorption' | 'delta flip' | 'stacked imbalance' | 'fvg out';

export interface Setup {
    key: string;
    dir: 'long' | 'short';
    zone: Zone;
    signals: Signal[];
    time: number;
    entry: number;
    stop: number;
}

const WINDOW = 10;          // bars after the touch in which a setup may form
const ABSORB_X = 3;         // "unusually large" = 3 x the average cell
const clean = (n: number) => Number(n.toPrecision(12));

/** Mean of bid + ask over non-empty rows of real bars. */
export function avgCellVolume(bars: Bar[]): number {
    let sum = 0, n = 0;
    for (const b of bars) {
        if (!b.real || !b.rows) continue;
        for (const c of b.rows.values()) {
            const v = c.bid + c.ask;
            if (v > 0) { sum += v; n++; }
        }
    }
    return n ? sum / n : 0;
}

function stacked(b: Bar, side: 'buy' | 'sell'): boolean {
    if (!b.real || !b.rows) return false;
    const rows = findImbalances(b.rows).filter((i) => i.side === side).map((i) => i.row).sort((a, z) => a - z);
    let run = 1;
    for (let k = 1; k < rows.length; k++) {
        run = rows[k] === rows[k - 1] + 1 ? run + 1 : 1;
        if (run >= 3) return true;
    }
    return false;
}

/** Which confirmations bar `i` shows for a trade in `dir`. Cell-based ones need a real bar. */
export function signalsAt(bars: Bar[], i: number, dir: 'long' | 'short', avgCell: number): Signal[] {
    const b = bars[i];
    const out: Signal[] = [];
    const sign = dir === 'long' ? 1 : -1;
    if (b.real && b.rows && avgCell > 0) {
        for (const c of b.rows.values()) {
            if (c.bid >= ABSORB_X * avgCell && c.ask >= ABSORB_X * avgCell) { out.push('absorption'); break; }
        }
    }
    if (i > 0 && Math.sign(barDelta(b)) === sign && Math.sign(barDelta(bars[i - 1])) === -sign) out.push('delta flip');
    if (stacked(b, dir === 'long' ? 'buy' : 'sell')) out.push('stacked imbalance');
    if (i >= 2) {
        const [f] = findFvgs(bars.slice(i - 2, i + 1), '1m', false);
        if (f && f.side === (dir === 'long' ? 'bisi' : 'sibi')) out.push('fvg out');
    }
    return out;
}

/**
 * After a zone is first touched: within the next 10 closed bars, look for
 * (absorption or delta flip) and then (stacked imbalance or fvg out).
 * Long from support, short from resistance; stop one tick beyond the zone.
 */
export function detectSetup(bars: Bar[], zone: Zone, touchedAt: number, tick: number): Setup | null {
    const dir = zone.side === 'support' ? 'long' : 'short';
    let start = -1;
    for (let i = 0; i < bars.length; i++) if (bars[i].t <= touchedAt) start = i;
    if (start < 0) return null;
    const lastClosed = bars.length - 2;
    const end = Math.min(lastClosed, start + WINDOW - 1);
    const avg = avgCellVolume(bars.slice(Math.max(0, bars.length - 30)));
    let first = -1;
    const seen = new Set<Signal>();
    for (let i = start; i <= end; i++) {
        const sig = signalsAt(bars, i, dir, avg);
        if (first < 0 && (sig.includes('absorption') || sig.includes('delta flip'))) first = i;
        if (first >= 0) sig.forEach((s) => seen.add(s));
        if (first >= 0 && (sig.includes('stacked imbalance') || sig.includes('fvg out'))) {
            const b = bars[i];
            const entry = sig.includes('fvg out') ? (dir === 'long' ? b.l : b.h) : b.c;
            return {
                key: `${zone.id}:${b.t}`, dir, zone, signals: [...seen], time: b.t, entry,
                stop: clean(dir === 'long' ? zone.bottom - tick : zone.top + tick),
            };
        }
    }
    return null;
}
