import type { DepthSnapshot } from '../src/data/book';
import { UnknownSymbolError, type Rest } from '../src/data/rest';
import type { AggTrade } from '../src/model/types';

export const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);

export class FakeWS {
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
export const trade = (id: number): AggTrade =>
    ({ id, price: 60000, qty: 1, time: NOW - (2000 - id) * 1000, buyerMaker: id % 2 === 0 });
export const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, i) => trade(from + i));

export function fakeRest(o: {
    depth?: () => Promise<DepthSnapshot>;
    from?: (fromId: number) => Promise<AggTrade[]>;
} = {}) {
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
        async aggTradesFrom(_s, fromId) {
            fromCalls.push(fromId);
            return o.from ? o.from(fromId) : range(fromId, Math.min(fromId + 1000, 5000));
        },
        depth: o.depth ?? (async () => ({ lastUpdateId: 100, bids: [['59999', '1']], asks: [['60001', '1']] })),
    };
    return { rest, fromCalls };
}
