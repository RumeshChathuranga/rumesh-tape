import { findImbalances } from '../model/imbalance';
import type { Bar, Candle } from '../model/types';
import { yOfPrice, type View } from './scale';
import { C, MONO, rgba } from './theme';

export type CellMode = 'bidask' | 'volume' | 'delta';

export interface BarDrawOptions {
    mode: CellMode;
    rowSize: number;
    barW: number;
    showText: boolean;
}

const strip = (s: string) => (s.includes('.') && !s.includes('e') ? s.replace(/\.?0+$/, '') : s);

/** Compact cell number: whole numbers from 10, one decimal from 1, two figures below. */
export function formatCell(q: number): string {
    if (q === 0) return '0';
    const a = Math.abs(q);
    if (a >= 1e6) return strip((q / 1e6).toFixed(1)) + 'M';
    if (a >= 1e3) return strip((q / 1e3).toFixed(1)) + 'k';
    if (a >= 10) return String(Math.round(q));
    if (a >= 1) return strip(q.toFixed(1));
    return strip(q.toPrecision(2));
}

/** Plain candle, used for bars without real trades and when zoomed far out. */
export function drawCandle(ctx: CanvasRenderingContext2D, c: Candle, x: number, v: View, plotH: number, barW: number, muted = true): void {
    const up = c.c >= c.o;
    const col = up ? C.up : C.down;
    const yH = yOfPrice(c.h, v, plotH), yL = yOfPrice(c.l, v, plotH);
    const yO = yOfPrice(c.o, v, plotH), yC = yOfPrice(c.c, v, plotH);
    const w = Math.max(1, Math.min(barW * 0.6, barW - 2));
    ctx.strokeStyle = rgba(col, muted ? 0.7 : 1);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, yH);
    ctx.lineTo(Math.round(x) + 0.5, yL);
    ctx.stroke();
    const top = Math.min(yO, yC), h = Math.max(1, Math.abs(yC - yO));
    ctx.fillStyle = rgba(col, muted ? 0.3 : 0.85);
    ctx.fillRect(x - w / 2, top, w, h);
    if (muted && w > 3) ctx.strokeRect(x - w / 2 + 0.5, top + 0.5, w - 1, Math.max(0, h - 1));
}

/**
 * One footprint column. Cells exist only for bars fully covered by real
 * trades; anything else is drawn as a plain candle.
 */
export function drawBar(ctx: CanvasRenderingContext2D, bar: Bar, x: number, v: View, plotH: number, o: BarDrawOptions): void {
    if (!bar.real || !bar.rows) { drawCandle(ctx, bar, x, v, plotH, o.barW); return; }
    const rows = bar.rows;
    let max = 0, maxAbs = 0;
    for (const c of rows.values()) {
        max = Math.max(max, c.bid + c.ask);
        maxAbs = Math.max(maxAbs, Math.abs(c.ask - c.bid));
    }
    const imb = new Set(findImbalances(rows).map((i) => `${i.row}:${i.side}`));
    const left = x - o.barW / 2 + 1, w = o.barW - 2;

    for (const [r, c] of rows) {
        const yTop = yOfPrice((r + 1) * o.rowSize, v, plotH);
        const yBot = yOfPrice(r * o.rowSize, v, plotH);
        if (yBot < 0 || yTop > plotH) continue;
        const h = yBot - yTop, total = c.bid + c.ask, share = max ? total / max : 0;
        const delta = c.ask - c.bid;
        if (o.mode === 'volume') ctx.fillStyle = rgba(C.textDim, 0.06 + 0.42 * share);
        else if (o.mode === 'delta') ctx.fillStyle = rgba(delta >= 0 ? C.up : C.down, 0.08 + 0.5 * (maxAbs ? Math.abs(delta) / maxAbs : 0));
        else ctx.fillStyle = rgba(c.ask >= c.bid ? C.up : C.down, 0.06 + 0.34 * share);
        ctx.fillRect(left, yTop + 0.5, w, Math.max(1, h - 1));

        if (!o.showText) continue;
        const mid = yTop + h / 2;
        ctx.font = `500 ${Math.max(8, Math.min(11, h - 3))}px ${MONO}`;
        ctx.textBaseline = 'middle';
        if (o.mode === 'bidask') {
            ctx.textAlign = 'right';
            ctx.fillStyle = imb.has(`${r}:sell`) ? C.accent : C.textDim;
            ctx.fillText(formatCell(c.bid), x - 4, mid);
            ctx.textAlign = 'left';
            ctx.fillStyle = imb.has(`${r}:buy`) ? C.accent : C.textDim;
            ctx.fillText(formatCell(c.ask), x + 4, mid);
        } else {
            ctx.textAlign = 'center';
            ctx.fillStyle = o.mode === 'delta' ? (delta >= 0 ? C.up : C.down) : C.text;
            ctx.fillText(formatCell(o.mode === 'delta' ? delta : total), x, mid);
        }
    }

    if (bar.poc !== null) {
        const yTop = yOfPrice((bar.poc + 1) * o.rowSize, v, plotH);
        const yBot = yOfPrice(bar.poc * o.rowSize, v, plotH);
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 1;
        ctx.strokeRect(left + 0.5, yTop + 0.5, w - 1, Math.max(1, yBot - yTop - 1));
    }
    // Open-to-close stripe on the left edge keeps the candle readable.
    const yO = yOfPrice(bar.o, v, plotH), yC = yOfPrice(bar.c, v, plotH);
    ctx.fillStyle = bar.c >= bar.o ? C.up : C.down;
    ctx.fillRect(left - 1, Math.min(yO, yC), 2, Math.max(1, Math.abs(yC - yO)));
}
