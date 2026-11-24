// Rumesh Tape: runs at the top of the engine's script, in place of its
// original error handler. build.py injects this file before re-theming, so
// keep it free of colour literals and emoji.

// Timeframe saved by ui.js; becomes the engine's starting timeframe so a
// reload opens straight on it instead of loading the default first.
var __rtTF = (function () {
    var ms = { '1m': 6e4, '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': 36e5, '2h': 72e5, '4h': 144e5, '1d': 864e5 };
    var tf = null;
    try { tf = (JSON.parse(localStorage.getItem('rumeshTape.v1') || '{}') || {}).tf; } catch (e) {}
    if (!ms[tf]) tf = '5m';
    return { tf: tf, ms: ms[tf] };
})();

// Escape text from third-party feeds before it goes into innerHTML.
function __rtEsc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

// Called at the start of init(): close every other symbol's sockets and
// timers, and drop its cached bars so returning to it reloads fresh history.
function __rtDropOtherSymbols(keep) {
    Object.keys(STATES).forEach(function (sym) {
        if (sym === keep) return;
        var st = STATES[sym];
        ['ws', 'wsDOM'].forEach(function (k) {
            var sock = st[k];
            if (!sock) return;
            sock.onopen = sock.onmessage = sock.onclose = sock.onerror = null;
            try { sock.close(); } catch (e) {}
            st[k] = null;
        });
        if (st._oiTimer) { clearInterval(st._oiTimer); st._oiTimer = null; }
        if (st.reconnectTimer) { clearTimeout(st.reconnectTimer); st.reconnectTimer = null; }
        st.bars = [];
        st.tfBars = {};
        st.baseTick = null;
        st.tradeCache = [];
        st._msgQueue = [];
        st.orderBook = { b: {}, a: {}, rawB: {}, rawA: {}, max: 0 };
    });
}

// Show uncaught errors in a small toast. The original handler appended to
// document.body.innerHTML, which rebuilt the page and killed every button.
window.addEventListener('error', function (e) {
    var msg = (e && e.message) || 'unknown error';
    if (msg === 'Script error.') return;   // cross-origin noise (extensions)
    try {
        var box = document.getElementById('rt-error');
        if (!box) {
            box = document.createElement('div');
            box.id = 'rt-error';
            box.setAttribute('role', 'alert');
            document.body.appendChild(box);
        }
        box.textContent = 'Something went wrong: ' + msg;
        box.hidden = false;
        clearTimeout(window.__rtErrTimer);
        window.__rtErrTimer = setTimeout(function () { box.hidden = true; }, 8000);
    } catch (err) {}
});
