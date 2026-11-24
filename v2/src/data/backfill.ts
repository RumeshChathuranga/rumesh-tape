import type { MinuteStore } from '../model/minutes';
import type { Rest } from './rest';

const PAGE = 1000;
const isAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError';

/**
 * Load older real trades, newest first, by stepping back 1000 ids at a time.
 * Ids are contiguous, so every page joins the store exactly. Stops at
 * `targetStart`, at the first trade ever, or when aborted.
 */
export async function backfillOlder(
    rest: Rest, symbol: string, store: MinuteStore, targetStart: number,
    o: { signal: AbortSignal; onPage?: () => void },
): Promise<void> {
    try {
        while (store.firstId !== null && store.firstTime !== null && store.firstTime > targetStart && store.firstId > 0) {
            if (o.signal.aborted) return;
            const fromId = Math.max(0, store.firstId - PAGE);
            const page = await rest.aggTradesFrom(symbol, fromId, o.signal);
            if (o.signal.aborted || !page.length) return;
            store.applyOlder(page);
            o.onPage?.();
            if (fromId === 0) return;
        }
    } catch (e) {
        if (!isAbort(e)) throw e;
    }
}

/** Fetch the trades missing between `store.lastId` and `toId` (exclusive). */
export async function fillGap(
    rest: Rest, symbol: string, store: MinuteStore, toId: number, o: { signal: AbortSignal },
): Promise<void> {
    while (store.lastId !== null && store.lastId < toId - 1) {
        if (o.signal.aborted) return;
        const page = (await rest.aggTradesFrom(symbol, store.lastId + 1, o.signal)).filter((t) => t.id < toId);
        if (!page.length) return;
        store.applyNewer(page);
    }
}
