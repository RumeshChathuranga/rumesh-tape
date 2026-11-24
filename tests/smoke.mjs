// Browser smoke test for the built v1 page (public-site/index.html).
//
// Serves public-site on 127.0.0.1, drives headless Chrome over the DevTools
// protocol and checks the Phase 0 behaviour against live Binance data.
//
// Run:  node tests/smoke.mjs        (needs google-chrome and network access)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, makeChecks, OPEN_SOCKETS, sleep, SOCKET_TRACKER, startBrowser } from './cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL = 'http://127.0.0.1:8799/';
const READY = `typeof STATES !== 'undefined' && STATES[SETTINGS.symbol] && STATES[SETTINGS.symbol].bars.length > 0
  && document.getElementById('loader').style.display === 'none'`;

const { check, fail, report } = makeChecks();
let b, exceptions;
const evaluate = (x) => b.evaluate(x);
const waitFor = (x, ms, label) => b.waitFor(x, ms, label);

async function openPage(reload) {
  if (reload) await b.reload();
  else await b.navigate(URL);
  await sleep(500);
  await waitFor(READY, 45000, 'chart loaded');
}

async function switchSymbol(sym) {
  await evaluate(`(() => { const i = document.getElementById('symbol-input'); i.value = '${sym}';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await waitFor(`SETTINGS.symbol === '${sym}' && ${READY}`, 45000, sym + ' loaded');
}

async function main() {
  b = await startBrowser({ site: join(ROOT, 'public-site'), httpPort: 8799, cdpPort: 9333, init: [SOCKET_TRACKER] });
  exceptions = b.exceptions;
  await openPage(false);

  await check('loads with no uncaught errors', async () => {
    await sleep(3000);
    assert(exceptions.length === 0, 'exceptions: ' + exceptions.join(' | '));
  });

  await check('30m timeframe loads 30-minute bars', async () => {
    const has = await evaluate(`!!document.querySelector('#tf-seg button[data-tf="30m"]')`);
    assert(has, 'no 30m button');
    await evaluate(`document.querySelector('#tf-seg button[data-tf="30m"]').click()`);
    await waitFor(`SETTINGS.tf === '30m' && SETTINGS.tfMs === 1800000 && ${READY}`, 30000, '30m bars');
    const gap = await evaluate(`(() => { const b = STATES[SETTINGS.symbol].bars; return b[b.length - 1].t - b[b.length - 2].t; })()`);
    assert(gap === 1800000, 'bar spacing ' + gap);
  });

  await check('an error shows a toast and buttons keep working', async () => {
    await evaluate(`setTimeout(() => { throw new Error('smoke-test-error'); }, 0)`);
    await sleep(400);
    const toast = await evaluate(`(document.getElementById('rt-error') || {}).textContent || ''`);
    assert(toast.includes('smoke-test-error'), 'toast text: ' + JSON.stringify(toast));
    const flipped = await evaluate(`(() => { const before = SETTINGS.showFootprint;
      document.getElementById('foot-btn').click(); const after = SETTINGS.showFootprint;
      document.getElementById('foot-btn').click(); return before !== after; })()`);
    assert(flipped, 'footprint button stopped working');
    exceptions.splice(0, exceptions.length, ...exceptions.filter((e) => !String(e).includes('smoke-test-error')));
  });

  await check('switching symbol leaves only the new symbol connected', async () => {
    await switchSymbol('ETHUSDT');
    await sleep(4500); // longer than the engine's 3 s reconnect delay
    const urls = await evaluate(OPEN_SOCKETS);
    assert(urls.length === 2, 'open sockets: ' + JSON.stringify(urls));
    assert(urls.every((u) => u.includes('ethusdt')), 'open sockets: ' + JSON.stringify(urls));
    await switchSymbol('BTCUSDT');
    await sleep(4500);
    const back = await evaluate(OPEN_SOCKETS);
    assert(back.length === 2 && back.every((u) => u.includes('btcusdt')), 'after return: ' + JSON.stringify(back));
  });

  await check('data badge shows when real trades start', async () => {
    await waitFor(`/Real from \\d\\d:\\d\\d/.test(document.getElementById('data-badge').textContent)`, 20000, 'badge text');
  });

  await check('studies, timeframe, thresholds and drawings survive a reload', async () => {
    await evaluate(`(() => { const row = document.querySelector('.sheet-toggle[data-key="showDelta"]');
      if (!SETTINGS.showDelta) row.click(); })()`);
    await evaluate(`drawings.push({ type: 'h-line', p: 12345, color: '#8CC2FF' })`);
    await evaluate(`(() => { const m = document.getElementById('size-med-input'); m.value = '2500';
      m.dispatchEvent(new Event('change', { bubbles: true }));
      const w = document.getElementById('whale-thres-input'); w.value = '33';
      w.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await sleep(1500);
    await openPage(true);
    await sleep(2500);
    const s = await evaluate(`({ tf: SETTINGS.tf, delta: SETTINGS.showDelta, whale: SETTINGS.whaleThres,
      med: document.getElementById('size-med-input').value,
      line: drawings.some(d => d.type === 'h-line' && d.p === 12345) })`);
    assert(s.tf === '30m', 'tf ' + s.tf);
    assert(s.delta === true, 'delta not restored');
    assert(s.med === '2500', 'medium trade ' + s.med);
    assert(s.whale === 33, 'whale ' + s.whale);
    assert(s.line, 'drawing not restored');
  });

  await check('drawings are kept per symbol', async () => {
    await switchSymbol('ETHUSDT');
    await sleep(1000);
    const onEth = await evaluate(`drawings.some(d => d.p === 12345)`);
    assert(!onEth, 'BTC drawing shown on ETH');
    await switchSymbol('BTCUSDT');
    await sleep(1000);
    const onBtc = await evaluate(`drawings.some(d => d.p === 12345)`);
    assert(onBtc, 'BTC drawing lost after switching back');
  });

  await check('no uncaught errors during the run', async () => {
    assert(exceptions.length === 0, 'exceptions: ' + exceptions.join(' | '));
  });
}

main()
  .catch((e) => fail('harness', e.message))
  .finally(() => {
    b?.close();
    process.exit(report() ? 1 : 0);
  });
