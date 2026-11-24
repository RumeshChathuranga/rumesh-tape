import { describe, expect, it } from 'vitest';
import { BarCache, buildBar } from '../src/model/bars';
import { barDelta, sessionCvd } from '../src/model/cvd';
import { findImbalances } from '../src/model/imbalance';
import { MinuteStore } from '../src/model/minutes';
import type { AggTrade, Candle, Cells } from '../src/model/types';

const T0 = Date.UTC(2026, 10, 24, 12, 0, 0);
const M = 60_000;
const candle = (t: number, delta = 0): Candle => ({ t, o: 100, h: 101, l: 99, c: 100, v: 10, buyV: (10 + delta) / 2 });
const tr = (id: number, price: number, qty: number, side: 'buy' | 'sell', time: number): AggTrade =>
    ({ id, price, qty, time, buyerMaker: side === 'sell' });
const cells = (o: Record<number, [number, number]>): Cells =>
    new Map(Object.entries(o).map(([k, [bid, ask]]) => [Number(k), { bid, ask }]));

describe('findImbalances (diagonal, 300%)', () => {
    it('matches the course example: exactly two selling imbalances', () => {
        // Course Ch 5, top to bottom: bid 0/13/61/42/0, ask 2/14/88/7/4
        const rows = cells({ 5: [0, 2], 4: [13, 14], 3: [61, 88], 2: [42, 7], 1: [0, 4] });
        expect(findImbalances(rows)).toEqual([{ row: 3, side: 'sell' }, { row: 4, side: 'sell' }]);
    });

    it('finds a buying imbalance on the ask against the bid one row lower', () => {
        expect(findImbalances(cells({ 1: [10, 1], 2: [1, 40] }))).toEqual([{ row: 2, side: 'buy' }]);
    });

    it('respects a minimum quantity', () => {
        expect(findImbalances(cells({ 1: [1, 1], 2: [1, 4] }), 3, 5)).toEqual([]);
    });
});

describe('session CVD', () => {
    it('adds deltas within a day, as in the course', () => {
        expect(sessionCvd([candle(T0, 30), candle(T0 + M, 100), candle(T0 + 2 * M, -50)])).toEqual([30, 130, 80]);
        expect(sessionCvd([candle(T0, 22), candle(T0 + M, 3), candle(T0 + 2 * M, -84)])).toEqual([22, 25, -59]);
    });

    it('starts again at 00:00 UTC', () => {
        const late = Date.UTC(2026, 10, 24, 23, 30);
        const midnight = Date.UTC(2026, 10, 25, 0, 0);
        expect(sessionCvd([candle(late, 10), candle(midnight, 5)])).toEqual([10, 5]);
    });

    it('takes bar delta from taker-buy volume', () => {
        expect(barDelta({ ...candle(T0), v: 10, buyV: 7 })).toBe(4);
    });
});

describe('buildBar', () => {
    const store = () => {
        const s = new MinuteStore(5, 0);
        s.applyNewer([
            tr(1, 100, 1, 'buy', T0 + 30_000),     // inside the uncovered first minute
            tr(2, 100, 2, 'sell', T0 + M),
            tr(3, 105, 3, 'buy', T0 + 2 * M),
            tr(4, 100, 4, 'buy', T0 + 4 * M + 59_000),
            tr(5, 110, 1, 'sell', T0 + 5 * M),
        ]);
        return s;
    };

    it('has no cells for a bar that real trades do not fully cover', () => {
        const b = buildBar(candle(T0), M, store(), 1);
        expect(b).toMatchObject({ real: false, rows: null, poc: null });
        expect(buildBar(candle(T0), M, null, 1).real).toBe(false);
    });

    it('sums its minutes into rows and finds the POC', () => {
        const b = buildBar(candle(T0 + M), 4 * M, store(), 1);
        expect(b.real).toBe(true);
        expect([...b.rows!].sort((a, z) => a[0] - z[0])).toEqual([[20, { bid: 2, ask: 4 }], [21, { bid: 0, ask: 3 }]]);
        expect(b.poc).toBe(20);
        const total = [...b.rows!.values()].reduce((s, c) => s + c.bid + c.ask, 0);
        expect(total).toBe(9);
    });

    it('merges bins into wider rows', () => {
        const b = buildBar(candle(T0 + M), 4 * M, store(), 2);
        expect([...b.rows!]).toEqual([[10, { bid: 2, ask: 7 }]]);
    });
});

describe('BarCache', () => {
    it('reuses closed bars, rebuilds the last bar, and drops entries after an older change', () => {
        const s = new MinuteStore(5, 0);
        s.applyNewer([tr(10, 100, 1, 'buy', T0 + 30_000), tr(11, 100, 1, 'buy', T0 + M), tr(12, 100, 1, 'buy', T0 + 2 * M)]);
        const cache = new BarCache();
        const closed = candle(T0 + M);
        const a = cache.bar(closed, M, s, 1, false);
        expect(cache.bar(closed, M, s, 1, false)).toBe(a);
        const last = candle(T0 + 2 * M);
        expect(cache.bar(last, M, s, 1, true)).not.toBe(cache.bar(last, M, s, 1, true));

        // An older trade lands in the closed bar's minute (as a gap fill would do).
        s.applyOlder([tr(9, 100, 5, 'sell', T0 + 10_000)]);
        s.takeDirty();
        const s2 = new MinuteStore(5, 0);
        s2.applyNewer([tr(1, 100, 5, 'sell', T0 + 10_000), tr(2, 100, 1, 'buy', T0 + M), tr(3, 100, 7, 'sell', T0 + M + 1)]);
        cache.invalidateFrom(T0 + M);
        expect(cache.bar(closed, M, s2, 1, false).rows!.get(20)).toEqual({ bid: 7, ask: 1 });
    });
});
