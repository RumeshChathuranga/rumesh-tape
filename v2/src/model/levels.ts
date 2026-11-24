import { binIndex } from './bins';
import type { Candle } from './types';

const DAY = 86_400_000;
const dayOf = (t: number) => Math.floor(t / DAY) * DAY;

/** Volume-weighted average of typical price (h + l + c) / 3, restarting at 00:00 UTC. */
export function sessionVwap(candles: Candle[]): number[] {
    const out: number[] = [];
    let day = -1, pv = 0, vol = 0;
    for (const c of candles) {
        const d = dayOf(c.t);
        if (d !== day) { day = d; pv = 0; vol = 0; }
        pv += ((c.h + c.l + c.c) / 3) * c.v;
        vol += c.v;
        out.push(vol > 0 ? pv / vol : c.c);
    }
    return out;
}

/** Volume at price for one day. Prices are bin lower edges. */
export interface Profile {
    day: number;
    bin: number;
    poc: number;
    vah: number;
    val: number;
    total: number;
}

/**
 * Profile built from candles: each candle's volume is spread evenly over the
 * bins between its low and high. An estimate (it doesn't know where inside the
 * candle the volume traded), which is why levels drawn from it say so.
 */
export function volumeProfile(candles: Candle[], bin: number, vaShare = 0.7): Profile | null {
    const vol = new Map<number, number>();
    let total = 0;
    for (const c of candles) {
        if (!(c.v > 0)) continue;
        const lo = binIndex(c.l, bin), hi = binIndex(c.h, bin);
        const each = c.v / (hi - lo + 1);
        for (let b = lo; b <= hi; b++) vol.set(b, (vol.get(b) ?? 0) + each);
        total += c.v;
    }
    if (!vol.size || total <= 0) return null;
    let poc = Infinity, best = -1;
    for (const [b, v] of vol) if (v > best || (v === best && b < poc)) { best = v; poc = b; }
    let lo = poc, hi = poc, inside = best;
    const at = (b: number) => vol.get(b) ?? 0;
    const minB = Math.min(...vol.keys()), maxB = Math.max(...vol.keys());
    while (inside < vaShare * total && (lo > minB || hi < maxB)) {
        const up = hi < maxB ? at(hi + 1) : -1;
        const down = lo > minB ? at(lo - 1) : -1;
        if (up >= down) { hi++; inside += up; } else { lo--; inside += down; }
    }
    const price = (b: number) => Number((b * bin).toPrecision(12));
    return { day: dayOf(candles[0].t), bin, poc: price(poc), vah: price(hi), val: price(lo), total };
}

/** One profile per UTC day, oldest first. */
export function dailyProfiles(candles1m: Candle[], bin: number): Profile[] {
    const days = new Map<number, Candle[]>();
    for (const c of candles1m) {
        const d = dayOf(c.t);
        let list = days.get(d);
        if (!list) { list = []; days.set(d, list); }
        list.push(c);
    }
    return [...days.keys()].sort((a, b) => a - b)
        .map((d) => volumeProfile(days.get(d)!, bin))
        .filter((p): p is Profile => p !== null);
}

/** POCs of finished days that no later candle has traded through. */
export function nakedPocs(profiles: Profile[], candles1m: Candle[]): number[] {
    const out: number[] = [];
    for (const p of profiles.slice(0, -1)) {
        const after = p.day + DAY;
        const touched = candles1m.some((c) => c.t >= after && c.l <= p.poc && c.h >= p.poc);
        if (!touched) out.push(p.poc);
    }
    return out;
}
