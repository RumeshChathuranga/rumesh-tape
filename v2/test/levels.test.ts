import { describe, expect, it } from 'vitest';
import { dailyProfiles, nakedPocs, sessionVwap, volumeProfile } from '../src/model/levels';
import type { Candle } from '../src/model/types';

const DAY = 86_400_000;
const D0 = Date.UTC(2026, 10, 20);
const k = (t: number, l: number, h: number, v: number, c = (l + h) / 2): Candle => ({ t, o: c, h, l, c, v, buyV: v / 2 });

describe('sessionVwap', () => {
    it('weights typical price by volume and resets each UTC day', () => {
        const cs = [k(D0, 9, 11, 1, 10), k(D0 + 60_000, 19, 21, 3, 20), k(D0 + DAY, 49, 51, 2, 50)];
        expect(sessionVwap(cs)).toEqual([10, 17.5, 50]);
    });
});

describe('volumeProfile', () => {
    it('spreads a candle evenly over the bins it covers, POC on the lowest tie', () => {
        const p = volumeProfile([k(D0, 100, 110, 10)], 5)!;
        expect(p.total).toBeCloseTo(10, 9);
        expect(p.poc).toBe(100);
    });

    it('builds the 70% value area by adding the bigger neighbour first', () => {
        const cs = [1, 2, 10, 3, 1].map((v, i) => k(D0 + i * 60_000, i + 1, i + 1, v));
        expect(volumeProfile(cs, 1)).toMatchObject({ poc: 3, val: 3, vah: 4, total: 17, day: D0 });
    });

    it('returns null without volume', () => {
        expect(volumeProfile([], 1)).toBeNull();
    });
});

describe('dailyProfiles and nakedPocs', () => {
    const day1 = [k(D0, 100, 100, 5)];
    const day2 = [k(D0 + DAY, 120, 120, 5)];
    const day3 = [k(D0 + 2 * DAY, 110, 130, 5)];

    it('makes one profile per UTC day', () => {
        expect(dailyProfiles([...day1, ...day2, ...day3], 1).map((p) => p.poc)).toEqual([100, 120, 110]);
    });

    it('keeps earlier POCs that price has not come back to', () => {
        const cs = [...day1, ...day2, ...day3];
        expect(nakedPocs(dailyProfiles(cs, 1), cs)).toEqual([100]);
        const touched = [...cs, k(D0 + 2 * DAY + 60_000, 99, 112, 1)];
        expect(nakedPocs(dailyProfiles(touched, 1), touched)).toEqual([]);
    });
});
