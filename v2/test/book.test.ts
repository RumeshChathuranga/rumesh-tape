import { describe, expect, it } from 'vitest';
import { OrderBook, type DepthEvent, type DepthSnapshot } from '../src/data/book';

const ev = (U: number, u: number, pu: number, b: [string, string][] = [], a: [string, string][] = []): DepthEvent =>
    ({ U, u, pu, b, a });
const snap = (lastUpdateId: number): DepthSnapshot => ({
    lastUpdateId,
    bids: [['99.0', '1'], ['98.0', '2']],
    asks: [['101.0', '1'], ['102.0', '2']],
});

describe('OrderBook sync', () => {
    it('buffers, drops stale events, applies the straddling one and syncs', () => {
        const book = new OrderBook();
        expect(book.onEvent(ev(90, 95, 89, [['99.0', '50']]))).toBe('buffered');
        expect(book.onEvent(ev(96, 101, 95, [['97.0', '3']]))).toBe('buffered');
        expect(book.onEvent(ev(102, 110, 101, [], [['101.0', '4']]))).toBe('buffered');
        expect(book.loadSnapshot(snap(100))).toBe('synced');
        expect(book.state).toBe('synced');
        expect(book.bids.get(99)).toBe(1);   // the stale event (u=95) was dropped
        expect(book.bids.get(97)).toBe(3);
        expect(book.asks.get(101)).toBe(4);
    });

    it('asks for a resync when an event does not follow the previous one', () => {
        const book = new OrderBook();
        book.onEvent(ev(96, 101, 95));
        book.loadSnapshot(snap(100));
        expect(book.onEvent(ev(108, 112, 107))).toBe('resync');
        expect(book.state).toBe('waiting');
        expect(book.bids.size + book.asks.size).toBe(0);
    });

    it('removes a level when its quantity is zero', () => {
        const book = new OrderBook();
        book.onEvent(ev(96, 101, 95, [['99.0', '0']]));
        book.loadSnapshot(snap(100));
        expect(book.bids.has(99)).toBe(false);
    });

    it('asks for a new snapshot when the snapshot is older than the buffered stream', () => {
        const book = new OrderBook();
        book.onEvent(ev(105, 110, 104));
        expect(book.loadSnapshot(snap(100))).toBe('resync');
    });

    it('waits for the first straddling event when nothing is buffered yet', () => {
        const book = new OrderBook();
        expect(book.loadSnapshot(snap(100))).toBe('waiting');
        expect(book.onEvent(ev(95, 98, 94))).toBe('buffered');    // older than the snapshot: ignored
        expect(book.onEvent(ev(99, 103, 98, [['98.5', '7']]))).toBe('applied');
        expect(book.state).toBe('synced');
        expect(book.bids.get(98.5)).toBe(7);
    });

    it('reports best prices', () => {
        const book = new OrderBook();
        book.onEvent(ev(96, 101, 95));
        book.loadSnapshot(snap(100));
        expect(book.bestBid()).toBe(99);
        expect(book.bestAsk()).toBe(101);
    });
});
