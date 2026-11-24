import { ROW_MULTS } from '../model/bins';
import { TIMEFRAMES } from '../model/types';
import { HISTORY_HOURS, type Settings } from './settings';

const BIG_PRINTS = [25_000, 50_000, 100_000, 250_000, 1_000_000];
const usd = (n: number) => (n >= 1e6 ? `$${n / 1e6}M` : `$${n / 1e3}k`);

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text = ''): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text) e.textContent = text;
    return e;
};

/** The control bar. Reports changes as patches; the page decides what to restart. */
export class Topbar {
    private sym: HTMLInputElement;
    private symErr: HTMLSpanElement;
    private tf: HTMLDivElement;
    private rows: HTMLSelectElement;
    private mode: HTMLDivElement;
    private cvd: HTMLButtonElement;
    private book: HTMLButtonElement;
    private levels: HTMLButtonElement;
    private scalp: HTMLButtonElement;
    private history: HTMLSelectElement;
    private big: HTMLSelectElement;
    private badge: HTMLSpanElement;
    private fvg: HTMLSelectElement;
    private bias: HTMLSpanElement;
    private price: HTMLDivElement;
    private priceVal: HTMLDivElement;
    private priceMeta: HTMLDivElement;
    private lastPrice = 0;

    constructor(root: HTMLElement, private s: Settings, private readonly onChange: (patch: Partial<Settings>) => void) {
        const brand = el('div', { class: 'brand' });
        brand.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2v12M12 4v10" stroke="#4A5366"/><rect x="2" y="5" width="4" height="6" rx=".6" fill="#10B981"/><rect x="10" y="6" width="4" height="5" rx=".6" fill="#EF4444"/><path d="M1 15h14" stroke="#4C8DFF" stroke-width="1.4"/></svg><span>Rumesh Tape</span><small>v2</small>';

        this.sym = el('input', { class: 'sym', 'aria-label': 'Symbol', spellcheck: 'false', autocomplete: 'off', title: 'Symbol: press Enter to load' });
        this.symErr = el('span', { class: 'sym-error' });
        this.sym.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            const v = this.sym.value.trim().toUpperCase();
            if (v && v !== this.s.symbol) this.onChange({ symbol: v });
        });

        this.tf = el('div', { class: 'seg', role: 'group', 'aria-label': 'Timeframe' });
        for (const tf of TIMEFRAMES) {
            const b = el('button', { 'data-v': tf }, tf);
            b.addEventListener('click', () => this.onChange({ tf }));
            this.tf.appendChild(b);
        }

        this.rows = el('select', { 'aria-label': 'Row size', title: 'Price step per footprint row' });
        this.rows.addEventListener('change', () => this.onChange({ rowMult: this.rows.value === 'auto' ? 'auto' : Number(this.rows.value) }));

        this.mode = el('div', { class: 'seg', role: 'group', 'aria-label': 'Cells' });
        for (const [v, label] of [['bidask', 'Bid × Ask'], ['volume', 'Volume'], ['delta', 'Delta']] as const) {
            const b = el('button', { 'data-v': v }, label);
            b.addEventListener('click', () => this.onChange({ mode: v }));
            this.mode.appendChild(b);
        }

        this.cvd = el('button', { class: 'tg', title: 'Cumulative delta pane' }, 'CVD');
        this.cvd.addEventListener('click', () => this.onChange({ showCvd: !this.s.showCvd }));
        this.book = el('button', { class: 'tg', title: 'Resting orders (synced order book)' }, 'Book');
        this.book.addEventListener('click', () => this.onChange({ showBook: !this.s.showBook }));
        this.levels = el('button', { class: 'tg', title: 'VWAP, previous-day value area, naked POCs and strategy zones' }, 'Levels');
        this.levels.addEventListener('click', () => this.onChange({ showLevels: !this.s.showLevels }));
        this.scalp = el('button', { class: 'tg', title: 'Scalp plan: window, zones, setups, size and alerts' }, 'Scalp');
        this.scalp.addEventListener('click', () => this.onChange({ showScalp: !this.s.showScalp }));

        this.big = el('select', { 'aria-label': 'Big trades', title: 'Market orders shown as bubbles. Auto: the largest 0.5% of market orders over $10k in the last hour, at least $50k' });
        this.big.appendChild(el('option', { value: 'auto' }, 'Big: Auto'));
        for (const n of BIG_PRINTS) this.big.appendChild(el('option', { value: String(n) }, `Big ${usd(n)}`));
        this.big.addEventListener('change', () => this.onChange({ bigPrintUsd: this.big.value === 'auto' ? 'auto' : Number(this.big.value) }));

        this.fvg = el('select', { 'aria-label': 'Fair value gaps', title: 'Unmitigated fair value gaps (BISI / SIBI). All adds the 1h and 4h gaps' });
        for (const [v, label] of [['all', 'FVG + 1h 4h'], ['chart', 'FVG'], ['off', 'FVG off']] as const) this.fvg.appendChild(el('option', { value: v }, label));
        this.fvg.addEventListener('change', () => this.onChange({ fvg: this.fvg.value as Settings['fvg'] }));
        this.bias = el('span', { class: 'bias', title: 'Direction of the most recent fair value gap on this chart' });

        this.history = el('select', { 'aria-label': 'Real history', title: 'How far back to load real trades (Binance allows 48 h)' });
        for (const h of HISTORY_HOURS) this.history.appendChild(el('option', { value: String(h) }, `History ${h}h`));
        this.history.addEventListener('change', () => this.onChange({ historyHours: Number(this.history.value) as Settings['historyHours'] }));

        this.badge = el('span', { class: 'badge', title: 'Footprint cells exist only where real trades are loaded' }, 'Loading');
        this.price = el('div', { class: 'price' });
        this.priceMeta = el('div', { class: 'meta' });
        this.priceVal = el('div', { class: 'val' }, '-');
        this.price.append(this.priceMeta, this.priceVal);

        const group = (...kids: HTMLElement[]) => { const g = el('div', { class: 'group' }); g.append(...kids); return g; };
        root.append(
            brand,
            group(this.sym, this.symErr),
            group(this.tf),
            group(this.rows, this.mode),
            group(this.cvd, this.book, this.levels, this.big),
            group(this.fvg, this.bias),
            group(this.history, this.badge),
            el('div', { class: 'spacer' }),
            this.scalp,
            el('a', { class: 'classic', href: '/' }, 'Classic'),
            this.price,
        );
        this.sync(s);
    }

    sync(s: Settings): void {
        this.s = s;
        if (document.activeElement !== this.sym) this.sym.value = s.symbol;
        this.tf.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.tf));
        this.mode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.mode));
        this.cvd.classList.toggle('on', s.showCvd);
        this.book.classList.toggle('on', s.showBook);
        this.levels.classList.toggle('on', s.showLevels);
        this.scalp.classList.toggle('on', s.showScalp);
        this.history.value = String(s.historyHours);
        this.big.value = String(s.bigPrintUsd);
        this.fvg.value = s.fvg;
        this.rows.value = String(s.rowMult);
        this.priceMeta.textContent = `${s.symbol} · ${s.tf}`;
    }

    /** Row choices as price steps for the current base bin. */
    setRowOptions(bin: number, autoMult: number, decimals: number): void {
        const fmt = (m: number) => (bin * m).toFixed(decimals);
        this.rows.replaceChildren(el('option', { value: 'auto' }, `Rows auto ${fmt(autoMult)}`), ...ROW_MULTS.map((m) => el('option', { value: String(m) }, `Rows ${fmt(m)}`)));
        this.rows.value = String(this.s.rowMult);
    }

    setBias(b: 'bullish' | 'bearish' | null): void {
        const text = b ? `Bias ${b}` : '';
        if (this.bias.textContent !== text) this.bias.textContent = text;
        this.bias.className = `bias ${b ?? ''}`;
    }

    setSymbolError(msg: string | null): void {
        this.symErr.textContent = msg ?? '';
        this.sym.classList.toggle('bad', !!msg);
    }

    setStatus(text: string, kind: 'loading' | 'live' | 'error'): void {
        if (this.badge.textContent !== text) this.badge.textContent = text;
        this.badge.className = `badge ${kind}`;
    }

    setPrice(p: number, decimals: number): void {
        if (p === this.lastPrice) return;
        this.price.classList.toggle('up', p >= this.lastPrice);
        this.price.classList.toggle('dn', p < this.lastPrice);
        this.lastPrice = p;
        this.priceVal.textContent = p.toFixed(decimals);
    }
}
