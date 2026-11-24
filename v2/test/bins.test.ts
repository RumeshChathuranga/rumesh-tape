import { describe, expect, it } from 'vitest';
import { autoRowMult, baseBin, binIndex, formatQty, rowOf, ROW_MULTS } from '../src/model/bins';
import type { Candle } from '../src/model/types';

const candle = (range: number): Candle => ({ t: 0, o: 100, h: 100 + range, l: 100, c: 100, v: 1, buyV: 0 });

describe('baseBin', () => {
    it('picks a round step near one basis point of price', () => {
        expect(baseBin(60000, 0.1)).toBe(5);
        expect(baseBin(3000, 0.01)).toBe(0.2);
        expect(baseBin(1.5, 0.0001)).toBe(0.0001);
    });
    it('handles tiny prices without float drift', () => {
        expect(baseBin(0.2, 0.00001)).toBeCloseTo(0.00002, 12);
    });
    it('never goes below the exchange tick size', () => {
        expect(baseBin(5, 0.001)).toBe(0.001);
    });
});

describe('binIndex and rowOf', () => {
    it('floors prices into bins', () => {
        expect(binIndex(60000.1, 5)).toBe(12000);
        expect(binIndex(0.00001234, 0.00000001)).toBe(1234);
    });
    it('groups bins into rows, flooring negatives too', () => {
        expect(rowOf(12001, 2)).toBe(6000);
        expect(rowOf(-1, 2)).toBe(-1);
    });
});

describe('autoRowMult', () => {
    it('aims for about 12 rows per bar', () => {
        expect(autoRowMult(Array.from({ length: 50 }, () => candle(120)), 5)).toBe(2);
    });
    it('caps at the largest multiple', () => {
        expect(autoRowMult(Array.from({ length: 50 }, () => candle(10000)), 5)).toBe(ROW_MULTS[ROW_MULTS.length - 1]);
    });
});

describe('formatQty', () => {
    it('keeps three significant figures and short suffixes', () => {
        expect(formatQty(0.1234)).toBe('0.123');
        expect(formatQty(1.234)).toBe('1.23');
        expect(formatQty(12.34)).toBe('12.3');
        expect(formatQty(1234)).toBe('1.2k');
        expect(formatQty(1_234_000)).toBe('1.2M');
        expect(formatQty(0)).toBe('0');
    });
});
