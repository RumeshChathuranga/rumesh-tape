import { BarCache } from '../model/bars';
import { autoRowMult, baseBin } from '../model/bins';
import { sessionCvd } from '../model/cvd';
import { MinuteStore, type StoreSnapshot } from '../model/minutes';
import { TF_MS, type AggTrade, type Candle, type Timeframe } from '../model/types';
import { backfillOlder, fillGap } from './backfill';
import { OrderBook, type DepthEvent } from './book';
import type { Rest } from './rest';
import { MarketStream } from './stream';

export const WS_MARKET = 'wss://fstream.binance.com/market/stream?streams=';
export const WS_PUBLIC = 'wss://fstream.binance.com/public/stream?streams=';

/** Above this many missing trades, a cached store is dropped instead of filled. */
const MAX_CACHE_GAP = 60_000;
const SAVE_EVERY_MS = 60_000;
const RESYNC_MIN_MS = 3_000;
const MAX_BACKFILL_TRIES = 5;
/** Higher timeframes loaded for context (fair value gaps), refreshed by REST. */
const HTF: Timeframe[] = ['1h', '4h'];
const HTF_REFRESH_MS = 60_000;

export interface SessionStatus {
    phase: 'loading' | 'backfilling' | 'live' | 'error';
    error?: string;
    backfillPct: number;
    coveredFrom: number | null;
    bookSynced: boolean;
}

export interface TradeCacheLike {
    load(symbol: string): Promise<StoreSnapshot | null>;
    save(symbol: string, s: StoreSnapshot): Promise<void>;
}

export interface SessionOptions {
    symbol: string;
    tf: Timeframe;
    historyHours: number;
    rest: Rest;
    cache?: TradeCacheLike;
    WebSocketImpl?: typeof WebSocket;
    now?: () => number;
    onChange: () => void;
    /** Pause before retrying a failed request (ms). */
    retryMs?: number;
}

const isAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError';

/**
 * Everything for one symbol and timeframe: candles, real trades (backfilled
 * and live, kept gap-free by id), the synced order book, and the bar cache.
 */
export class MarketSession {
    readonly symbol: string;
    readonly tf: Timeframe;
    candles: Candle[] = [];
    store: MinuteStore | null = null;
    book = new OrderBook();
    bars = new BarCache();
    status: SessionStatus = { phase: 'loading', backfillPct: 0, coveredFrom: null, bookSynced: false };
    tickSize = 0;
    bin = 0;
    candlesVersion = 0;
    /** 1h and 4h candles when the chart timeframe is lower. */
    htf: Partial<Record<Timeframe, Candle[]>> = {};
    htfVersion = 0;

    private readonly ac = new AbortController();
    private readonly now: () => number;
    private market: MarketStream | null = null;
    private pub: MarketStream | null = null;
    private queue: AggTrade[] = [];
    private anchored = false;
    private filling = false;
    private stopped = false;
    private snapshotBusy = false;
    private lastSnapshot = 0;
    private saveTimer: ReturnType<typeof setInterval> | null = null;
    private htfTimer: ReturnType<typeof setInterval> | null = null;
    private cvdMemo: { v: number; values: number[] } | null = null;
    private multMemo: { v: number; mult: number } | null = null;

    constructor(private readonly o: SessionOptions) {
        this.symbol = o.symbol.toUpperCase();
        this.tf = o.tf;
        this.now = o.now ?? Date.now;
    }

