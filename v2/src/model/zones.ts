import type { Fvg } from './fvg';
import type { Profile } from './levels';
import { TF_MS, type Timeframe } from './types';

/** A price area the strategy trades from (first touch only). */
export interface Zone {
    id: string;
    kind: 'fvg' | 'npoc' | 'vah' | 'val';
    tf: Timeframe | 'day';
    side: 'support' | 'resistance';
    top: number;
    bottom: number;
    grade: 'A' | 'B';   // A: a 15m+ gap sitting on a volume level
    label: string;
}

const clean = (n: number) => Number(n.toPrecision(12));
const MAX_PER_SIDE = 3;

/**
 * Strategy zones: unmitigated 15m+ fair value gaps in the bias direction, plus
 * yesterday's value-area edges and naked POCs. Nearest three on each side.
 */
export function buildZones(o: {
    price: number; fvgs: Fvg[]; profiles: Profile[]; nakedPocs: number[];
    bias: 'bullish' | 'bearish' | null; tolerance: number;
}): Zone[] {
    const { price, tolerance: tol } = o;
    const levels: { kind: Zone['kind']; p: number; label: string }[] = [];
    const yesterday = o.profiles.length >= 2 ? o.profiles[o.profiles.length - 2] : null;
    if (yesterday) {
        levels.push({ kind: 'vah', p: yesterday.vah, label: 'Yesterday VAH' });
        levels.push({ kind: 'val', p: yesterday.val, label: 'Yesterday VAL' });
    }
    for (const p of o.nakedPocs) levels.push({ kind: 'npoc', p, label: 'Naked POC' });

    const zones: Zone[] = [];
    for (const f of o.fvgs) {
        if (TF_MS[f.tf] < TF_MS['15m'] || f.mitigatedAt !== null || f.kind === 'forming') continue;
        const ok = (o.bias === 'bullish' && f.side === 'bisi' && f.top <= price) || (o.bias === 'bearish' && f.side === 'sibi' && f.bottom >= price);
        if (!ok) continue;
        const onLevel = levels.some((l) => l.p >= f.bottom - tol && l.p <= f.top + tol);
        zones.push({
            id: `fvg:${f.tf}:${f.t1}`, kind: 'fvg', tf: f.tf, side: f.side === 'bisi' ? 'support' : 'resistance',
            top: f.top, bottom: f.bottom, grade: onLevel ? 'A' : 'B', label: `${f.tf} ${f.side.toUpperCase()}`,
        });
    }
    for (const l of levels) {
        zones.push({
            id: `${l.kind}:${l.p}`, kind: l.kind, tf: 'day', side: l.p < price ? 'support' : 'resistance',
            top: clean(l.p + tol / 2), bottom: clean(l.p - tol / 2), grade: 'B', label: l.label,
        });
    }
    const support = zones.filter((z) => z.side === 'support').sort((a, b) => (price - a.top) - (price - b.top)).slice(0, MAX_PER_SIDE);
    const resistance = zones.filter((z) => z.side === 'resistance').sort((a, b) => (a.bottom - price) - (b.bottom - price)).slice(0, MAX_PER_SIDE);
    return [...support, ...resistance];
}

/** Remembers when each zone was first reached; later visits don't count (first touch only). */
export class ZoneTracker {
    private touched = new Map<string, number>();

    /** `lo`/`hi`: the range traded since the last update, so a fast wick still counts. */
    update(zones: Zone[], lo: number, hi: number, time: number): Zone[] {
        const fresh: Zone[] = [];
        for (const z of zones) {
            if (this.touched.has(z.id) || hi < z.bottom || lo > z.top) continue;
            this.touched.set(z.id, time);
            fresh.push(z);
        }
        return fresh;
    }

    touchedAt(id: string): number | null {
        return this.touched.get(id) ?? null;
    }
}
