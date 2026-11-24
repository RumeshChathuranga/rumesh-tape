// Browser smoke test for the built page (public-site/index.html).
//
// Serves public-site on 127.0.0.1, drives headless Chrome over the DevTools
// protocol and checks the Phase 0 behaviour against live Binance data.
//
// Run:  node tests/smoke.mjs        (needs google-chrome and network access)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTTP_PORT = 8799;
const CDP_PORT = 9333;
const URL = `http://127.0.0.1:${HTTP_PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Counts the sockets the page opens, so leaks are visible.
const SOCKET_TRACKER = `(() => {
  const W = window.WebSocket;
  window.__sockets = [];
  function Tracked(url, protocols) {
    const s = protocols === undefined ? new W(url) : new W(url, protocols);
    window.__sockets.push(s);
    return s;
  }
  Tracked.prototype = W.prototype;
  Object.assign(Tracked, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.WebSocket = Tracked;
})();`;

const procs = [];
const profile = mkdtempSync(join(tmpdir(), 'rt-smoke-'));
let ws, nextId = 1;
const pending = new Map();
const exceptions = [];

function cleanup() {
  try { ws && ws.close(); } catch {}
  for (const p of procs) { try { p.kill('SIGKILL'); } catch {} }
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('evaluate failed: ' + expression + '\n' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}

async function waitFor(expression, timeout = 30000, label = expression) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { if (await evaluate(expression)) return; } catch {}
    await sleep(250);
  }
  throw new Error('timed out waiting for: ' + label);
}

const READY = `typeof STATES !== 'undefined' && STATES[SETTINGS.symbol] && STATES[SETTINGS.symbol].bars.length > 0
  && document.getElementById('loader').style.display === 'none'`;
const OPEN_SOCKETS = `window.__sockets.filter(s => s.readyState <= 1).map(s => s.url)`;

async function openPage(reload) {
  if (reload) await send('Page.reload', { ignoreCache: true });
  else await send('Page.navigate', { url: URL });
  await sleep(500);
  await waitFor(READY, 45000, 'chart loaded');
}

async function switchSymbol(sym) {
  await evaluate(`(() => { const i = document.getElementById('symbol-input'); i.value = '${sym}';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await waitFor(`SETTINGS.symbol === '${sym}' && ${READY}`, 45000, sym + ' loaded');
}

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function main() {
  procs.push(spawn('python3', ['-m', 'http.server', String(HTTP_PORT), '--bind', '127.0.0.1', '-d', join(ROOT, 'public-site')], { stdio: 'ignore' }));
  procs.push(spawn('google-chrome', ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' }));

  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((t) => t.type === 'page'); }
    catch {}
    if (!target) await sleep(250);
  }
  if (!target) throw new Error('Chrome did not start');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id).resolve(msg.result || msg); pending.delete(msg.id); }
    else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      exceptions.push((d.exception && d.exception.description) || d.text);
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: SOCKET_TRACKER });

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
  .catch((e) => results.push(['FAIL', 'harness', e.message]))
  .finally(() => {
    cleanup();
    for (const [status, name, why] of results) console.log(`${status}  ${name}${why ? '\n      ' + why : ''}`);
    const failed = results.filter((r) => r[0] === 'FAIL').length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  });