    /** Resolves once live trades are flowing; older trades keep loading in the background. */
    async start(): Promise<void> {
        const { rest, cache } = this.o;
        const { tickSize } = await rest.exchangeInfo(this.symbol);
        this.tickSize = tickSize;
        this.candles = await rest.klines(this.symbol, this.tf);
        this.candlesVersion++;
        const last = this.candles[this.candles.length - 1];
        this.bin = baseBin(last ? last.c : 1, tickSize);
        const historyStart = this.now() - this.o.historyHours * 3_600_000;
        await this.loadHtf();

        const snap = cache ? await cache.load(this.symbol).catch(() => null) : null;
        if (snap && snap.bin === this.bin && snap.lastTime !== null && snap.lastTime >= historyStart) {
            this.store = MinuteStore.restore(snap);
        }
        if (this.stopped) return;

        const s = this.symbol.toLowerCase();
        const opts = { WebSocketImpl: this.o.WebSocketImpl };
        this.market = new MarketStream(`${WS_MARKET}${s}@aggTrade/${s}@kline_${this.tf}`, (m) => this.onMarket(m), opts);
        this.pub = new MarketStream(`${WS_PUBLIC}${s}@depth@100ms`, (m) => this.onDepth(m.data as DepthEvent), opts);
        this.pub.onOpen = () => { this.book.reset(); this.status.bookSynced = false; void this.requestSnapshot(); };
        this.market.open();
        this.pub.open();

        await this.anchor(historyStart);
        if (this.stopped) return;
        this.status.phase = 'backfilling';
        this.changed();
        if (cache) this.saveTimer = setInterval(() => void this.save(), SAVE_EVERY_MS);
        if (Object.keys(this.htf).length) this.htfTimer = setInterval(() => void this.loadHtf().then(() => this.changed()), HTF_REFRESH_MS);
        void this.backfill(historyStart);
    }

    async stop(): Promise<void> {
        if (this.stopped) return;
        this.stopped = true;
        this.ac.abort();
        this.market?.close();
        this.pub?.close();
        if (this.saveTimer) clearInterval(this.saveTimer);
        if (this.htfTimer) clearInterval(this.htfTimer);
        await this.save();
    }

    /** Session CVD per candle (resets 00:00 UTC). */
    cvd(): number[] {
        if (!this.cvdMemo || this.cvdMemo.v !== this.candlesVersion) {
            this.cvdMemo = { v: this.candlesVersion, values: sessionCvd(this.candles) };
        }
        return this.cvdMemo.values;
    }

    rowMult(setting: number | 'auto'): number {
        if (setting !== 'auto') return setting;
        if (!this.multMemo || this.multMemo.v !== this.candles.length) {
            this.multMemo = { v: this.candles.length, mult: autoRowMult(this.candles, this.bin) };
        }
        return this.multMemo.mult;
    }

    private async loadHtf() {
        for (const tf of HTF) {
            if (TF_MS[tf] <= TF_MS[this.tf]) continue;
            try { this.htf[tf] = await this.o.rest.klines(this.symbol, tf, 300); }
            catch (e) { console.warn(`${tf} candles failed`, e); }
        }
        this.htfVersion++;
    }

    private async anchor(historyStart: number) {
        const latest = await this.o.rest.aggTradesLatest(this.symbol, this.ac.signal);
        if (this.stopped || !latest.length) { this.anchored = true; return; }
        if (this.store && this.store.lastId !== null) {
            const missing = latest[0].id - this.store.lastId - 1;
            if (missing > MAX_CACHE_GAP) this.store = null;
            else if (missing > 0) await fillGap(this.o.rest, this.symbol, this.store, latest[0].id, { signal: this.ac.signal });
        }
        if (!this.store) this.store = new MinuteStore(this.bin);
        this.store.applyNewer(latest);
        this.anchored = true;
        this.updateProgress(historyStart, latest[latest.length - 1].time);
        await this.drain();
    }

    private async backfill(historyStart: number) {
        const store = this.store;
        if (!store) return;
        const anchorTime = store.lastTime ?? this.now();
        try {
            // A dropped request shouldn't end the history load: retry from where it stopped.
            for (let attempt = 1; ; attempt++) {
                try {
                    await backfillOlder(this.o.rest, this.symbol, store, historyStart, {
                        signal: this.ac.signal,
                        onPage: () => { this.updateProgress(historyStart, anchorTime); this.changed(); },
                    });
                    break;
                } catch (e) {
                    if (isAbort(e) || this.stopped || attempt >= MAX_BACKFILL_TRIES) throw e;
                    console.warn('backfill page failed, retrying', e);
                    await this.pause();
                }
            }
            if (this.stopped) return;
            this.status.phase = 'live';
            this.status.backfillPct = 100;
            this.changed();
            await this.save();
        } catch (e) {
            if (isAbort(e) || this.stopped) return;
            this.status.phase = 'error';
            this.status.error = (e as Error).message;
            this.changed();
        }
    }

