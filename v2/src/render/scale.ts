import type { Candle } from '../model/types';

/** What part of the data is on screen. `scrollBars` > 0 looks back in time. */
export interface View {
    barW: number;
    scrollBars: number;
    priceMid: number;
    pxPerPrice: number;
}

/** Space kept free to the right of the newest bar. */
export const RIGHT_PAD = 60;

export function xOfBar(i: number, n: number, v: View, plotW: number): number {
    return plotW - RIGHT_PAD - v.barW / 2 - (n - 1 - i - v.scrollBars) * v.barW;
}

export function barAtX(x: number, n: number, v: View, plotW: number): number {
    return Math.round(n - 1 - v.scrollBars - (plotW - RIGHT_PAD - v.barW / 2 - x) / v.barW);
}

export function yOfPrice(p: number, v: View, plotH: number): number {
    return plotH / 2 - (p - v.priceMid) * v.pxPerPrice;
}

export function priceAtY(y: number, v: View, plotH: number): number {
    return v.priceMid + (plotH / 2 - y) / v.pxPerPrice;
}

/** A view whose price range shows every candle in [from, to) with 8% padding. */
export function fitView(candles: Candle[], from: number, to: number, plotH: number, barW: number): View {
    let hi = -Infinity, lo = Infinity;
    for (let i = Math.max(0, from); i < Math.min(candles.length, to); i++) {
        hi = Math.max(hi, candles[i].h);
        lo = Math.min(lo, candles[i].l);
    }
    if (!Number.isFinite(hi)) { hi = 1; lo = 0; }
    const range = Math.max(hi - lo, Math.abs(hi) * 1e-4, 1e-12);
    return { barW, scrollBars: 0, priceMid: (hi + lo) / 2, pxPerPrice: plotH / (range * 1.16) };
}

/** A round 1/2/2.5/5 step at least `raw` long. */
export function niceStep(raw: number): number {
    const pow = 10 ** Math.floor(Math.log10(raw));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= raw) return m * pow;
    return 10 * pow;
}
