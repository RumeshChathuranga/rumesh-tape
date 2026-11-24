const DAY = 86_400_000;
const clean = (n: number) => Number(n.toPrecision(12));
const ok = (n: number) => Number.isFinite(n) && n > 0;

export interface PositionSize {
    qty: number;
    notional: number;
    leverage: number;
    risk: number;       // account currency lost at the stop, fees included
    fees: number;       // round trip at feePct
    stopPct: number;
    target: number;     // first target: minRR x the stop distance
    tooWide: boolean;   // stop wider than maxStopPct: skip the trade
}

/**
 * Size so the loss at the stop, including fees, is `riskPct` of the account.
 * Fees default to 0.07% (maker entry 0.02% + taker exit 0.05%).
 */
export function positionSize(o: {
    account: number; riskPct: number; entry: number; stop: number;
    feePct?: number; maxStopPct?: number; minRR?: number;
}): PositionSize | null {
    const { account, riskPct, entry, stop } = o;
    const feePct = o.feePct ?? 0.07, maxStopPct = o.maxStopPct ?? 0.25, minRR = o.minRR ?? 2.5;
    if (![account, riskPct, entry, stop].every(ok) || !(feePct >= 0) || entry === stop) return null;
    const dist = Math.abs(entry - stop);
    const stopPct = (dist / entry) * 100;
    const risk = (account * riskPct) / 100;
    const notional = risk / ((stopPct + feePct) / 100);
    return {
        qty: notional / entry,
        notional,
        leverage: notional / account,
        risk,
        fees: (notional * feePct) / 100,
        stopPct,
        target: clean(stop < entry ? entry + minRR * dist : entry - minRR * dist),
        tooWide: stopPct > maxStopPct,
    };
}

/** Offset of New York from UTC at instant `t`, in ms (negative: behind UTC). */
function nyOffset(t: number): number {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', hourCycle: 'h23',
        year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(t).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return asUtc - Math.floor(t / 1000) * 1000;
}

export interface TradingWindow {
    start: number;
    end: number;
    open: number;
    state: 'before' | 'open' | 'after' | 'weekend';
}

/**
 * The strategy's window: 15 minutes before to 75 minutes after the US cash
 * open (09:30 New York), on the New York calendar day of `now`.
 */
export function usOpenWindow(now: number): TradingWindow {
    const local = new Date(now + nyOffset(now));
    const y = local.getUTCFullYear(), m = local.getUTCMonth(), d = local.getUTCDate();
    const guess = Date.UTC(y, m, d, 9, 30);
    const open = guess - nyOffset(guess - nyOffset(guess));
    const start = open - 15 * 60_000, end = open + 75 * 60_000;
    const weekday = local.getUTCDay();
    const state = weekday === 0 || weekday === 6 ? 'weekend' : now < start ? 'before' : now <= end ? 'open' : 'after';
    return { start, end, open, state };
}

export interface DayCount {
    day: number;
    trades: number;
    losses: number;
}

/** Count a finished trade; the count starts again each UTC day. */
export function recordTrade(c: DayCount, now: number, result: 'win' | 'loss'): DayCount {
    const day = Math.floor(now / DAY) * DAY;
    const base = c.day === day ? c : { day, trades: 0, losses: 0 };
    return { day, trades: base.trades + 1, losses: base.losses + (result === 'loss' ? 1 : 0) };
}

/** The strategy's daily stop: three trades, or two losses. */
export function limitReached(c: DayCount): boolean {
    return c.trades >= 3 || c.losses >= 2;
}
