const MINUTE = 60_000;
const MAX_RETRIES = 3;

export const abortError = () => new DOMException('Aborted', 'AbortError');

/**
 * Runs REST calls one at a time and keeps the weight used in any 60-second
 * window under budget. The browser can't read Binance's used-weight header
 * (it isn't CORS-exposed), so we count it ourselves.
 */
export class RateGate {
    private log: { t: number; w: number }[] = [];
    private queue: Promise<unknown> = Promise.resolve();
    private readonly now: () => number;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly limit: number;

    constructor(o: { weightPerMinute: number; now?: () => number; sleep?: (ms: number) => Promise<void> }) {
        this.limit = o.weightPerMinute;
        this.now = o.now ?? Date.now;
        this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    }

    run(weight: number, call: () => Promise<Response>, signal?: AbortSignal): Promise<Response> {
        const job = this.queue.then(() => this.exec(weight, call, signal));
        this.queue = job.catch(() => undefined);
        return job;
    }

    private async exec(weight: number, call: () => Promise<Response>, signal?: AbortSignal): Promise<Response> {
        for (let attempt = 0; ; attempt++) {
            await this.reserve(weight, signal);
            const res = await call();
            if ((res.status !== 429 && res.status !== 418) || attempt >= MAX_RETRIES) return res;
            const wait = Number(res.headers.get('Retry-After'));
            await this.sleep(Number.isFinite(wait) && wait > 0 ? wait * 1000 : MINUTE);
        }
    }

    private async reserve(weight: number, signal?: AbortSignal) {
        for (;;) {
            if (signal?.aborted) throw abortError();
            const now = this.now();
            this.log = this.log.filter((e) => e.t > now - MINUTE);
            const used = this.log.reduce((s, e) => s + e.w, 0);
            if (used + weight <= this.limit || !this.log.length) {
                this.log.push({ t: now, w: weight });
                return;
            }
            await this.sleep(this.log[0].t + MINUTE - now);
        }
    }
}
