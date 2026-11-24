// Browser smoke test for the v2 engine (public-site/v2) against live Binance data.
//
// Run:  node tests/smoke-v2.mjs     (build first: cd v2 && npm run build)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, makeChecks, OPEN_SOCKETS, sleep, SOCKET_TRACKER, startBrowser } from './cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL = 'http://127.0.0.1:8796/v2/';
const S = `__rt.session`;
const READY = `${S} && ${S}.candles.length > 0 && ${S}.store && ${S}.status.coveredFrom !== null`;

const { check, fail, report } = makeChecks();
let b;

async function main() {
    b = await startBrowser({ site: join(ROOT, 'public-site'), httpPort: 8796, cdpPort: 9336, init: [SOCKET_TRACKER] });
    await b.navigate(URL);
    await b.waitFor(`typeof __rt !== 'undefined'`, 20000, 'page script');
    await b.evaluate(`localStorage.setItem('rumeshTape.v2', JSON.stringify({ symbol: 'LTCUSDT', tf: '1m', historyHours: 1 }))`);
    await b.reload();

    await check('loads live data with real trades', async () => {
        await b.waitFor(`${READY} && ${S}.symbol === 'LTCUSDT'`, 60000, 'session ready');
        await sleep(3000);
        assert(b.exceptions.length === 0, 'exceptions: ' + b.exceptions.join(' | '));
    });

    await check('footprint cells add up to the exchange candle', async () => {
        // A closed bar, at least two minutes old, fully covered by real trades.
        await b.waitFor(`(() => { const s = ${S}; const n = s.candles.length;
            return n > 3 && s.candles[n - 3].t >= s.status.coveredFrom; })()`, 120000, 'a closed covered bar');
        const r = await b.evaluate(`(() => {
            const s = ${S}, n = s.candles.length;
            const i = n - 3;   // newest bar that is surely closed
            const c = s.candles[i];
            const bar = s.bars.bar(c, 60000, s.store, 1, false);
            let bid = 0, ask = 0;
            for (const cell of bar.rows.values()) { bid += cell.bid; ask += cell.ask; }
            return { real: bar.real, v: c.v, buyV: c.buyV, total: bid + ask, ask };
        })()`);
        assert(r.real, 'bar not real');
        const rel = (a, b) => Math.abs(a - b) / Math.max(1e-12, Math.abs(b));
        assert(rel(r.total, r.v) < 1e-6, `cells ${r.total} vs candle volume ${r.v}`);
        assert(rel(r.ask, r.buyV) < 1e-6, `ask ${r.ask} vs taker-buy volume ${r.buyV}`);
    });

    await check('order book syncs', async () => {
        await b.waitFor(`${S}.status.bookSynced`, 20000, 'book synced');
        const ok = await b.evaluate(`${S}.book.bestBid() < ${S}.book.bestAsk()`);
        assert(ok, 'best bid not below best ask');
    });

    await check('scalp panel shows the window and sizes a trade', async () => {
        await b.waitFor(`/US open window \\d\\d:\\d\\d/.test(document.getElementById('scalp').textContent)`, 20000, 'window line');
        await b.evaluate(`(() => {
            const inputs = [...document.querySelectorAll('#scalp .sp-field input')];
            ['1000', '0.5', '60000', '59910'].forEach((v, i) => { inputs[i].value = v; inputs[i].dispatchEvent(new Event('input', { bubbles: true })); });
        })()`);
        const out = await b.evaluate(`document.querySelector('#scalp .sp-out').textContent`);
        assert(/Position2,27\d\.\d\d USDT/.test(out), 'calculator output: ' + out);
        assert(out.includes('60225'), 'target missing: ' + out);
    });

    await check('switching cell mode renders without errors', async () => {
        for (const label of ['Delta', 'Volume', 'Bid × Ask']) {
            await b.evaluate(`[...document.querySelectorAll('header button')].find(x => x.textContent === ${JSON.stringify(label)}).click()`);
            await sleep(400);
        }
        const mode = await b.evaluate(`__rt.settings.mode`);
        assert(mode === 'bidask', 'mode ' + mode);
        assert(b.exceptions.length === 0, 'exceptions: ' + b.exceptions.join(' | '));
    });

    await check('unknown symbol keeps the current one', async () => {
        await b.evaluate(`(() => { const i = document.querySelector('input.sym'); i.value = 'NOTACOIN';
            i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
        await b.waitFor(`document.querySelector('.sym-error').textContent === 'Unknown symbol'`, 10000, 'error text');
        assert(await b.evaluate(`${S}.symbol === 'LTCUSDT'`), 'session changed');
    });

    await check('switching symbol leaves only the new symbol connected', async () => {
        await b.evaluate(`(() => { const i = document.querySelector('input.sym'); i.value = 'XRPUSDT';
            i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
        await b.waitFor(`${S} && ${S}.symbol === 'XRPUSDT' && ${READY}`, 60000, 'XRPUSDT ready');
        await sleep(4500);
        const urls = await b.evaluate(OPEN_SOCKETS);
        assert(urls.length === 2 && urls.every((u) => u.includes('xrpusdt')), 'open sockets: ' + JSON.stringify(urls));
    });

    await check('settings and cached trades survive a reload', async () => {
        await b.waitFor(`${S}.status.phase === 'live'`, 180000, 'XRP backfill finished (and cached)');
        const before = await b.evaluate(`${S}.store.firstId`);
        await b.reload();
        await b.waitFor(`${READY} && ${S}.symbol === 'XRPUSDT'`, 60000, 'ready after reload');
        const s = await b.evaluate(`({ sym: __rt.settings.symbol, tf: __rt.settings.tf, first: ${S}.store.firstId })`);
        assert(s.sym === 'XRPUSDT' && s.tf === '1m', 'settings ' + JSON.stringify(s));
        assert(s.first <= before, `firstId ${s.first} > cached ${before}`);
    });

    await check('no uncaught errors during the run', async () => {
        assert(b.exceptions.length === 0, 'exceptions: ' + b.exceptions.join(' | '));
    });
}

main()
    .catch((e) => fail('harness', e.message))
    .finally(() => {
        b?.close();
        process.exit(report() ? 1 : 0);
    });
