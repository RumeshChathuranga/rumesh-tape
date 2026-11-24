import { describe, expect, it } from 'vitest';
import type { Fvg } from '../src/model/fvg';
import type { Profile } from '../src/model/levels';
import { buildZones, ZoneTracker } from '../src/model/zones';

const fvg = (o: Partial<Fvg>): Fvg => ({ side: 'bisi', tf: '15m', t1: 1, t3: 3, top: 99, bottom: 98, kind: 'perfect', mitigatedAt: null, ...o });
const prof = (day: number, vah: number, val: number): Profile => ({ day, bin: 1, poc: (vah + val) / 2, vah, val, total: 1 });
const base = { price: 100, profiles: [] as Profile[], nakedPocs: [] as number[], tolerance: 0.5 };

describe('buildZones', () => {
    it('keeps unmitigated 15m+ gaps on the bias side only', () => {
        const zones = buildZones({ ...base, bias: 'bullish', fvgs: [
            fvg({ t1: 1 }),                                  // kept: BISI below price
            fvg({ t1: 2, mitigatedAt: 5 }),                   // mitigated
            fvg({ t1: 3, kind: 'forming' }),                  // still forming
            fvg({ t1: 4, tf: '5m' }),                         // below 15m
            fvg({ t1: 5, side: 'sibi', top: 103, bottom: 102 }),  // against the bias
        ] });
        expect(zones.map((z) => z.id)).toEqual(['fvg:15m:1']);
        expect(zones[0]).toMatchObject({ side: 'support', top: 99, bottom: 98, grade: 'B', label: '15m BISI' });
    });

    it('grades a gap A when it sits on a volume level', () => {
        const zones = buildZones({ ...base, bias: 'bullish', fvgs: [fvg({})], profiles: [prof(0, 105, 98.2), prof(1, 0, 0)] });
        expect(zones.find((z) => z.kind === 'fvg')!.grade).toBe('A');
        expect(zones.find((z) => z.kind === 'val')).toMatchObject({ side: 'support', label: 'Yesterday VAL', top: 98.45, bottom: 97.95 });
        expect(zones.find((z) => z.kind === 'vah')).toMatchObject({ side: 'resistance' });
    });

    it('lists the nearest three per side', () => {
        const fvgs = [90, 95, 97, 93].map((top, i) => fvg({ t1: i, top, bottom: top - 1 }));
        const zones = buildZones({ ...base, bias: 'bullish', fvgs });
        expect(zones.filter((z) => z.side === 'support').map((z) => z.top)).toEqual([97, 95, 93]);
    });

    it('lists volume levels but no gaps without a bias', () => {
        const zones = buildZones({ ...base, bias: null, fvgs: [fvg({})], nakedPocs: [96] });
        expect(zones.map((z) => z.kind)).toEqual(['npoc']);
    });
});

describe('ZoneTracker', () => {
    it('reports the first time the traded range reaches a zone, once', () => {
        const [z] = buildZones({ ...base, bias: 'bullish', fvgs: [fvg({})] });
        const tr = new ZoneTracker();
        expect(tr.update([z], 99.5, 101, 10)).toEqual([]);
        expect(tr.update([z], 97.5, 100.2, 20).map((x) => x.id)).toEqual([z.id]);   // wick through it
        expect(tr.touchedAt(z.id)).toBe(20);
        expect(tr.update([z], 98.5, 98.6, 30)).toEqual([]);
    });
});
