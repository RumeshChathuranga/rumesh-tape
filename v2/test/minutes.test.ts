import { describe, expect, it } from 'vitest';
import { MinuteStore } from '../src/model/minutes';
import { groupPrints } from '../src/model/prints';
import type { AggTrade } from '../src/model/types';

const T0 = Date.UTC(2026, 10, 24, 12, 0, 0);
const tr = (id: number, price: number, qty: number, side: 'buy' | 'sell', time = T0): AggTrade =>
    ({ id, price, qty, time, buyerMaker: side === 'sell' });

describe('MinuteStore cells', () => {
    it('puts aggressive sells on the bid and aggressive buys on the ask', () => {
        const s = new MinuteStore(5);
        s.applyNewer([tr(1, 100, 2, 'sell'), tr(2, 100, 3, 'buy')]);
        expect([...s.cellsBetween(T0, T0 + 60_000)]).toEqual([[20, { bid: 2, ask: 3 }]]);
    });

    it('sums several minutes inside a range', () => {
        const s = new MinuteStore(5);
        s.applyNewer([tr(1, 100, 1, 'buy', T0), tr(2, 100, 2, 'buy', T0 + 60_000), tr(3, 100, 4, 'buy', T0 + 300_000)]);
        expect(s.cellsBetween(T0, T0 + 300_000).get(20)).toEqual({ bid: 0, ask: 3 });
    });
});

describe('MinuteStore id continuity', () => {
    it('reports a gap and applies nothing when ids skip ahead', () => {
        const s = new MinuteStore(5);
        s.applyNewer([tr(10, 100, 1, 'buy')]);
        const v = s.version;
        expect(s.applyNewer([tr(13, 100, 1, 'buy')])).toEqual({ ok: false, gapFrom: 11, gapTo: 12 });
        expect(s.version).toBe(v);
        expect(s.lastId).toBe(10);
    });

    it('ignores trades it already has', () => {
        const s = new MinuteStore(5);
        s.applyNewer([tr(1, 100, 1, 'buy'), tr(2, 100, 1, 'buy')]);
        expect(s.applyNewer([tr(2, 100, 1, 'buy')])).toEqual({ ok: true });
        expect(s.cellsBetween(T0, T0 + 60_000).get(20)!.ask).toBe(2);
    });

    it('accepts older trades only when they end right before the first id', () => {
        const s = new MinuteStore(5);
        s.applyNewer([tr(10, 100, 1, 'buy')]);
        s.applyOlder([5, 6, 7, 8, 9].map((id) => tr(id, 100, 1, 'buy')));
        expect(s.firstId).toBe(5);
        expect(s.cellsBetween(T0, T0 + 60_000).get(20)!.ask).toBe(6);
        expect(() => s.applyOlder([tr(3, 100, 1, 'buy')])).toThrow('not contiguous');
    });

    it('is covered from the minute after its first trade', () => {
        const s = new MinuteStore(5);
        expect(s.coveredFrom()).toBeNull();
        s.applyNewer([tr(1, 100, 1, 'buy', T0 + 30_000)]);
        expect(s.coveredFrom()).toBe(T0 + 60_000);
    });
});

describe('grouped prints', () => {
    const sweep = [tr(1, 100, 1, 'sell', 1000), tr(2, 99, 2, 'sell', 1000), tr(3, 100, 1, 'buy', 1001)];

    it('groups consecutive trades with the same time and side', () => {
        const p = groupPrints(sweep);
        expect(p).toHaveLength(2);
        expect(p[0]).toMatchObject({ side: 'sell', qty: 3, levels: 2, firstId: 1, lastId: 2 });
        expect(p[0].vwap).toBeCloseTo(298 / 3, 9);
        expect(p[0].notional).toBe(298);
        expect(p[1]).toMatchObject({ side: 'buy', qty: 1, levels: 1 });
    });

    it('gives the same prints whether trades arrive together or one by one', () => {
        const batch = new MinuteStore(5, 0);
        batch.applyNewer(sweep);
        const live = new MinuteStore(5, 0);
        for (const t of sweep) live.applyNewer([t]);
        const strip = (s: MinuteStore) => s.printsBetween(0, 10_000).map(({ firstId, lastId, side, qty, levels }) => ({ firstId, lastId, side, qty, levels }));
        expect(strip(live)).toEqual(strip(batch));
        expect(strip(batch)).toHaveLength(2);
    });

    it('merges an older trade into the oldest group when it continues it', () => {
        const s = new MinuteStore(5, 0);
        s.applyNewer([tr(10, 100, 1, 'sell', 5000)]);
        s.applyOlder([tr(9, 101, 1, 'sell', 5000)]);
        const p = s.printsBetween(0, 10_000);
        expect(p).toHaveLength(1);
        expect(p[0]).toMatchObject({ firstId: 9, lastId: 10, qty: 2, levels: 2 });
    });

    it('drops finished prints below the minimum notional', () => {
        const s = new MinuteStore(5, 150);
        s.applyNewer([tr(1, 100, 1, 'buy', 1000), tr(2, 100, 2, 'sell', 2000), tr(3, 100, 1, 'buy', 3000)]);
        expect(s.printsBetween(0, 10_000).map((p) => p.firstId)).toEqual([2]);
    });
});

describe('dirty tracking and persistence', () => {
    it('reports the earliest changed minute once', () => {
        const s = new MinuteStore(5);
        s.applyNewer([tr(10, 100, 1, 'buy', T0 + 120_000)]);
        s.applyOlder([tr(9, 100, 1, 'buy', T0 + 5_000)]);
        expect(s.takeDirty()).toBe(T0);
        expect(s.takeDirty()).toBeNull();
    });

    it('round-trips through serialize and restore', () => {
        const s = new MinuteStore(5, 0);
        s.applyNewer([tr(1, 100, 2, 'sell'), tr(2, 105, 3, 'buy', T0 + 61_000)]);
        const r = MinuteStore.restore(s.serialize());
        expect(r.firstId).toBe(1);
        expect(r.lastId).toBe(2);
        expect(r.coveredFrom()).toBe(s.coveredFrom());
        expect([...r.cellsBetween(T0, T0 + 120_000)]).toEqual([...s.cellsBetween(T0, T0 + 120_000)]);
        expect(r.applyNewer([tr(3, 100, 1, 'buy', T0 + 62_000)])).toEqual({ ok: true });
    });
});
