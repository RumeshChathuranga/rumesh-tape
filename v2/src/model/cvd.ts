import type { Candle } from './types';

const DAY = 86_400_000;

/** Ask volume minus bid volume for the bar, from the exchange's taker-buy volume. */
export function barDelta(c: Candle): number {
    return 2 * c.buyV - c.v;
}

/** Cumulative delta that starts again at 00:00 UTC each day. */
export function sessionCvd(candles: Candle[]): number[] {
    const out: number[] = [];
    let day = -1;
    let sum = 0;
    for (const c of candles) {
        const d = Math.floor(c.t / DAY);
        if (d !== day) { day = d; sum = 0; }
        sum += barDelta(c);
        out.push(sum);
    }
    return out;
}