    /** Wait `retryMs`, or less if the session stops. */
    private pause(): Promise<void> {
        return new Promise((resolve) => {
            if (this.ac.signal.aborted) { resolve(); return; }
            const t = setTimeout(resolve, this.o.retryMs ?? 3000);
            this.ac.signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
        });
    }

    private updateProgress(historyStart: number, anchorTime: number) {
        const first = this.store?.firstTime ?? anchorTime;
        const span = anchorTime - historyStart;
        this.status.backfillPct = span <= 0 ? 100 : Math.max(0, Math.min(100, Math.round(((anchorTime - first) / span) * 100)));
    }

    private onMarket(msg: { stream: string; data: any }) {
        if (this.stopped) return;
        const d = msg.data;
        if (msg.stream.endsWith('@aggTrade')) {
            this.onTrade({ id: d.a, price: +d.p, qty: +d.q, time: d.T, buyerMaker: d.m });
        } else if (msg.stream.includes('@kline_')) {
            const k = d.k;
            const c: Candle = { t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v, buyV: +k.V };
            const last = this.candles[this.candles.length - 1];
            if (last && last.t === c.t) this.candles[this.candles.length - 1] = c;
            else if (!last || c.t > last.t) this.candles.push(c);
            this.candlesVersion++;
            this.changed();
        }
    }

    private onTrade(t: AggTrade) {
        if (!this.anchored || this.filling || !this.store) { this.queue.push(t); return; }
        const r = this.store.applyNewer([t]);
        if (!r.ok) {
            this.queue.push(t);
            void this.fill(r.gapTo + 1);
            return;
        }
        this.storeChanged();
    }

    /** Fetch missing ids up to `toId`, then apply everything that queued meanwhile. */
    private async fill(toId: number) {
        if (this.filling || !this.store) return;
        this.filling = true;
        try {
            await fillGap(this.o.rest, this.symbol, this.store, toId, { signal: this.ac.signal });
        } catch (e) {
            if (isAbort(e)) { this.filling = false; return; }
            console.error('gap fill failed, retrying', e);
            await this.pause();   // still "filling": newer trades keep queueing
        }
        this.filling = false;
        if (!this.stopped) await this.drain();
    }

    private async drain() {
        if (!this.store || !this.queue.length) return;
        const pending = this.queue.sort((a, b) => a.id - b.id);
        this.queue = [];
        const r = this.store.applyNewer(pending);
        if (!r.ok) {
            this.queue = pending.filter((t) => t.id > this.store!.lastId!);
            await this.fill(r.gapTo + 1);
        }
        this.storeChanged();
    }

    private storeChanged() {
        const d = this.store?.takeDirty() ?? null;
        if (d !== null) this.bars.invalidateFrom(d);
        this.status.coveredFrom = this.store?.coveredFrom() ?? null;
        this.changed();
    }

    private onDepth(e: DepthEvent) {
        if (this.stopped || !e) return;
        if (this.book.onEvent(e) === 'resync') void this.requestSnapshot();
        const synced = this.book.state === 'synced';
        if (synced !== this.status.bookSynced) { this.status.bookSynced = synced; this.changed(); }
    }

    private async requestSnapshot() {
        if (this.snapshotBusy || this.stopped) return;
        this.snapshotBusy = true;
        try {
            const wait = this.lastSnapshot + RESYNC_MIN_MS - this.now();
            if (this.lastSnapshot && wait > 0) await new Promise((r) => setTimeout(r, wait));
            this.lastSnapshot = this.now();
            const snap = await this.o.rest.depth(this.symbol, this.ac.signal);
            if (this.stopped) return;
            const r = this.book.loadSnapshot(snap);
            this.status.bookSynced = this.book.state === 'synced';
            this.changed();
            if (r === 'resync') { this.snapshotBusy = false; void this.requestSnapshot(); }
        } catch (e) {
            if (!isAbort(e)) console.error('depth snapshot failed', e);
        } finally {
            this.snapshotBusy = false;
        }
    }

    private async save() {
        if (this.o.cache && this.store && this.store.lastId !== null) {
            try { await this.o.cache.save(this.symbol, this.store.serialize()); } catch (e) { console.error('cache save failed', e); }
        }
    }

    private changed() {
        if (!this.stopped) this.o.onChange();
    }
}
