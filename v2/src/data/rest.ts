import type { AggTrade, Candle, Timeframe } from '../model/types';
import type { DepthSnapshot } from './book';
import { RateGate } from './rateGate';

export const REST_BASE = 'https://fapi.binance.com';

export class UnknownSymbolError extends Error {
    constructor(symbol: string) {
        super(`Unknown symbol ${symbol}`);
        this.name = 'UnknownSymbolError';
    }
}

export interface Rest {
    exchangeInfo(symbol: string): Promise<{ tickSize: number }>;
    klines(symbol: string, tf: Timeframe, limit?: number): Promise<Candle[]>;
    aggTradesLatest(symbol: string, signal?: AbortSignal): Promise<AggTrade[]>;
    aggTradesFrom(symbol: string, fromId: number, signal?: AbortSignal): Promise<AggTrade[]>;
    depth(symbol: string, signal?: AbortSignal): Promise<DepthSnapshot>;
}

interface RawAgg { a: number; p: string; q: string; T: number; m: boolean }
interface RawSymbol { symbol: string; filters: { filterType: string; tickSize?: string }[] }

const mapAgg = (r: RawAgg): AggTrade => ({ id: r.a, price: +r.p, qty: +r.q, time: r.T, buyerMaker: r.m });
const klineWeight = (limit: number) => (limit < 100 ? 1 : limit < 500 ? 2 : limit <= 1000 ? 5 : 10);

export function createRest(
    fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
    gate = new RateGate({ weightPerMinute: 1500 }),
): Rest {
    let info: Promise<RawSymbol[]> | null = null;

    async function get<T>(path: string, weight: number, signal?: AbortSignal): Promise<T> {
        const res = await gate.run(weight, () => fetchImpl(REST_BASE + path, { signal }), signal);
        if (!res.ok) throw new Error(`Binance ${path.split('?')[0]} failed: HTTP ${res.status}`);
        return res.json() as Promise<T>;
    }

    return {
        async exchangeInfo(symbol) {
            info ??= get<{ symbols: RawSymbol[] }>('/fapi/v1/exchangeInfo', 1).then((j) => j.symbols);
            let symbols: RawSymbol[];
            try { symbols = await info; } catch (e) { info = null; throw e; }
            const s = symbols.find((x) => x.symbol === symbol);
            const tick = s?.filters.find((f) => f.filterType === 'PRICE_FILTER')?.tickSize;
            if (!s || !tick) throw new UnknownSymbolError(symbol);
            return { tickSize: +tick };
        },
        async klines(symbol, tf, limit = 1000) {
            const rows = await get<unknown[][]>(`/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=${limit}`, klineWeight(limit));
            return rows.map((k) => ({ t: +(k[0] as number), o: +(k[1] as string), h: +(k[2] as string), l: +(k[3] as string), c: +(k[4] as string), v: +(k[5] as string), buyV: +(k[9] as string) }));
        },
        async aggTradesLatest(symbol, signal) {
            return (await get<RawAgg[]>(`/fapi/v1/aggTrades?symbol=${symbol}&limit=1000`, 20, signal)).map(mapAgg);
        },
        async aggTradesFrom(symbol, fromId, signal) {
            return (await get<RawAgg[]>(`/fapi/v1/aggTrades?symbol=${symbol}&fromId=${fromId}&limit=1000`, 20, signal)).map(mapAgg);
        },
        depth(symbol, signal) {
            return get<DepthSnapshot>(`/fapi/v1/depth?symbol=${symbol}&limit=1000`, 20, signal);
        },
    };
}
