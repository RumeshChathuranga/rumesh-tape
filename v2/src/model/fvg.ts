import type { Candle, Timeframe } from './types';

/** How the 3rd candle formed the gap (Arjo's FVG guide). */
export type FvgKind = 'perfect' | 'rejection' | 'breakaway' | 'forming';

/** A fair value gap. BISI = bullish (buyside imbalance), SIBI = bearish. */
export interface Fvg {
    side: 'bisi' | 'sibi';
    tf: Timeframe;
    t1: number;          // open time of candle 1
    t3: number;          // open time of candle 3
    top: number;
    bottom: number;
    kind: FvgKind;
    mitigatedAt: number | null;   // first candle that traded one tick into the gap
}

const body = (c: Candle) => Math.abs(c.c - c.o);

/**
 * Three-candle fair value gaps. Candle 2 must be an expansion that closes
 * beyond candle 1, and candle 3 must leave a gap back to candle 1. A gap is
 * mitigated by the first later candle that trades into it.
 */
export function findFvgs(candles: Candle[], tf: Timeframe, lastIsOpen = true): Fvg[] {
    const out: Fvg[] = [];
    const n = candles.length;
    for (let i = 2; i < n; i++) {
        const a = candles[i - 2], b = candles[i - 1], c = candles[i];
        let side: Fvg['side'] | null = null, top = 0, bottom = 0;
        if (b.c > a.h && c.l > a.h) { side = 'bisi'; bottom = a.h; top = c.l; }
        else if (b.c < a.l && c.h < a.l) { side = 'sibi'; top = a.l; bottom = c.h; }
        if (!side) continue;

        let kind: FvgKind;
        if (lastIsOpen && i === n - 1) kind = 'forming';
        else if (side === 'bisi' ? c.c > b.h : c.c < b.l) kind = 'breakaway';
        else if ((side === 'bisi' ? c.c < c.o : c.c > c.o) && body(c) >= 0.5 * body(b)) kind = 'rejection';
        else kind = 'perfect';

        let mitigatedAt: number | null = null;
        for (let j = i + 1; j < n; j++) {
            if (side === 'bisi' ? candles[j].l <= top : candles[j].h >= bottom) { mitigatedAt = candles[j].t; break; }
        }
        out.push({ side, tf, t1: a.t, t3: c.t, top, bottom, kind, mitigatedAt });
    }
    return out;
}

/** Direction from the most recently formed gap ("forming" gaps don't count yet). */
export function fvgBias(fvgs: Fvg[]): 'bullish' | 'bearish' | null {
    let last: Fvg | null = null;
    for (const f of fvgs) if (f.kind !== 'forming' && (!last || f.t3 > last.t3)) last = f;
    return last ? (last.side === 'bisi' ? 'bullish' : 'bearish') : null;
}
