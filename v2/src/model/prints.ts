import type { AggTrade, Print } from './types';

/** A print that can still grow at either end; `fp`/`lp` are its first and last prices. */
export interface Group extends Print {
    fp: number;
    lp: number;
}

export const sideOf = (t: AggTrade): Print['side'] => (t.buyerMaker ? 'sell' : 'buy');

export function startGroup(t: AggTrade): Group {
    const notional = t.price * t.qty;
    return {
        firstId: t.id, lastId: t.id, time: t.time, side: sideOf(t),
        qty: t.qty, notional, vwap: t.price, levels: 1, fp: t.price, lp: t.price,
    };
}

const same = (g: Group, t: AggTrade) => t.time === g.time && sideOf(t) === g.side;
export const canAppend = (g: Group, t: AggTrade) => t.id === g.lastId + 1 && same(g, t);
export const canPrepend = (g: Group, t: AggTrade) => t.id === g.firstId - 1 && same(g, t);

function add(g: Group, t: AggTrade) {
    g.qty += t.qty;
    g.notional += t.price * t.qty;
    g.vwap = g.notional / g.qty;
}

export function append(g: Group, t: AggTrade): void {
    add(g, t);
    if (t.price !== g.lp) g.levels++;
    g.lp = t.price;
    g.lastId = t.id;
}

export function prepend(g: Group, t: AggTrade): void {
    add(g, t);
    if (t.price !== g.fp) g.levels++;
    g.fp = t.price;
    g.firstId = t.id;
}

export function toPrint(g: Group): Print {
    const { firstId, lastId, time, side, qty, notional, vwap, levels } = g;
    return { firstId, lastId, time, side, qty, notional, vwap, levels };
}

/** Group consecutive trades (by id) that share a timestamp and side: one market order sweeping levels. */
export function groupPrints(trades: AggTrade[]): Print[] {
    const out: Print[] = [];
    let g: Group | null = null;
    for (const t of trades) {
        if (g && canAppend(g, t)) append(g, t);
        else {
            if (g) out.push(toPrint(g));
            g = startGroup(t);
        }
    }
    if (g) out.push(toPrint(g));
    return out;
}
