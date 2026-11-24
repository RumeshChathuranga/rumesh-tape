import type { Candle } from './types';

/** Row sizes offered in the UI, as multiples of the base bin. */
export const ROW_MULTS = [1, 2, 5, 10, 20, 50, 100];

const clean = (n: number) => Number(n.toPrecision(12));

/**
 * Finest price step we store trades at: a round 1/2/5 step close to one basis
 * point of price, snapped to a whole number of exchange ticks.
 */
export function baseBin(price: number, tickSize: number): number {
    const target = price * 1e-4;
    let step = tickSize;
    if (target > 0) {
        const k = Math.floor(Math.log10(target));
        for (const n of [5, 2, 1]) {
            const cand = clean(n * 10 ** k);
            if (cand <= target * (1 + 1e-9)) { step = cand; break; }
        }
    }
    const ticks = Math.max(1, Math.round(step / tickSize));
    return clean(ticks * tickSize);
}

/** Integer bin a price falls into (floored, with a guard against float error). */
export function binIndex(price: number, bin: number): number {
    return Math.floor(price / bin + 1e-9);
}

/** Row a bin belongs to when `mult` bins make one row. */
export function rowOf(binIdx: number, mult: number): number {
    return Math.floor(binIdx / mult);
}

/** Row multiple that gives roughly `targetRows` rows for a typical recent bar. */
export function autoRowMult(candles: Candle[], bin: number, targetRows = 12): number {
    const ranges = candles.slice(-50).map((c) => c.h - c.l).sort((a, b) => a - b);
    if (!ranges.length) return ROW_MULTS[0];
    const median = ranges[Math.floor(ranges.length / 2)];
    const need = median / targetRows / bin;
    return ROW_MULTS.find((m) => m >= need) ?? ROW_MULTS[ROW_MULTS.length - 1];
}

/** Short quantity label: three significant figures, k / M suffixes. */
export function formatQty(q: number): string {
    if (q === 0) return '0';
    const a = Math.abs(q);
    if (a >= 1e6) return (q / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return (q / 1e3).toFixed(1) + 'k';
    if (a >= 100) return q.toFixed(0);
    if (a >= 10) return q.toFixed(1);
    if (a >= 1) return q.toFixed(2);
    return q.toPrecision(3);
}
