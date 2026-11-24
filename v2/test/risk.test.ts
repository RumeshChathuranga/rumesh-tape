import { describe, expect, it } from 'vitest';
import { limitReached, positionSize, recordTrade, usOpenWindow } from '../src/model/risk';

describe('positionSize', () => {
    it('matches the strategy example: $1,000, 0.5% risk, 0.15% stop on BTC', () => {
        const p = positionSize({ account: 1000, riskPct: 0.5, entry: 60000, stop: 59910 })!;
        expect(p.stopPct).toBeCloseTo(0.15, 9);
        expect(p.notional).toBeCloseTo(2272.73, 2);
        expect(p.leverage).toBeCloseTo(2.27, 2);
        expect(p.qty).toBeCloseTo(0.03788, 5);
        expect(p.risk).toBeCloseTo(5, 9);
        expect(p.fees).toBeCloseTo(1.59, 2);
        expect(p.target).toBe(60225);
        expect(p.tooWide).toBe(false);
    });

    it('works for shorts', () => {
        expect(positionSize({ account: 1000, riskPct: 0.5, entry: 100, stop: 100.1 })!.target).toBeCloseTo(99.75, 9);
    });

    it('flags a stop wider than 0.25% of price', () => {
        expect(positionSize({ account: 1000, riskPct: 0.5, entry: 100, stop: 99.6 })!.tooWide).toBe(true);
    });

    it('returns null for inputs that make no sense', () => {
        expect(positionSize({ account: 1000, riskPct: 0.5, entry: 100, stop: 100 })).toBeNull();
        expect(positionSize({ account: 0, riskPct: 0.5, entry: 100, stop: 99 })).toBeNull();
        expect(positionSize({ account: 1000, riskPct: -1, entry: 100, stop: 99 })).toBeNull();
        expect(positionSize({ account: NaN, riskPct: 0.5, entry: 100, stop: 99 })).toBeNull();
    });
});

describe('usOpenWindow', () => {
    it('follows New York daylight saving', () => {
        const summer = usOpenWindow(Date.UTC(2026, 6, 15, 14, 0));
        expect(summer.open).toBe(Date.UTC(2026, 6, 15, 13, 30));
        expect(summer.start).toBe(Date.UTC(2026, 6, 15, 13, 15));
        expect(summer.end).toBe(Date.UTC(2026, 6, 15, 14, 45));
        expect(summer.state).toBe('open');
        const winter = usOpenWindow(Date.UTC(2026, 10, 24, 12, 0));
        expect(winter.open).toBe(Date.UTC(2026, 10, 24, 14, 30));
        expect(winter.state).toBe('before');
        expect(usOpenWindow(Date.UTC(2026, 10, 24, 16, 0)).state).toBe('after');
    });

    it('is closed at weekends', () => {
        expect(usOpenWindow(Date.UTC(2026, 10, 28, 15, 0)).state).toBe('weekend');
    });
});

describe('daily trade limits', () => {
    it('stops after two losses and starts again the next UTC day', () => {
        const day = Date.UTC(2026, 10, 24, 15);
        let c = { day: 0, trades: 0, losses: 0 };
        c = recordTrade(c, day, 'win');
        c = recordTrade(c, day, 'loss');
        expect(limitReached(c)).toBe(false);
        c = recordTrade(c, day, 'loss');
        expect(c).toMatchObject({ trades: 3, losses: 2 });
        expect(limitReached(c)).toBe(true);
        c = recordTrade(c, day + 86_400_000, 'win');
        expect(c).toMatchObject({ trades: 1, losses: 0 });
    });
});
