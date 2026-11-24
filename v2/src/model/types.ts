/** One Binance aggregated trade. `buyerMaker` true = an aggressive seller hit the bid. */
export interface AggTrade {
    id: number;
    price: number;
    qty: number;
    time: number;
    buyerMaker: boolean;
}

/** Volume traded at one price level: `bid` = aggressive sells, `ask` = aggressive buys. */
export interface Cell {
    bid: number;
    ask: number;
}

/** Cells keyed by an integer bin index or row index. */
export type Cells = Map<number, Cell>;

/** One candle from Binance klines. `buyV` is the taker-buy (ask) volume. */
export interface Candle {
    t: number;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    buyV: number;
}

/** Consecutive trades with the same timestamp and side: usually one market order sweeping levels. */
export interface Print {
    firstId: number;
    lastId: number;
    time: number;
    side: 'buy' | 'sell';
    qty: number;
    notional: number;
    vwap: number;
    levels: number;
}

/** A candle with its footprint. `real` is false when trades don't cover the whole bar: then no cells. */
export interface Bar extends Candle {
    real: boolean;
    rows: Cells | null;
    poc: number | null;
}

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h';

export const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h'];

export const TF_MS: Record<Timeframe, number> = {
    '1m': 60_000,
    '5m': 300_000,
    '15m': 900_000,
    '30m': 1_800_000,
    '1h': 3_600_000,
    '4h': 14_400_000,
};
