/** One diff-depth event from `<symbol>@depth@100ms`. */
export interface DepthEvent {
    U: number;
    u: number;
    pu: number;
    b: [string, string][];
    a: [string, string][];
}

/** REST `/fapi/v1/depth` response. */
export interface DepthSnapshot {
    lastUpdateId: number;
    bids: [string, string][];
    asks: [string, string][];
}

const MAX_BUFFER = 2000;

/**
 * Local order book kept in step with Binance using update ids (the futures
 * procedure): buffer events, load a snapshot, drop events older than it,
 * start from the event that straddles it, then require each event's `pu` to
 * equal the previous `u`. Anything else means a missed message: resync.
 */
export class OrderBook {
    state: 'waiting' | 'synced' = 'waiting';
    bids = new Map<number, number>();
    asks = new Map<number, number>();

    private buffer: DepthEvent[] = [];
    private snapshotId: number | null = null;
    private lastU: number | null = null;

    onEvent(e: DepthEvent): 'buffered' | 'applied' | 'resync' {
        if (this.state === 'synced') {
            if (e.pu !== this.lastU) { this.reset(); return 'resync'; }
            this.apply(e);
            return 'applied';
        }
        if (this.snapshotId === null) {
            this.buffer.push(e);
            if (this.buffer.length > MAX_BUFFER) this.buffer.shift();
            return 'buffered';
        }
        if (e.u < this.snapshotId) return 'buffered';
        if (e.U <= this.snapshotId) { this.apply(e); this.state = 'synced'; return 'applied'; }
        this.reset();
        return 'resync';
    }

    loadSnapshot(s: DepthSnapshot): 'synced' | 'waiting' | 'resync' {
        this.bids = new Map(s.bids.map(([p, q]) => [+p, +q]));
        this.asks = new Map(s.asks.map(([p, q]) => [+p, +q]));
        this.snapshotId = s.lastUpdateId;
        const pending = this.buffer.filter((e) => e.u >= s.lastUpdateId);
        this.buffer = [];
        if (!pending.length) return 'waiting';
        if (pending[0].U > s.lastUpdateId) { this.reset(); return 'resync'; }
        this.apply(pending[0]);
        this.state = 'synced';
        for (const e of pending.slice(1)) {
            if (this.onEvent(e) === 'resync') return 'resync';
        }
        return 'synced';
    }

    reset(): void {
        this.state = 'waiting';
        this.bids = new Map();
        this.asks = new Map();
        this.buffer = [];
        this.snapshotId = null;
        this.lastU = null;
    }

    bestBid(): number | null {
        let best: number | null = null;
        for (const p of this.bids.keys()) if (best === null || p > best) best = p;
        return best;
    }

    bestAsk(): number | null {
        let best: number | null = null;
        for (const p of this.asks.keys()) if (best === null || p < best) best = p;
        return best;
    }

    private apply(e: DepthEvent) {
        for (const [p, q] of e.b) { const qty = +q; if (qty === 0) this.bids.delete(+p); else this.bids.set(+p, qty); }
        for (const [p, q] of e.a) { const qty = +q; if (qty === 0) this.asks.delete(+p); else this.asks.set(+p, qty); }
        this.lastU = e.u;
    }
}
