import { usOpenWindow } from '../model/risk';

export interface GuideStep {
    title: string;
    lines: string[];
}

const SEEN_KEY = 'rumeshTape.v2.guideSeen';
const pad2 = (n: number) => (n < 10 ? '0' : '') + n;
const localHhmm = (t: number) => { const d = new Date(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

/** The scalping strategy in six short steps, with today's window times. */
export function guideSteps(now: number, fmt: (t: number) => string = localHhmm): GuideStep[] {
    const w = usOpenWindow(now);
    return [
        { title: 'Get ready', lines: [
            `Open the tool at ${fmt(w.start - 30 * 60_000)}. The window is ${fmt(w.start)}–${fmt(w.end)}.`,
            'Set the chart to 1m. Wait until the top bar says "Real from".',
        ] },
        { title: 'Check the bias', lines: [
            'Bullish: only buy. Bearish: only sell.',
            'No bias: no trade today.',
        ] },
        { title: 'Wait for a zone', lines: [
            'Do nothing until the alert says price "reached" a zone.',
            'A zones are the strongest. Only the first touch counts.',
        ] },
        { title: 'Wait for the setup', lines: [
            'A second alert, "setup", means big traders joined in.',
            'No setup within 10 candles: skip this zone.',
        ] },
        { title: 'Place the trade', lines: [
            'Press "Use in calculator". If it says "Stop too wide": skip.',
            'Place a limit order at Entry with that Quantity. Stop at Stop.',
            'Take half the profit at First target.',
        ] },
        { title: 'After the trade', lines: [
            'When a new FVG forms in your direction, move the stop to your entry.',
            'Press Win or Loss. Stop for the day after 3 trades or 2 losses.',
        ] },
    ];
}

const RULE = 'Never trade outside the window, against the bias, or with more than 0.5% risk. Practise 30 trades on paper first.';

/** Show the guide as a card over the page. */
export function openGuide(now = Date.now()): void {
    document.getElementById('rt-guide')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'rt-guide';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'How to trade the US-open scalp');
    const card = document.createElement('div');
    card.className = 'g-card';
    const head = document.createElement('div');
    head.className = 'g-head';
    const title = document.createElement('h2');
    title.textContent = 'How to trade the US-open scalp';
    const close = document.createElement('button');
    close.className = 'g-close';
    close.textContent = 'Close';
    head.append(title, close);
    const list = document.createElement('ol');
    for (const s of guideSteps(now)) {
        const li = document.createElement('li');
        const h = document.createElement('h3');
        h.textContent = s.title;
        li.appendChild(h);
        for (const line of s.lines) {
            const p = document.createElement('p');
            p.textContent = line;
            li.appendChild(p);
        }
        list.appendChild(li);
    }
    const rule = document.createElement('p');
    rule.className = 'g-rule';
    rule.textContent = RULE;
    card.append(head, list, rule);
    overlay.appendChild(card);
    const shut = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') shut(); };
    close.addEventListener('click', shut);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) shut(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage blocked */ }
}

/** First visit only. */
export function openGuideOnce(): void {
    try { if (localStorage.getItem(SEEN_KEY)) return; } catch { return; }
    openGuide();
}
