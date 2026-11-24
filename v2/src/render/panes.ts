import { formatQty } from '../model/bins';
import { formatCell } from './footprint';
import { C, MONO, SANS, rgba } from './theme';

export const SUMMARY_ROW_H = 16;
export const SUMMARY_LABELS = ['Delta', 'Cum delta', 'Volume'];

export interface SummaryItem { x: number; delta: number; cvd: number; vol: number }

/** Three rows under the chart: Delta, Cum delta, Volume (the course's minimal panel). */
export function drawSummary(ctx: CanvasRenderingContext2D, items: SummaryItem[], top: number, width: number, barW: number): void {
    ctx.fillStyle = C.panel;
    ctx.fillRect(0, top, width, SUMMARY_ROW_H * 3);
    ctx.strokeStyle = C.line;
    ctx.beginPath();
    for (let r = 0; r <= 3; r++) { ctx.moveTo(0, top + r * SUMMARY_ROW_H + 0.5); ctx.lineTo(width, top + r * SUMMARY_ROW_H + 0.5); }
    ctx.stroke();
    const maxVol = Math.max(1e-12, ...items.map((i) => i.vol));
    const text = barW >= 28;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = `500 10px ${MONO}`;
    for (const it of items) {
        const cells = [
            { v: it.delta, col: it.delta >= 0 ? C.up : C.down, a: 0.18 },
            { v: it.cvd, col: it.cvd >= 0 ? C.up : C.down, a: 0.1 },
            { v: it.vol, col: C.textDim, a: 0.06 + 0.3 * (it.vol / maxVol) },
        ];
        cells.forEach((c, r) => {
            const y = top + r * SUMMARY_ROW_H;
            ctx.fillStyle = rgba(c.col, c.a);
            ctx.fillRect(it.x - barW / 2 + 1, y + 1, barW - 2, SUMMARY_ROW_H - 1);
            if (text) {
                ctx.fillStyle = r === 2 ? C.textDim : c.col;
                ctx.fillText(r === 2 ? formatQty(c.v) : formatCell(c.v), it.x, y + SUMMARY_ROW_H / 2 + 1);
            }
        });
    }
    ctx.textAlign = 'left';
    ctx.font = `500 10px ${SANS}`;
    SUMMARY_LABELS.forEach((label, r) => {
        const y = top + r * SUMMARY_ROW_H;
        const w = ctx.measureText(label).width + 12;
        ctx.fillStyle = rgba(C.panel, 0.92);
        ctx.fillRect(0, y + 1, w, SUMMARY_ROW_H - 1);
        ctx.fillStyle = C.muted;
        ctx.fillText(label, 6, y + SUMMARY_ROW_H / 2 + 1);
    });
}

/** Session CVD as a line in its own pane: green while rising, red while falling. */
export function drawCvd(ctx: CanvasRenderingContext2D, pts: { x: number; v: number }[], top: number, height: number, width: number): void {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, top, width, height);
    ctx.strokeStyle = C.line;
    ctx.beginPath(); ctx.moveTo(0, top + 0.5); ctx.lineTo(width, top + 0.5); ctx.stroke();
    ctx.fillStyle = C.muted;
    ctx.font = `500 10px ${SANS}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('CVD (resets 00:00 UTC)', 6, top + 4);
    if (pts.length < 2) return;
    let lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
    if (hi === lo) { hi += 1; lo -= 1; }
    const pad = 8;
    const y = (v: number) => top + pad + (1 - (v - lo) / (hi - lo)) * (height - 2 * pad);
    if (lo < 0 && hi > 0) {
        ctx.strokeStyle = C.line;
        ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(0, y(0)); ctx.lineTo(width, y(0)); ctx.stroke();
        ctx.setLineDash([]);
    }
    ctx.lineWidth = 1.5;
    for (let i = 1; i < pts.length; i++) {
        ctx.strokeStyle = pts[i].v >= pts[i - 1].v ? C.up : C.down;
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, y(pts[i - 1].v));
        ctx.lineTo(pts[i].x, y(pts[i].v));
        ctx.stroke();
    }
    ctx.lineWidth = 1;
}
