import { describe, expect, it } from 'vitest';
import { FrameScheduler } from '../src/render/frame';
import { drawBar, formatCell } from '../src/render/footprint';
import { barAtX, fitView, priceAtY, xOfBar, yOfPrice, type View } from '../src/render/scale';
import type { Bar, Candle, Cells } from '../src/model/types';

const view: View = { barW: 80, scrollBars: 0, priceMid: 100, pxPerPrice: 10 };

describe('scale', () => {
    it('puts the newest bar near the right edge and maps back from x', () => {
        expect(xOfBar(9, 10, view, 1000)).toBe(1000 - 60 - 40);
        for (const i of [0, 3, 9]) expect(barAtX(xOfBar(i, 10, view, 1000), 10, view, 1000)).toBe(i);
    });

    it('maps price to y and back', () => {
        expect(yOfPrice(100, view, 400)).toBe(200);
        expect(priceAtY(yOfPrice(103.5, view, 400), view, 400)).toBeCloseTo(103.5, 9);
    });

    it('fits every high and low of the range inside the plot', () => {
        const cs: Candle[] = [90, 120, 105].map((h, i) => ({ t: i, o: h - 5, h, l: h - 10, c: h - 2, v: 1, buyV: 0 }));
        const v = fitView(cs, 0, 3, 500, 40);
        for (const c of cs) {
            expect(yOfPrice(c.h, v, 500)).toBeGreaterThanOrEqual(0);
            expect(yOfPrice(c.l, v, 500)).toBeLessThanOrEqual(500);
        }
    });
});

describe('FrameScheduler', () => {
    it('turns many render requests into one frame', () => {
        const frames: FrameRequestCallback[] = [];
        let renders = 0;
        const s = new FrameScheduler(() => { renders++; }, (cb) => { frames.push(cb); return frames.length; });
        for (let i = 0; i < 100; i++) s.request();
        expect(frames).toHaveLength(1);
        frames[0](0);
        expect(renders).toBe(1);
        s.request();
        expect(frames).toHaveLength(2);
    });
});

/** A 2D context that records what was written with fillText. */
function recordingCtx() {
    const texts: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
        get(target, prop) {
            if (prop === 'fillText') return (t: string) => { texts.push(String(t)); };
            if (prop === 'measureText') return (t: string) => ({ width: String(t).length * 6 });
            if (prop in target) return target[prop as string];
            return () => {};
        },
        set(target, prop, value) { target[prop as string] = value; return true; },
    });
    return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
}

const bar = (real: boolean, rows: Cells | null): Bar =>
    ({ t: 0, o: 100, h: 101, l: 100, c: 101, v: 15, buyV: 2, real, rows, poc: rows ? 10 : null });
const rows: Cells = new Map([[10, { bid: 13, ask: 2 }]]);
const opts = (mode: 'bidask' | 'volume' | 'delta') => ({ mode, rowSize: 10, barW: 80, showText: true });

describe('drawBar', () => {
    it('writes bid and ask for each row of a real bar', () => {
        const { ctx, texts } = recordingCtx();
        drawBar(ctx, bar(true, rows), 500, view, 400, opts('bidask'));
        expect(texts).toEqual(expect.arrayContaining(['13', '2']));
    });

    it('writes no cell numbers for a bar without real trades', () => {
        const { ctx, texts } = recordingCtx();
        drawBar(ctx, bar(false, null), 500, view, 400, opts('bidask'));
        expect(texts).toEqual([]);
    });

    it('writes ask minus bid in delta mode', () => {
        const { ctx, texts } = recordingCtx();
        drawBar(ctx, bar(true, rows), 500, view, 400, opts('delta'));
        expect(texts).toContain('-11');
    });

    it('formats cell numbers compactly', () => {
        expect(formatCell(13)).toBe('13');
        expect(formatCell(2)).toBe('2');
        expect(formatCell(2.46)).toBe('2.5');
        expect(formatCell(0.523)).toBe('0.52');
        expect(formatCell(1530)).toBe('1.5k');
        expect(formatCell(-11)).toBe('-11');
    });
});
