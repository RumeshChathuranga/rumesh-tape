import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { TradeCache } from '../src/data/cache';
import { MarketSession } from '../src/data/session';
import { MinuteStore } from '../src/model/minutes';
import type { AggTrade } from '../src/model/types';
import { FakeWS, fakeRest, NOW, range } from './fakes';

let idb: IDBFactory;
beforeEach(() => { idb = new IDBFactory(); FakeWS.all = []; });

const storeWith = (trades: AggTrade[]) => {
    const s = new MinuteStore(5);
    s.applyNewer(trades);
    return s;
};

describe('TradeCache', () => {
    it('saves and loads a store snapshot', async () => {
        const cache = await TradeCache.open('test-db', idb);
        const snap = storeWith(range(900, 1100)).serialize();
        await cache.save('BTCUSDT', snap);
        expect(await cache.load('BTCUSDT')).toEqual(snap);
    });

    it('returns null for a symbol it has never seen', async () => {
        const cache = await TradeCache.open('test-db', idb);
        expect(await cache.load('ETHUSDT')).toBeNull();
    });

    it('lets a new session start from cached trades instead of only the latest page', async () => {
        const cache = await TradeCache.open('test-db', idb);
        await cache.save('BTCUSDT', storeWith(range(900, 1501)).serialize());
        const never = () => new Promise<AggTrade[]>(() => {});   // backfill stays pending
        const s = new MarketSession({
            symbol: 'BTCUSDT', tf: '5m', historyHours: 1, rest: fakeRest({ from: never }).rest, cache,
            WebSocketImpl: FakeWS as unknown as typeof WebSocket, now: () => NOW, onChange: () => {},
        });
        await s.start();
        expect(s.store!.firstId).toBe(900);
        expect(s.store!.lastId).toBe(1999);
        await s.stop();
    });
});
