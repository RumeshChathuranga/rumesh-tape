import { limitReached, positionSize, recordTrade, usOpenWindow, type DayCount } from '../model/risk';
import type { Setup } from '../model/setup';
import type { Zone } from '../model/zones';
import { requestNotifyPermission, type Alerts } from './alerts';

export const SCALP_KEY = 'rumeshTape.v2.scalp';

interface Saved { account: string; riskPct: string; day: DayCount }

export interface ScalpState {
    now: number;
    bias: 'bullish' | 'bearish' | null;
    zones: Zone[];
    touched: (id: string) => number | null;
    setup: Setup | null;
    price: number;
    decimals: number;
}

const pad2 = (n: number) => (n < 10 ? '0' : '') + n;
const hhmm = (t: number) => { const d = new Date(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const dur = (ms: number) => { const m = Math.max(0, Math.round(ms / 60_000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
}

/** The strategy, on one panel: window, bias, zones, latest setup, today's limits, size and alerts. */
export class ScalpPanel {
    private saved: Saved;
    private win = { range: h('div', 'sp-strong'), status: h('div', 'sp-muted') };
    private bias = h('div', 'sp-strong');
    private zones = h('div', 'sp-zones');
    private setup = h('div', 'sp-setup');
    private today = h('div', 'sp-strong');
    private stopBanner = h('div', 'sp-warn', 'Daily limit reached: stop trading for today.');
    private inputs: Record<'account' | 'riskPct' | 'entry' | 'stop', HTMLInputElement>;
    private out = h('div', 'sp-out');
    private alertList = h('div', 'sp-alerts');
    private lastSetupKey = '';
    private latest: Setup | null = null;
    private decimals = 2;

    constructor(host: HTMLElement, private readonly alerts: Alerts) {
        this.saved = this.load();
        const section = (title: string, ...kids: HTMLElement[]) => {
            const s = h('section');
            s.append(h('h4', '', title), ...kids);
            host.appendChild(s);
            return s;
        };
        host.appendChild(h('h3', '', 'Scalp plan'));
        section('Trading window', this.win.range, this.win.status);
        section('Bias', this.bias);
        section('Zones', this.zones, h('p', 'sp-note', 'Volume levels are estimated from 1-minute candles. First touch only.'));

        const use = h('button', 'sp-btn', 'Use in calculator');
        use.addEventListener('click', () => this.fillFromSetup(true));
        section('Latest setup', this.setup, use, h('p', 'sp-note', 'Setups are read on the chart timeframe. The strategy enters on 1m.'));

        const win = h('button', 'sp-btn', 'Win'), loss = h('button', 'sp-btn', 'Loss'), reset = h('button', 'sp-btn', 'Reset');
        win.addEventListener('click', () => this.record('win'));
        loss.addEventListener('click', () => this.record('loss'));
        reset.addEventListener('click', () => { this.saved.day = { day: 0, trades: 0, losses: 0 }; this.save(); this.renderToday(); });
        const row = h('div', 'sp-row');
        row.append(win, loss, reset);
        section('Today', this.today, row, this.stopBanner);

        const field = (key: keyof ScalpPanel['inputs'], label: string, value: string) => {
            const l = h('label', 'sp-field', label);
            const i = h('input');
            i.inputMode = 'decimal';
            i.value = value;
            i.addEventListener('input', () => {
                if (key === 'account' || key === 'riskPct') { this.saved[key] = i.value; this.save(); }
                this.renderSize();
            });
            l.appendChild(i);
            return [l, i] as const;
        };
        const [a, ai] = field('account', 'Account (USDT)', this.saved.account);
        const [r, ri] = field('riskPct', 'Risk per trade (%)', this.saved.riskPct);
        const [e, ei] = field('entry', 'Entry', '');
        const [s, si] = field('stop', 'Stop', '');
        this.inputs = { account: ai, riskPct: ri, entry: ei, stop: si };
        const grid = h('div', 'sp-grid');
        grid.append(a, r, e, s);
        section('Position size (fees 0.07% included)', grid, this.out);

        const notify = h('button', 'sp-btn', 'Enable notifications');
        notify.addEventListener('click', () => void requestNotifyPermission().then(() => { notify.textContent = 'Notifications on'; }));
        section('Alerts', notify, this.alertList);
        alerts.onChange = () => this.renderAlerts();

        this.renderToday();
        this.renderSize();
        this.renderAlerts();
    }

    update(s: ScalpState): void {
        this.decimals = s.decimals;
        const w = usOpenWindow(s.now);
        this.win.range.textContent = `US open window ${hhmm(w.start)}–${hhmm(w.end)} your time`;
        this.win.status.textContent = w.state === 'weekend' ? 'Weekend: no trading window'
            : w.state === 'before' ? `Opens in ${dur(w.start - s.now)}`
            : w.state === 'open' ? `Open now · ${dur(w.end - s.now)} left`
            : 'Closed for today';
        this.win.status.className = w.state === 'open' ? 'sp-live' : 'sp-muted';

        this.bias.textContent = s.bias === 'bullish' ? 'Bullish (15m gaps): longs only'
            : s.bias === 'bearish' ? 'Bearish (15m gaps): shorts only' : 'No clear bias: no gap trades';
        this.bias.className = `sp-strong ${s.bias ?? ''}`;

        this.zones.replaceChildren(...(s.zones.length ? s.zones.map((z) => {
            const row = h('div', `sp-zone ${z.side}`);
            const dist = z.side === 'support' ? (s.price - z.top) / s.price : (z.bottom - s.price) / s.price;
            const t = s.touched(z.id);
            row.append(
                h('span', `sp-grade g${z.grade}`, z.grade),
                h('span', 'sp-zl', z.label),
                h('span', 'sp-zr', `${z.bottom.toFixed(s.decimals)}–${z.top.toFixed(s.decimals)}`),
                h('span', 'sp-zd', t !== null ? `touched ${hhmm(t)}` : `${(Math.max(0, dist) * 100).toFixed(2)}% away`),
            );
            return row;
        }) : [h('div', 'sp-muted', 'No zones yet')]));

        if (s.setup && s.setup.key !== this.lastSetupKey) {
            this.lastSetupKey = s.setup.key;
            this.latest = s.setup;
            this.fillFromSetup(false);
        }
        const st = this.latest;
        this.setup.textContent = st
            ? `${st.dir === 'long' ? 'Long' : 'Short'} at ${st.zone.label}, ${hhmm(st.time)} · ${st.signals.join(', ')} · entry ${st.entry.toFixed(s.decimals)} · stop ${st.stop.toFixed(s.decimals)}`
            : 'None yet. Wait for price to reach a zone.';
        this.renderToday();
    }

    private fillFromSetup(force: boolean) {
        const st = this.latest;
        if (!st) return;
        const { entry, stop } = this.inputs;
        if (force || (document.activeElement !== entry && document.activeElement !== stop)) {
            entry.value = st.entry.toFixed(this.decimals);
            stop.value = st.stop.toFixed(this.decimals);
            this.renderSize();
        }
    }

    private renderSize() {
        const n = (i: HTMLInputElement) => Number(i.value.replace(/,/g, ''));
        const p = positionSize({ account: n(this.inputs.account), riskPct: n(this.inputs.riskPct), entry: n(this.inputs.entry), stop: n(this.inputs.stop) });
        if (!p) { this.out.replaceChildren(h('div', 'sp-muted', 'Fill in account, risk, entry and stop.')); return; }
        const line = (k: string, v: string) => { const r = h('div', 'sp-kv'); r.append(h('span', '', k), h('span', 'sp-num', v)); return r; };
        this.out.replaceChildren(
            line('Position', `${money(p.notional)} USDT`),
            line('Quantity', p.qty.toPrecision(4)),
            line('Leverage', `${p.leverage.toFixed(2)}x`),
            line('Loss at stop', `${money(p.risk)} USDT (stop ${p.stopPct.toFixed(3)}%)`),
            line('Fees', `${money(p.fees)} USDT`),
            line('First target (2.5x stop)', p.target.toFixed(this.decimals)),
            ...(p.tooWide ? [h('div', 'sp-warn', 'Stop is wider than 0.25%: skip this trade.')] : []),
        );
    }

    private record(result: 'win' | 'loss') {
        this.saved.day = recordTrade(this.saved.day, Date.now(), result);
        this.save();
        this.renderToday();
    }

    private renderToday() {
        const today = Math.floor(Date.now() / 86_400_000) * 86_400_000;
        const c = this.saved.day.day === today ? this.saved.day : { day: today, trades: 0, losses: 0 };
        this.today.textContent = `Trades ${c.trades} / 3 · Losses ${c.losses} / 2`;
        this.stopBanner.hidden = !limitReached(c);
    }

    private renderAlerts() {
        const items = this.alerts.items.slice(0, 5);
        this.alertList.replaceChildren(...(items.length ? items.map((a) => {
            const r = h('div', `sp-alert ${a.kind}`);
            r.append(h('div', 'sp-strong', `${hhmm(a.time)} · ${a.title}`), h('div', 'sp-muted', a.body));
            return r;
        }) : [h('div', 'sp-muted', 'No alerts yet')]));
    }

    private load(): Saved {
        const fallback: Saved = { account: '1000', riskPct: '0.5', day: { day: 0, trades: 0, losses: 0 } };
        try {
            const s = JSON.parse(localStorage.getItem(SCALP_KEY) ?? 'null');
            if (s && typeof s === 'object') return { ...fallback, ...s, day: { ...fallback.day, ...(s.day ?? {}) } };
        } catch { /* broken JSON */ }
        return fallback;
    }

    private save() {
        try { localStorage.setItem(SCALP_KEY, JSON.stringify(this.saved)); } catch { /* storage blocked */ }
    }
}
