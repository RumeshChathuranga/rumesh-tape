import type { OrderBook } from '../data/book';
import { priceAtY, yOfPrice, type View } from './scale';
import { C, SANS, rgba } from './theme';

/** Resting bids (green) and asks (red) per row, drawn only while the book is synced. */
export function drawBook(
    ctx: CanvasRenderingContext2D, book: OrderBook | null, synced: boolean,
    v: View, plotH: number, x0: number, width: number, rowSize: number,
): void {
    ctx.fillStyle = C.bg;
    ctx.fillRect(x0, 0, width, plotH);
    ctx.strokeStyle = C.line;
    ctx.beginPath(); ctx.moveTo(x0 + 0.5, 0); ctx.lineTo(x0 + 0.5, plotH); ctx.stroke();
    if (!book || !synced) {
        ctx.fillStyle = C.muted;
        ctx.font = `500 10px ${SANS}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Order book syncing', x0 + width / 2, 14);
        return;
    }
    const hiP = priceAtY(0, v, plotH), loP = priceAtY(plotH, v, plotH);
    const rows = new Map<number, { b: number; a: number }>();
    const add = (side: Map<number, number>, key: 'b' | 'a') => {
        for (const [p, q] of side) {
            if (p < loP || p > hiP) continue;
            const r = Math.floor(p / rowSize + 1e-9);
            const e = rows.get(r) ?? { b: 0, a: 0 };
            e[key] += q;
            rows.set(r, e);
        }
    };
    add(book.bids, 'b');
    add(book.asks, 'a');
    let max = 0;
    for (const e of rows.values()) max = Math.max(max, e.b, e.a);
    if (!max) return;
    for (const [r, e] of rows) {
        const yTop = yOfPrice((r + 1) * rowSize, v, plotH), yBot = yOfPrice(r * rowSize, v, plotH);
        const h = Math.max(1, yBot - yTop - 1);
        if (e.b) { ctx.fillStyle = rgba(C.up, 0.55); const w = (e.b / max) * (width - 4); ctx.fillRect(x0 + width - w, yTop + 0.5, w, h); }
        if (e.a) { ctx.fillStyle = rgba(C.down, 0.55); const w = (e.a / max) * (width - 4); ctx.fillRect(x0 + width - w, yTop + 0.5, w, h); }
    }
}
