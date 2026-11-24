import { rowOf } from './bins';
import type { MinuteStore } from './minutes';
import type { Bar, Candle, Cells } from './types';

/**
 * A candle plus its footprint. Cells come only from real trades: if the store
 * doesn't cover the whole bar, the bar is not `real` and has no rows.
 */
export function buildBar(c: Candle, tfMs: number, store: MinuteStore | null, mult: number): Bar {
    const from = store?.coveredFrom() ?? null;
    if (!store || from === null || c.t < from) return { ...c, real: false, rows: null, poc: null };
    const rows: Cells = new Map();
    for (const [k, cell] of store.cellsBetween(c.t, c.t + tfMs)) {
        const r = rowOf(k, mult);
        const o = rows.get(r);
        if (o) { o.bid += cell.bid; o.ask += cell.ask; } else rows.set(r, { bid: cell.bid, ask: cell.ask });
    }
    let poc: number | null = null;
    let best = -1;
    for (const [r, cell] of rows) {
        const v = cell.bid + cell.ask;
        if (v > best || (v === best && poc !== null && r < poc)) { best = v; poc = r; }
    }
    return { ...c, real: true, rows, poc };
}

/** Remembers closed real bars; the newest bar is always rebuilt. */
export class BarCache {
    private memo = new Map<string, { bar: Bar; tfMs: number }>();

    bar(c: Candle, tfMs: number, store: MinuteStore | null, mult: number, isLast: boolean): Bar {
        const key = `${c.t}:${mult}:${store?.bin ?? 0}`;
        if (!isLast) {
            const hit = this.memo.get(key);
            if (hit) return hit.bar;
        }
        const bar = buildBar(c, tfMs, store, mult);
        if (bar.real && !isLast) this.memo.set(key, { bar, tfMs });
        return bar;
    }

    /** Forget bars that end after `t0` (their minutes changed). */
    invalidateFrom(t0: number): void {
        for (const [k, e] of this.memo) if (e.bar.t + e.tfMs > t0) this.memo.delete(k);
    }

    clear(): void {
        this.memo.clear();
    }
}
