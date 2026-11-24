import './ui/styles.css';
import { TradeCache } from './data/cache';
import { createRest, UnknownSymbolError } from './data/rest';
import { MarketSession } from './data/session';
import { findFvgs, fvgBias, type Fvg } from './model/fvg';
import { printThreshold } from './model/prints';
import { detectSetup, type Setup } from './model/setup';
import { buildZones, ZoneTracker, type Zone } from './model/zones';
import { TF_MS } from './model/types';
import { Chart, type ChartSource } from './render/chart';
import { drawFvgs } from './render/fvg';
import { drawLevels } from './render/levels';
import { Alerts } from './ui/alerts';
import { openGuideOnce } from './ui/guide';
import { ScalpPanel } from './ui/scalp';
import { loadSettings, saveSettings, type Settings } from './ui/settings';
import { Topbar } from './ui/topbar';

const decimalsOf = (step: number) => (step >= 1 ? 0 : Math.min(10, Math.round(-Math.log10(step))));
const pad2 = (n: number) => (n < 10 ? '0' : '') + n;
const hhmm = (t: number) => { const d = new Date(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

let settings = loadSettings(localStorage);
const rest = createRest();
const chart = new Chart(document.getElementById('chart')!);
const topbar = new Topbar(document.getElementById('topbar')!, settings, (patch) => void apply(patch));
let session: MarketSession | null = null;
let cache: TradeCache | undefined;
const alerts = new Alerts();
const scalpHost = document.getElementById('scalp')!;
const panel = new ScalpPanel(scalpHost, alerts);

function sourceFor(s: MarketSession): ChartSource {
    return {
        get length() { return s.candles.length; },
        candle: (i) => s.candles[i],
        bar: (i) => s.bars.bar(s.candles[i], TF_MS[s.tf], s.store, s.rowMult(settings.rowMult), i === s.candles.length - 1),
        cvd: (i) => s.cvd()[i],
        prints: (from, to) => s.store?.printsBetween(from, to) ?? [],
        get rowSize() { return s.bin * s.rowMult(settings.rowMult); },
        tfMs: TF_MS[s.tf],
        get priceDecimals() { return decimalsOf(s.tickSize || 1); },
        get coveredFrom() { return s.status.coveredFrom; },
        get book() { return s.book; },
        get bookSynced() { return s.status.bookSynced; },
    };
}

// "Auto" big trades: the largest 0.5% of the last hour's market orders, refreshed every 5 s.
let autoBig = { at: 0, value: 100_000 };
function bigPrintUsd(): number {
    if (settings.bigPrintUsd !== 'auto') return settings.bigPrintUsd;
    const s = session, now = Date.now();
    if (s?.store && now - autoBig.at > 5_000) autoBig = { at: now, value: printThreshold(s.store.printsBetween(now - 3_600_000, now + 60_000)) };
    return autoBig.value;
}

// Fair value gaps, recomputed at most once a second (candles change on every kline message).
let fvgMemo = { at: 0, v: -1, h: -1, list: [] as Fvg[], bias: null as ReturnType<typeof fvgBias> };
function fvgs(): Fvg[] {
    const s = session;
    if (!s || !s.candles.length) return [];
    const now = performance.now();
    if (now - fvgMemo.at > 1000 || fvgMemo.h !== s.htfVersion) {
        const own = findFvgs(s.candles, s.tf);
        let list = own;
        if (settings.fvg === 'all') for (const [tf, cs] of Object.entries(s.htf)) if (cs) list = list.concat(findFvgs(cs, tf as Fvg['tf']));
        fvgMemo = { at: now, v: s.candlesVersion, h: s.htfVersion, list, bias: fvgBias(own) };
    }
    return fvgMemo.list;
}

// ---- strategy: zones, first touches, setups (checked at most once a second)
let tracker = new ZoneTracker();
let zones: Zone[] = [];
let latestSetup: Setup | null = null;
/** The strategy's bias (15m gaps, else the chart's), shown in both the top bar and the panel. */
let strategyBias: 'bullish' | 'bearish' | null = null;
let scalpAt = 0;
let scanFrom = 0;
function scalpTick(force = false) {
    const s = session;
    const now = Date.now();
    if (!s || !s.store || !s.candles.length || (!force && now - scalpAt < 1000)) return;
    const price = s.candles[s.candles.length - 1].c;
    // Price range traded since the last check (whole current minute, so wicks count).
    let lo = price, hi = price;
    for (const k of s.store.cellsBetween(Math.min(scanFrom || now, now) - 60_000, now + 60_000).keys()) {
        lo = Math.min(lo, k * s.bin);
        hi = Math.max(hi, (k + 1) * s.bin);
    }
    scanFrom = now;
    scalpAt = now;
    const htfFvgs: Fvg[] = [];
    for (const [tf, cs] of Object.entries(s.htf)) if (cs) htfFvgs.push(...findFvgs(cs, tf as Fvg['tf']));
    if (TF_MS[s.tf] >= TF_MS['15m']) htfFvgs.push(...findFvgs(s.candles, s.tf));
    const bias = fvgBias(findFvgs(s.htf['15m'] ?? (s.tf === '15m' ? s.candles : []), '15m')) ?? fvgMemo.bias;
    strategyBias = bias;
    zones = buildZones({ price, fvgs: htfFvgs, profiles: s.context.profiles, nakedPocs: s.context.nakedPocs, bias, tolerance: s.bin * s.rowMult('auto') });
    const dec = decimalsOf(s.tickSize || 1);
    for (const z of tracker.update(zones, lo, hi, now)) {
        alerts.push({ key: `zone:${s.symbol}:${z.id}`, time: now, kind: 'zone', title: `${s.symbol} reached ${z.label}`,
            body: `${z.grade} zone ${z.bottom.toFixed(dec)}–${z.top.toFixed(dec)}. Wait for confirmation on the footprint.` });
    }
    if (bias && s.status.coveredFrom !== null) {
        const n = s.candles.length, from = Math.max(0, n - 40);
        const src = sourceFor(s);
        const bars = [];
        for (let i = from; i < n; i++) bars.push(src.bar(i));
        for (const z of zones) {
            const t = tracker.touchedAt(z.id);
            if (t === null || (bias === 'bullish') !== (z.side === 'support')) continue;
            const st = detectSetup(bars, z, t, s.tickSize);
            if (!st) continue;
            if (!latestSetup || st.time >= latestSetup.time) latestSetup = st;
            alerts.push({ key: `setup:${s.symbol}:${st.key}`, time: now, kind: 'setup',
                title: `${st.dir === 'long' ? 'Long' : 'Short'} setup on ${s.symbol} at ${z.label}`,
                body: `${st.signals.join(', ')} · entry ${st.entry.toFixed(dec)} · stop ${st.stop.toFixed(dec)}` });
        }
    }
    panel.update({ now, bias, zones, touched: (id) => tracker.touchedAt(id), setup: latestSetup, price, decimals: dec });
}
setInterval(() => scalpTick(true), 15_000);

chart.overlay = (ctx, h) => {
    const s = session;
    if (settings.showLevels && s) {
        const today = s.context.candles1m.slice(-s.context.vwap.length);
        drawLevels(ctx, h, {
            vwap: today.map((c, i) => ({ t: c.t, v: s.context.vwap[i] })),
            profile: s.context.profiles.length >= 2 ? s.context.profiles[s.context.profiles.length - 2] : null,
            nakedPocs: s.context.nakedPocs,
            zones,
            touched: (id) => tracker.touchedAt(id),
        });
    }
    if (settings.fvg !== 'off') drawFvgs(ctx, fvgs(), h, settings.showMitigated);
};

function applyChartOptions() {
    chart.options = { mode: settings.mode, showCvd: settings.showCvd, showBook: settings.showBook, bigPrintUsd: bigPrintUsd() };
}

// Live data can arrive hundreds of times a second: redraw at most every 100 ms for data.
let lastData = 0;
let dataTimer: ReturnType<typeof setTimeout> | null = null;
function onData() {
    const wait = lastData + 100 - performance.now();
    if (wait > 0) { dataTimer ??= setTimeout(() => { dataTimer = null; onData(); }, wait); return; }
    lastData = performance.now();
    refreshStatus();
    fvgs();
    scalpTick();
    topbar.setBias(strategyBias);
    applyChartOptions();
    chart.requestRender();
}

function refreshStatus() {
    const s = session;
    if (!s) return;
    const st = s.status;
    if (st.phase === 'error') topbar.setStatus('Connection problem', 'error');
    else if (st.phase === 'loading') topbar.setStatus('Loading', 'loading');
    else if (st.phase === 'backfilling') topbar.setStatus(`Loading trades ${st.backfillPct}%`, 'loading');
    else topbar.setStatus(st.coveredFrom ? `Real from ${hhmm(st.coveredFrom)}` : 'Live', 'live');
    const last = s.candles[s.candles.length - 1];
    if (last) {
        const dec = decimalsOf(s.tickSize || 1);
        topbar.setPrice(last.c, dec);
        document.title = `${last.c.toFixed(dec)} · ${s.symbol} · Rumesh Tape`;
    }
}

async function startSession() {
    const old = session;
    session = null;
    if (old) void old.stop();
    const s = new MarketSession({
        symbol: settings.symbol, tf: settings.tf, historyHours: settings.historyHours,
        rest, cache, onChange: () => { if (session === s) onData(); },
    });
    session = s;
    tracker = new ZoneTracker();
    zones = [];
    latestSetup = null;
    strategyBias = null;
    scanFrom = 0;
    autoBig = { at: 0, value: 100_000 };
    fvgMemo = { at: 0, v: -1, h: -1, list: [], bias: null };
    chart.source = sourceFor(s);
    chart.resetView();
    topbar.setStatus('Loading', 'loading');
    try {
        await s.start();
        if (session !== s) return;
        topbar.setRowOptions(s.bin, s.rowMult('auto'), decimalsOf(s.bin));
        onData();
    } catch (e) {
        if (session !== s) return;
        console.error(e);
        topbar.setStatus('Connection problem', 'error');
    }
}

async function apply(patch: Partial<Settings>) {
    if (patch.symbol && patch.symbol !== settings.symbol) {
        // Check the symbol before dropping the one that works.
        try {
            await rest.exchangeInfo(patch.symbol);
            topbar.setSymbolError(null);
        } catch (e) {
            topbar.setSymbolError(e instanceof UnknownSymbolError ? 'Unknown symbol' : 'Could not check symbol');
            return;
        }
    }
    const restart = (['symbol', 'tf', 'historyHours'] as const).some((k) => k in patch && patch[k] !== settings[k]);
    settings = { ...settings, ...patch };
    saveSettings(settings, localStorage);
    topbar.sync(settings);
    scalpHost.hidden = !settings.showScalp;
    applyChartOptions();
    if ('fvg' in patch) fvgMemo.at = 0;
    if (restart) await startSession();
    else chart.requestRender();
}

async function boot() {
    scalpHost.hidden = !settings.showScalp;
    applyChartOptions();
    try { cache = await TradeCache.open(); } catch (e) { console.warn('IndexedDB unavailable, trades will not be cached', e); }
    openGuideOnce();
    await startSession();
}

window.addEventListener('pagehide', () => { void session?.stop(); });

// Debug handle (used by the browser smoke test).
(window as unknown as { __rt: unknown }).__rt = {
    get session() { return session; },
    get settings() { return settings; },
    chart,
};

void boot();
