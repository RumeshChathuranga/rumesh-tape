import type { Cells } from './types';

/** `buy`: the ask at `row` dominates; `sell`: the bid at `row` dominates. */
export interface Imbalance {
    row: number;
    side: 'buy' | 'sell';
}

/**
 * Diagonal imbalances, read the way the course reads a footprint: the bid at
 * row r is compared with the ask one row higher (r + 1). A side needs `ratio`
 * times the other side, the other side must have traded (> 0), and the
 * dominant side must reach `minQty`.
 */
export function findImbalances(rows: Cells, ratio = 3, minQty = 0): Imbalance[] {
    const out: Imbalance[] = [];
    for (const [r, cell] of rows) {
        const above = rows.get(r + 1);
        if (!above) continue;
        const bid = cell.bid, ask = above.ask;
        if (ask > 0 && bid >= ratio * ask && bid >= minQty) out.push({ row: r, side: 'sell' });
        if (bid > 0 && ask >= ratio * bid && ask >= minQty) out.push({ row: r + 1, side: 'buy' });
    }
    return out.sort((a, b) => a.row - b.row);
}
