import { binIndex } from './bins';
import { append, canAppend, canPrepend, prepend, startGroup, toPrint, type Group } from './prints';
import type { AggTrade, Cells, Print } from './types';

const MINUTE = 60_000;
const minuteOf = (time: number) => Math.floor(time / MINUTE) * MINUTE;

export interface Minute {
    t: number;
    cells: Cells;
    prints: Print[];
}

export type ApplyResult = { ok: true } | { ok: false; gapFrom: number; gapTo: number };

export interface StoreSnapshot {
    bin: number;
    minPrintNotional: number;
    firstId: number | null;
    lastId: number | null;
    firstTime: number | null;
    lastTime: number | null;
    minutes: [number, [number, number, number][], Print[]][];
}

/**
 * Real trades bucketed into 1-minute footprints at the base bin. Trades are
 * kept contiguous by aggTrade id, so "covered" really means no trade is missing.
 */
export class MinuteStore {
    firstId: number | null = null;
    lastId: number | null = null;
    firstTime: number | null = null;
    lastTime: number | null = null;
    version = 0;

    private mins = new Map<number, Minute>();
    private head: Group | null = null;   // open print at the oldest end
    private tail: Group | null = null;   // open print at the newest end
    private dirty: number | null = null;

    constructor(readonly bin: number, readonly minPrintNotional = 10_000) {}

    /** Add newer trades (ascending ids). Returns the missing id range instead if ids skip ahead. */
    applyNewer(trades: AggTrade[]): ApplyResult {
        const fresh = this.lastId === null ? trades : trades.filter((t) => t.id > this.lastId!);
        if (!fresh.length) return { ok: true };
        if (this.lastId !== null && fresh[0].id > this.lastId + 1) {
            return { ok: false, gapFrom: this.lastId + 1, gapTo: fresh[0].id - 1 };
        }
        for (let i = 0; i < fresh.length; i++) {
            const t = fresh[i];
            if (i > 0 && t.id !== fresh[i - 1].id + 1) {
                this.version++;
                return { ok: false, gapFrom: this.lastId! + 1, gapTo: t.id - 1 };
            }
            this.addCell(t);
            this.extendTail(t);
            if (this.firstId === null) { this.firstId = t.id; this.firstTime = t.time; }
            this.lastId = t.id;
            this.lastTime = t.time;
        }
        this.version++;
        return { ok: true };
    }

    /** Add older trades (ascending ids) that end right before `firstId`. */
    applyOlder(trades: AggTrade[]): void {
        if (this.firstId === null) { this.applyNewer(trades); return; }
        const older = trades.filter((t) => t.id < this.firstId!);
        if (!older.length) return;
        for (let i = 1; i < older.length; i++) {
            if (older[i].id !== older[i - 1].id + 1) throw new Error('not contiguous');
        }
        if (older[older.length - 1].id !== this.firstId - 1) throw new Error('not contiguous');
        for (let i = older.length - 1; i >= 0; i--) {
            const t = older[i];
            this.addCell(t);
            this.extendHead(t);
        }
        this.firstId = older[0].id;
        this.firstTime = older[0].time;
        this.version++;
    }

    /** Start of the first minute whose trades are all here, or null when empty. */
    coveredFrom(): number | null {
        return this.firstTime === null ? null : minuteOf(this.firstTime) + MINUTE;
    }

    cellsBetween(from: number, to: number): Cells {
        const out: Cells = new Map();
        for (let t = minuteOf(from); t < to; t += MINUTE) {
            const m = this.mins.get(t);
            if (!m || t < from) continue;
            for (const [k, c] of m.cells) {
                const o = out.get(k);
                if (o) { o.bid += c.bid; o.ask += c.ask; } else out.set(k, { bid: c.bid, ask: c.ask });
            }
        }
        return out;
    }

    printsBetween(from: number, to: number): Print[] {
        const out: Print[] = [];
        for (let t = minuteOf(from); t < to; t += MINUTE) {
            const m = this.mins.get(t);
            if (m) for (const p of m.prints) if (p.time >= from && p.time < to) out.push(p);
        }
        for (const g of new Set([this.head, this.tail])) {
            if (g && g.notional >= this.minPrintNotional && g.time >= from && g.time < to) out.push(toPrint(g));
        }
        return out.sort((a, b) => a.firstId - b.firstId);
    }

    /** Earliest minute changed since the last call (for cache invalidation), then resets. */
    takeDirty(): number | null {
        const d = this.dirty;
        this.dirty = null;
        return d;
    }

    serialize(): StoreSnapshot {
        const minutes: StoreSnapshot['minutes'] = [];
        for (const m of [...this.mins.values()].sort((a, b) => a.t - b.t)) {
            const prints = [...m.prints];
            for (const g of new Set([this.head, this.tail])) {
                if (g && minuteOf(g.time) === m.t && g.notional >= this.minPrintNotional) prints.push(toPrint(g));
            }
            minutes.push([m.t, [...m.cells].map(([k, c]) => [k, c.bid, c.ask]), prints]);
        }
        const { bin, minPrintNotional, firstId, lastId, firstTime, lastTime } = this;
        return { bin, minPrintNotional, firstId, lastId, firstTime, lastTime, minutes };
    }

    static restore(s: StoreSnapshot): MinuteStore {
        const store = new MinuteStore(s.bin, s.minPrintNotional);
        store.firstId = s.firstId;
        store.lastId = s.lastId;
        store.firstTime = s.firstTime;
        store.lastTime = s.lastTime;
        for (const [t, cells, prints] of s.minutes) {
            store.mins.set(t, { t, cells: new Map(cells.map(([k, bid, ask]) => [k, { bid, ask }])), prints });
        }
        return store;
    }

    private minute(time: number): Minute {
        const t = minuteOf(time);
        let m = this.mins.get(t);
        if (!m) { m = { t, cells: new Map(), prints: [] }; this.mins.set(t, m); }
        return m;
    }

    private addCell(t: AggTrade) {
        const m = this.minute(t.time);
        const k = binIndex(t.price, this.bin);
        let c = m.cells.get(k);
        if (!c) { c = { bid: 0, ask: 0 }; m.cells.set(k, c); }
        if (t.buyerMaker) c.bid += t.qty; else c.ask += t.qty;
        if (this.dirty === null || m.t < this.dirty) this.dirty = m.t;
    }

    private commit(g: Group) {
        if (g.notional >= this.minPrintNotional) this.minute(g.time).prints.push(toPrint(g));
    }

    private extendTail(t: AggTrade) {
        if (this.tail && canAppend(this.tail, t)) { append(this.tail, t); return; }
        const old = this.tail;
        this.tail = startGroup(t);
        if (!this.head) this.head = this.tail;
        if (old && old !== this.head) this.commit(old);
    }

    private extendHead(t: AggTrade) {
        if (this.head && canPrepend(this.head, t)) { prepend(this.head, t); return; }
        const old = this.head;
        this.head = startGroup(t);
        if (!this.tail) this.tail = this.head;
        if (old && old !== this.tail) this.commit(old);
    }
}
