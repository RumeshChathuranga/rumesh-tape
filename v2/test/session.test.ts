import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DepthSnapshot } from '../src/data/book';
import { UnknownSymbolError, type Rest } from '../src/data/rest';
import { MarketSession } from '../src/data/session';
import { FakeWS, fakeRest, NOW, range } from './fakes';

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
        const s = make(fakeRest({ depth: () => snapshot }).rest);
        await s.start();
        pub().push({ stream: 'btcusdt@depth@100ms', data: { e: 'depthUpdate', U: 96, u: 101, pu: 95, b: [['59998', '2']], a: [] } });
        release({ lastUpdateId: 100, bids: [['59999', '1']], asks: [['60001', '1']] });
        await vi.waitFor(() => expect(s.status.bookSynced).toBe(true));
        expect(s.book.bids.get(59998)).toBe(2);
        await s.stop();
    });
});

describe('higher-timeframe candles', () => {
    it('loads 1h and 4h candles for a lower-timeframe chart', async () => {
        const s = make(fakeRest().rest);
        await s.start();
        expect(s.htf['1h']?.length).toBeGreaterThan(0);
        expect(s.htf['4h']?.length).toBeGreaterThan(0);
        await s.stop();
    });

    it('loads none above a 4h chart', async () => {
        const s = new MarketSession({ symbol: 'BTCUSDT', tf: '4h', historyHours: 0.1, rest: fakeRest().rest, WebSocketImpl: FakeWS as unknown as typeof WebSocket, now: () => NOW, onChange: () => {} });
        await s.start();
        expect(Object.keys(s.htf)).toEqual([]);
        await s.stop();
    });
});

describe('network failures', () => {
    it('waits before retrying a failed gap fill instead of looping', async () => {
        const { rest, fromCalls } = fakeRest({ from: async () => { throw new Error('offline'); } });
        const s = make(rest);
        await s.start();
        fromCalls.length = 0;
        market().push(aggMsg(2005));
        await new Promise((r) => setTimeout(r, 200));
        expect(fromCalls.length).toBeLessThanOrEqual(1);
        await s.stop();
    });

    it('keeps loading history after one failed page', async () => {
        let fails = 1;
        const { rest } = fakeRest({ from: async (fromId) => {
            if (fails-- > 0) throw new Error('blip');
            return range(fromId, Math.min(fromId + 1000, 2000));
        } });
        const s = new MarketSession({
            symbol: 'BTCUSDT', tf: '5m', historyHours: 1, rest, retryMs: 10,
            WebSocketImpl: FakeWS as unknown as typeof WebSocket, now: () => NOW, onChange: () => {},
        });
        await s.start();
        await vi.waitFor(() => expect(s.status.phase).toBe('live'), { timeout: 2000 });
        expect(s.store!.firstId).toBe(0);
        await s.stop();
    });
});
