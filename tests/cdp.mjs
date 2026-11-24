// Shared headless-Chrome harness for the smoke tests (DevTools protocol, no dependencies).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Counts the sockets the page opens, so leaks are visible as `window.__sockets`. */
export const SOCKET_TRACKER = `(() => {
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

export const OPEN_SOCKETS = `window.__sockets.filter(s => s.readyState <= 1).map(s => s.url)`;

/**
 * Serve `site` on 127.0.0.1:httpPort and drive a fresh headless Chrome.
 * `init` scripts run before every page load.
 */
export async function startBrowser({ site, httpPort, cdpPort, width = 1600, height = 1000, init = [] }) {
    const procs = [];
    const profile = mkdtempSync(join(tmpdir(), 'rt-cdp-'));
    procs.push(spawn('python3', ['-m', 'http.server', String(httpPort), '--bind', '127.0.0.1', '-d', site], { stdio: 'ignore' }));
    procs.push(spawn('google-chrome', ['--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
        '--no-first-run', '--no-default-browser-check', `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' }));

    let target;
    for (let i = 0; i < 80 && !target; i++) {
        try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page'); }
        catch { /* not up yet */ }
        if (!target) await sleep(250);
    }
    if (!target) throw new Error('Chrome did not start');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let nextId = 1;
    const pending = new Map();
    const exceptions = [];
    ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || msg); pending.delete(msg.id); }
        else if (msg.method === 'Runtime.exceptionThrown') {
            const d = msg.params.exceptionDetails;
            exceptions.push((d.exception && d.exception.description) || d.text);
        }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
    });

    async function evaluate(expression) {
        const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error('evaluate failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
        return r.result.value;
    }
    async function waitFor(expression, timeout = 30000, label = expression) {
        const end = Date.now() + timeout;
        while (Date.now() < end) {
            try { if (await evaluate(expression)) return; } catch { /* page not ready */ }
            await sleep(250);
        }
        throw new Error('timed out waiting for: ' + label);
    }

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    for (const source of init) await send('Page.addScriptToEvaluateOnNewDocument', { source });

    return {
        evaluate,
        waitFor,
        exceptions,
        send,
        navigate: (url) => send('Page.navigate', { url }),
        reload: () => send('Page.reload', { ignoreCache: true }),
        close() {
            try { ws.close(); } catch { /* already closed */ }
            for (const p of procs) { try { p.kill('SIGKILL'); } catch { /* gone */ } }
            try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
        },
    };
}

/** Run named checks, print PASS/FAIL lines, and exit non-zero on any failure. */
export function makeChecks() {
    const results = [];
    return {
        async check(name, fn) {
            try { await fn(); results.push(['PASS', name]); }
            catch (e) { results.push(['FAIL', name, e.message]); }
        },
        fail(name, why) { results.push(['FAIL', name, why]); },
        report() {
            for (const [status, name, why] of results) console.log(`${status}  ${name}${why ? '\n      ' + why : ''}`);
            const failed = results.filter((r) => r[0] === 'FAIL').length;
            console.log(`\n${results.length - failed}/${results.length} passed`);
            return failed;
        },
    };
}

export function assert(cond, msg) { if (!cond) throw new Error(msg); }
