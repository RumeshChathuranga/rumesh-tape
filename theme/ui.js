(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };
    var rows = Array.prototype.slice.call(document.querySelectorAll('#tab-ind .sheet-toggle[data-key]'));
    var PINNED = ['foot-btn', 'delta-btn', 'vwap-btn', 'cvd-btn', 'vol-btn', 'whale-btn', 'glow-btn', 'stats-table-btn'];
    var NOT_COUNTED = { showDrawTools: 1, chartType: 1 };

    function settingOn(key) {
        if (typeof SETTINGS === 'undefined') return false;
        if (key === 'chartType') return SETTINGS.chartType === 'line';
        return !!SETTINGS[key];
    }

    // The engine's own buttons are the source of truth for side effects;
    // SETTINGS is the source of truth for state. Mirror it everywhere.
    function syncStudies() {
        var n = 0;
        rows.forEach(function (row) {
            var on = settingOn(row.dataset.key);
            row.classList.toggle('on', on);
            if (row.dataset.btn) {
                var b = $(row.dataset.btn);
                if (b) b.classList.toggle('active', on);
            }
            if (on && !NOT_COUNTED[row.dataset.key]) n++;
        });
        var c = $('studies-count');
        if (c) { c.textContent = n ? String(n) : ''; c.dataset.n = n; }
    }

    function toggleStudy(row) {
        var key = row.dataset.key;
        if (key === 'showDrawTools') {
            if (typeof toggleDrawTools === 'function') toggleDrawTools(row);
        } else {
            var b = $(row.dataset.btn);
            if (b) b.click();
        }
        syncStudies();
    }

    rows.forEach(function (row) {
        row.setAttribute('role', 'switch');
        row.tabIndex = 0;
        row.addEventListener('click', function () { toggleStudy(row); });
        row.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleStudy(row); }
        });
    });
    PINNED.forEach(function (id) {
        var b = $(id);
        if (b) b.addEventListener('click', function () { setTimeout(syncStudies, 0); });
    });

    // Search
    var search = $('study-search');
    if (search) search.addEventListener('input', function () {
        var q = search.value.trim().toLowerCase();
        var shown = 0;
        document.querySelectorAll('#tab-ind .sheet-grid').forEach(function (grid) {
            var any = false;
            grid.querySelectorAll('.sheet-toggle').forEach(function (row) {
                var hit = !q || row.textContent.toLowerCase().indexOf(q) !== -1;
                row.classList.toggle('hide', !hit);
                if (hit) { any = true; shown++; }
            });
            var title = grid.previousElementSibling;
            if (title && title.classList.contains('sheet-section-title')) title.style.display = any ? '' : 'none';
            grid.style.display = any ? '' : 'none';
        });
        document.querySelectorAll('#tab-ind .sheet-fields, #tab-ind .sheet-fields + .sheet-fields').forEach(function (el) {
            el.style.display = q ? 'none' : '';
            var t = el.previousElementSibling;
            if (t && t.classList.contains('sheet-section-title')) t.style.display = q ? 'none' : '';
        });
        $('study-empty').style.display = shown ? 'none' : 'block';
    });

    // Sheet titles in sentence case, search only on the studies tab
    if (typeof window.openSheet === 'function') {
        var _open = window.openSheet;
        var TITLES = { ind: 'Studies', tf: 'Timeframe', sym: 'Symbol' };
        window.openSheet = function (tab) {
            _open(tab);
            $('sheet-title').textContent = TITLES[tab] || 'Menu';
            $('sheet-search').style.display = tab === 'ind' ? '' : 'none';
            syncStudies();
            if (tab === 'ind' && window.matchMedia('(min-width: 768px)').matches && search) setTimeout(function () { search.focus(); }, 60);
        };
    }
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && $('bottom-sheet').classList.contains('open') && typeof closeSheet === 'function') closeSheet();
    });

    // Timeframe segmented control drives the hidden <select>
    var seg = $('tf-seg'), tfSel = $('tf-select');
    function syncTF() {
        if (!seg || !tfSel) return;
        seg.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.tf === tfSel.value); });
    }
    if (seg) seg.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-tf]');
        if (!b || b.dataset.tf === tfSel.value) return;
        tfSel.value = b.dataset.tf;
        tfSel.dispatchEvent(new Event('change', { bubbles: true }));
        syncTF();
    });

    // Live price readout: meta line and a short up/down flash on each tick
    var readout = $('price-readout'), hdr = $('hdr-p'), meta = $('pr-meta'), flashT = null, lastText = '';
    if (hdr && readout && 'MutationObserver' in window) {
        new MutationObserver(function () {
            var t = hdr.textContent;
            if (t === lastText) return;
            lastText = t;
            readout.dataset.dir = hdr.classList.contains('dn') ? 'dn' : 'up';
            readout.classList.add('flash');
            clearTimeout(flashT);
            flashT = setTimeout(function () { readout.classList.remove('flash'); }, 140);
        }).observe(hdr, { childList: true, characterData: true, subtree: true });
    }
    function syncMeta() {
        if (!meta || typeof SETTINGS === 'undefined') return;
        var m = SETTINGS.symbol + ' · ' + SETTINGS.tf;
        if (meta.textContent !== m) {
            meta.textContent = m;
            document.title = SETTINGS.symbol + ' · {{APP_NAME}}';
        }
    }

    // The engine clears .active on every .draw-btn and .sheet-toggle when a
    // drawing tool is picked; re-assert study state on a light interval.
    function tick() { syncStudies(); syncTF(); syncMeta(); }
    tick();
    setInterval(tick, 600);
})();
