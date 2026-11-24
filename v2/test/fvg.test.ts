import { describe, expect, it } from 'vitest';
import { findFvgs, fvgBias } from '../src/model/fvg';
import type { Candle } from '../src/model/types';

let t = 0;
const c = (o: number, h: number, l: number, cl: number): Candle => ({ t: (t += 60_000), o, h, l, c: cl, v: 1, buyV: 0.5 });
const c1 = () => c(100, 101, 99, 100.5);
const c2up = () => c(100.5, 110, 100.4, 109);

describe('findFvgs: BISI (bullish)', () => {
    it('finds the gap between candle 1 high and candle 3 low (guide: perfect FVG)', () => {
        const f = findFvgs([c1(), c2up(), c(109, 111, 105, 108)], '5m', false);
        expect(f).toHaveLength(1);
        expect(f[0]).toMatchObject({ side: 'bisi', bottom: 101, top: 105, kind: 'perfect', mitigatedAt: null, tf: '5m' });
    });

    it('needs candle 2 to close above candle 1 high', () => {
        expect(findFvgs([c1(), c(100.5, 110, 100.4, 100.8), c(109, 111, 105, 108)], '5m', false)).toEqual([]);
    });

    it('needs candle 3 to leave a gap (guide: candle 3 overlapping = no FVG)', () => {
        expect(findFvgs([c1(), c2up(), c(109, 111, 101, 108)], '5m', false)).toEqual([]);
    });

    it('calls it breakaway when candle 3 closes above candle 2 high', () => {
        expect(findFvgs([c1(), c2up(), c(109, 113, 106, 112)], '5m', false)[0].kind).toBe('breakaway');
    });

    it('calls it rejection when candle 3 is a big opposite candle', () => {
        expect(findFvgs([c1(), c2up(), c(109, 111, 104, 104.5)], '5m', false)[0].kind).toBe('rejection');
    });

    it('calls it forming while candle 3 is still open', () => {
        expect(findFvgs([c1(), c2up(), c(109, 111, 105, 108)], '5m', true)[0].kind).toBe('forming');
    });

    it('is mitigated by one tick into the gap, not before', () => {
        const base = () => [c1(), c2up(), c(109, 111, 105, 108)];
        const touched = [...base(), c(108, 109, 104.9, 106)];
        expect(findFvgs(touched, '5m', false)[0].mitigatedAt).toBe(touched[3].t);
        expect(findFvgs([...base(), c(108, 109, 105.1, 106)], '5m', false)[0].mitigatedAt).toBeNull();
    });
});

describe('findFvgs: SIBI (bearish)', () => {
    it('mirrors the bullish rules', () => {
        const f = findFvgs([c(100, 101, 99, 99.5), c(99.5, 99.6, 89, 90), c(93, 95, 91, 92)], '1h', false);
        expect(f).toHaveLength(1);
        expect(f[0]).toMatchObject({ side: 'sibi', top: 99, bottom: 95, kind: 'perfect', tf: '1h' });
    });
});

describe('fvgBias', () => {
    it('follows the most recent gap that has formed', () => {
        const bull = [c1(), c2up(), c(109, 111, 105, 108)];
        const bear = [c(108, 108.5, 107, 107.5), c(107.5, 107.6, 97, 98), c(99, 100, 98, 99)];
        const f = findFvgs([...bull, ...bear], '5m', false);
        expect(fvgBias(f)).toBe('bearish');
        expect(fvgBias(findFvgs(bull, '5m', false))).toBe('bullish');
        expect(fvgBias([])).toBeNull();
    });
});
