import { describe, expect, it } from 'vitest';
import { avgCellVolume, detectSetup, signalsAt } from '../src/model/setup';
import type { Bar, Cells } from '../src/model/types';
import type { Zone } from '../src/model/zones';

const M = 60_000;
const cells = (o: Record<number, [number, number]>): Cells =>
    new Map(Object.entries(o).map(([k, [bid, ask]]) => [Number(k), { bid, ask }]));
const bar = (i: number, rows: Record<number, [number, number]>, o: Partial<Bar> = {}): Bar => ({
    t: i * M, o: 98.5, h: 98.5, l: 98.5, c: 98.5, v: 10, buyV: 5, real: true, rows: cells(rows), poc: null, ...o,
});
const small = (i: number) => bar(i, { 10: [1, 1] });
const absorbing = (i: number, real = true) => bar(i, { 10: [60, 64] }, { real, rows: real ? cells({ 10: [60, 64] }) : null });
const stackedBuy = (i: number) => bar(i, { 1: [1, 0], 2: [1, 5], 3: [1, 5], 4: [1, 5] });
const zone: Zone = { id: 'fvg:15m:1', kind: 'fvg', tf: '15m', side: 'support', top: 99, bottom: 98, grade: 'A', label: '15m BISI' };

describe('signalsAt', () => {
    it('sees absorption only on real bars', () => {
        expect(signalsAt([absorbing(0)], 0, 'long', 5)).toContain('absorption');
        expect(signalsAt([absorbing(0, false)], 0, 'long', 5)).not.toContain('absorption');
    });

    it('sees three stacked buying imbalances for a long, not a short', () => {
        expect(signalsAt([stackedBuy(0)], 0, 'long', 100)).toContain('stacked imbalance');
        expect(signalsAt([stackedBuy(0)], 0, 'short', 100)).not.toContain('stacked imbalance');
    });

    it('sees delta turning to the trade side', () => {
        const bars = [small(0), { ...small(1), buyV: 2 }, { ...small(2), buyV: 8 }];
        expect(signalsAt(bars, 2, 'long', 100)).toContain('delta flip');
        expect(signalsAt(bars, 2, 'short', 100)).not.toContain('delta flip');
    });

    it('averages cell volume over real bars only', () => {
        expect(avgCellVolume([small(0), absorbing(1, false), bar(2, { 1: [2, 2], 2: [3, 3] })])).toBeCloseTo((2 + 4 + 6) / 3, 9);
    });
});

describe('detectSetup', () => {
    it('confirms a long after the zone touch: absorption, then stacked buying', () => {
        const bars = [small(0), small(1), small(2), small(3), absorbing(4), stackedBuy(5), small(6)];
        const s = detectSetup(bars, zone, 3 * M, 0.1)!;
        expect(s).toMatchObject({ dir: 'long', time: 5 * M, entry: 98.5, stop: 97.9, key: 'fvg:15m:1:' + 5 * M });
        expect(s.signals).toEqual(expect.arrayContaining(['absorption', 'stacked imbalance']));
    });

    it('needs both groups of signals', () => {
        const bars = [small(0), small(1), small(2), small(3), absorbing(4), small(5), small(6)];
        expect(detectSetup(bars, zone, 3 * M, 0.1)).toBeNull();
    });

    it('expires ten bars after the touch', () => {
        const bars = [small(0), ...Array.from({ length: 11 }, (_, i) => small(i + 1)), absorbing(12), stackedBuy(13), small(14)];
        expect(detectSetup(bars, zone, 0, 0.1)).toBeNull();
    });
});
