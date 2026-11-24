import { describe, expect, it } from 'vitest';
import { backfillOlder, fillGap } from '../src/data/backfill';
import { RateGate } from '../src/data/rateGate';
import { createRest, UnknownSymbolError } from '../src/data/rest';
import { MinuteStore } from '../src/model/minutes';

function fakeClock() {
    let t = 0;
    const sleeps: number[] = [];
    return {
        now: () => t,
        sleep: async (ms: number) => { sleeps.push(ms); t += ms; },
        sleeps,
    };
}

const json = (body: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });

/** A fake Binance with `n` contiguous trades, ids 0..n-1, one second apart. */
function fakeBinance(n = 5000) {
    const trades = Array.from({ length: n }, (_, a) => ({ a, p: '100.0', q: '1', T: a * 1000, m: a % 2 === 0 }));
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        calls.push(url.pathname + url.search);
        if (url.pathname === '/fapi/v1/aggTrades') {
            const from = url.searchParams.get('fromId');
            const start = from === null ? n - 1000 : Number(from);
            return json(trades.slice(start, start + 1000));
        }
        if (url.pathname === '/fapi/v1/exchangeInfo') {
            return json({ symbols: [{ symbol: 'BTCUSDT', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.10' }] }] });
        }
        if (url.pathname === '/fapi/v1/klines') {
            return json([[1, '1', '2', '0.5', '1.5', '10', 2, '15', 9, '7', '10', '0']]);
        }
        return new Response('not found', { status: 404 });
    }) as typeof fetch;
    return { fetchImpl, calls, trades };
}

const bigGate = () => { const c = fakeClock(); return new RateGate({ weightPerMinute: 1e9, now: c.now, sleep: c.sleep }); };

describe('RateGate', () => {
    it('spreads calls so a minute never goes over budget', async () => {
        const c = fakeClock();
        const gate = new RateGate({ weightPerMinute: 60, now: c.now, sleep: c.sleep });
        for (let i = 0; i < 4; i++) await gate.run(20, async () => json({}));
        expect(c.sleeps).toEqual([60000]);
    });

    it('waits for Retry-After on 429 and tries again', async () => {
        const c = fakeClock();
        const gate = new RateGate({ weightPerMinute: 1000, now: c.now, sleep: c.sleep });
        const replies = [new Response('', { status: 429, headers: { 'Retry-After': '2' } }), json({ ok: 1 })];
        const res = await gate.run(20, async () => replies.shift()!);
        expect(res.status).toBe(200);
        expect(c.sleeps).toEqual([2000]);
    });

    it('rejects without calling when already aborted', async () => {
        const gate = bigGate();
        const ac = new AbortController();
        ac.abort();
        let called = false;
        await expect(gate.run(1, async () => { called = true; return json({}); }, ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(called).toBe(false);
    });
});

describe('REST client', () => {
    it('maps klines, taking taker-buy volume from field 9', async () => {
        const rest = createRest(fakeBinance().fetchImpl, bigGate());
        expect(await rest.klines('BTCUSDT', '5m')).toEqual([{ t: 1, o: 1, h: 2, l: 0.5, c: 1.5, v: 10, buyV: 7 }]);
    });

    it('reads the tick size and rejects unknown symbols', async () => {
        const rest = createRest(fakeBinance().fetchImpl, bigGate());
        expect(await rest.exchangeInfo('BTCUSDT')).toEqual({ tickSize: 0.1 });
        await expect(rest.exchangeInfo('NOPE')).rejects.toBeInstanceOf(UnknownSymbolError);
    });

    it('maps aggTrades', async () => {
        const rest = createRest(fakeBinance().fetchImpl, bigGate());
        const [t] = await rest.aggTradesFrom('BTCUSDT', 7);
        expect(t).toEqual({ id: 7, price: 100, qty: 1, time: 7000, buyerMaker: false });
    });
});

describe('backfill', () => {
    it('loads older pages by id until it reaches the target time', async () => {
        const fb = fakeBinance();
        const rest = createRest(fb.fetchImpl, bigGate());
        const store = new MinuteStore(5);
        store.applyNewer(await rest.aggTradesLatest('BTCUSDT'));
        fb.calls.length = 0;
        await backfillOlder(rest, 'BTCUSDT', store, 2500 * 1000, { signal: new AbortController().signal });
        expect(fb.calls).toHaveLength(2);
        expect(store.firstId).toBe(2000);
    });

    it('stops when aborted', async () => {
        const fb = fakeBinance();
        const rest = createRest(fb.fetchImpl, bigGate());
        const store = new MinuteStore(5);
        store.applyNewer(await rest.aggTradesLatest('BTCUSDT'));
        fb.calls.length = 0;
        const ac = new AbortController();
        await backfillOlder(rest, 'BTCUSDT', store, 0, { signal: ac.signal, onPage: () => ac.abort() });
        expect(fb.calls).toHaveLength(1);
        expect(store.firstId).toBe(3000);
    });

    it('fills a gap of missing ids', async () => {
        const fb = fakeBinance();
        const rest = createRest(fb.fetchImpl, bigGate());
        const store = new MinuteStore(5);
        store.applyNewer(fb.trades.slice(2900, 3001).map((r) => ({ id: r.a, price: 100, qty: 1, time: r.T, buyerMaker: r.m })));
        await fillGap(rest, 'BTCUSDT', store, 3500, { signal: new AbortController().signal });
        expect(store.lastId).toBe(3499);
        expect(store.applyNewer([{ id: 3500, price: 100, qty: 1, time: 3_500_000, buyerMaker: false }])).toEqual({ ok: true });
    });
});
