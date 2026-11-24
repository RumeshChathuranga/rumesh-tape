import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DepthSnapshot } from '../src/data/book';
import { UnknownSymbolError, type Rest } from '../src/data/rest';
import { MarketSession } from '../src/data/session';
import type { AggTrade } from '../src/model/types';

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);

class FakeWS {
    static all: FakeWS[] = [];
    onopen: ((e: unknown) => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onclose: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    closed = false;
    constructor(readonly url: string) {
        FakeWS.all.push(this);
        queueMicrotask(() => this.onopen?.({}));
    }
    close() { this.closed = true; }
    push(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

/** Trades with ids 0..1999, one per second, the newest one second before NOW. */
const trade = (id: number): AggTrade => ({ id, price: 60000, qty: 1, time: NOW - (2000 - id) * 1000, buyerMaker: id % 2 === 0 });
const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, i) => trade(from + i));

function fakeRest(depth: () => Promise<DepthSnapshot> = async () => ({ lastUpdateId: 100, bids: [['59999', '1']], asks: [['60001', '1']] })) {
    const fromCalls: number[] = [];
    const rest: Rest = {
        async exchangeInfo(symbol) {
            if (symbol !== 'BTCUSDT') throw new UnknownSymbolError(symbol);
            return { tickSize: 0.1 };
        },
        async klines() {
            return [0, 1, 2].map((i) => ({ t: NOW - (3 - i) * 300_000, o: 60000, h: 60010, l: 59990, c: 60000, v: 10, buyV: 5 }));
        },
        async aggTradesLatest() { return range(1000, 2000); },
        async aggTradesFrom(_s, fromId) { fromCalls.push(fromId); return range(fromId, Math.min(fromId + 1000, 5000)); },
        depth,
    };
    return { rest, fromCalls };
}

const make = (rest: Rest, onChange = () => {}) => new MarketSession({
    symbol: 'BTCUSDT', tf: '5m', historyHours: 0.1, rest,
    WebSocketImpl: FakeWS as unknown as typeof WebSocket, now: () => NOW, onChange,
});
const market = () => FakeWS.all.find((w) => w.url.includes('/market/'))!;
const pub = () => FakeWS.all.find((w) => w.url.includes('/public/'))!;
const aggMsg = (id: number) => ({ stream: 'btcusdt@aggTrade', data: { e: 'aggTrade', a: id, p: '60000', q: '1', T: NOW, m: false } });

beforeEach(() => { FakeWS.all = []; });

describe('MarketSession', () => {
    it('opens one market and one public stream on the new endpoints', async () => {
        const s = make(fakeRest().rest);
        await s.start();
        expect(FakeWS.all.map((w) => w.url).sort()).toEqual([
            'wss://fstream.binance.com/market/stream?streams=btcusdt@aggTrade/btcusdt@kline_5m',
            'wss://fstream.binance.com/public/stream?streams=btcusdt@depth@100ms',
        ]);
        await s.stop();
    });

    it('applies the next live trade and reports a change', async () => {
        const onChange = vi.fn();
        const s = make(fakeRest().rest, onChange);
        await s.start();
        onChange.mockClear();
        market().push(aggMsg(2000));
        expect(s.store!.lastId).toBe(2000);
        expect(onChange).toHaveBeenCalled();
        await s.stop();
    });

    it('fetches missing ids before applying a trade that skips ahead', async () => {
        const { rest, fromCalls } = fakeRest();
        const s = make(rest);
        await s.start();
        market().push(aggMsg(2005));
        await vi.waitFor(() => expect(s.store!.lastId).toBe(2005));
        expect(fromCalls).toContain(2000);
        await s.stop();
    });

    it('updates the last candle from the kline stream', async () => {
        const s = make(fakeRest().rest);
        await s.start();
        const last = s.candles[s.candles.length - 1];
        market().push({ stream: 'btcusdt@kline_5m', data: { e: 'kline', k: { t: last.t, o: '1', h: '2', l: '0.5', c: '1.7', v: '10', V: '6', x: false } } });
        expect(s.candles[s.candles.length - 1]).toMatchObject({ c: 1.7, buyV: 6 });
        await s.stop();
    });

    it('rejects an unknown symbol without opening sockets', async () => {
        const s = new MarketSession({ symbol: 'NOPE', tf: '5m', historyHours: 1, rest: fakeRest().rest, WebSocketImpl: FakeWS as unknown as typeof WebSocket, onChange: () => {} });
        await expect(s.start()).rejects.toBeInstanceOf(UnknownSymbolError);
        expect(FakeWS.all).toHaveLength(0);
    });

    it('closes both streams on stop and ignores later messages', async () => {
        const s = make(fakeRest().rest);
        await s.start();
        const ws = [...FakeWS.all];
        await s.stop();
        expect(ws.every((w) => w.closed)).toBe(true);
        ws[0].onmessage?.({ data: JSON.stringify(aggMsg(2000)) });
        expect(s.store!.lastId).toBe(1999);
    });

    it('syncs the book from buffered depth events and a snapshot', async () => {
        let release!: (s: DepthSnapshot) => void;
        const snapshot = new Promise<DepthSnapshot>((r) => { release = r; });
        const s = make(fakeRest(() => snapshot).rest);
        await s.start();
        pub().push({ stream: 'btcusdt@depth@100ms', data: { e: 'depthUpdate', U: 96, u: 101, pu: 95, b: [['59998', '2']], a: [] } });
        release({ lastUpdateId: 100, bids: [['59999', '1']], asks: [['60001', '1']] });
        await vi.waitFor(() => expect(s.status.bookSynced).toBe(true));
        expect(s.book.bids.get(59998)).toBe(2);
        await s.stop();
    });
});
