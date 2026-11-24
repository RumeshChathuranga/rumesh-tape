import type { StoreSnapshot } from '../model/minutes';
import type { TradeCacheLike } from './session';

const STORE = 'stores';

const req = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
});

/** Real trades (as 1-minute footprints) kept in IndexedDB, one record per symbol. */
export class TradeCache implements TradeCacheLike {
    private constructor(private readonly db: IDBDatabase) {}

    static async open(name = 'rumesh-tape-v2', idb: IDBFactory = indexedDB): Promise<TradeCache> {
        const open = idb.open(name, 1);
        open.onupgradeneeded = () => {
            if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
        };
        return new TradeCache(await req(open));
    }

    async load(symbol: string): Promise<StoreSnapshot | null> {
        const tx = this.db.transaction(STORE, 'readonly');
        const v = await req(tx.objectStore(STORE).get(symbol));
        return (v as StoreSnapshot | undefined) ?? null;
    }

    async save(symbol: string, s: StoreSnapshot): Promise<void> {
        const tx = this.db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(s, symbol);
        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }
}
