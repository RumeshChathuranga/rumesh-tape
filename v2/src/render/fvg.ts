import type { Fvg } from '../model/fvg';
import type { OverlayHelpers } from './chart';
import { C, SANS, rgba } from './theme';

const KIND: Record<Fvg['kind'], string> = { perfect: 'Perfect', rejection: 'Rejection', breakaway: 'Breakaway', forming: 'Forming' };

/** Fair value gap zones from candle 1 to the right edge, or to where they were mitigated. */
export function drawFvgs(ctx: CanvasRenderingContext2D, fvgs: Fvg[], h: OverlayHelpers, showMitigated: boolean): void {
    ctx.font = `500 10px ${SANS}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    for (const f of fvgs) {
        if (f.mitigatedAt !== null && !showMitigated) continue;
        const x0 = Math.max(0, h.xOfTime(f.t1));
        const x1 = f.mitigatedAt !== null ? Math.min(h.plotRight, h.xOfTime(f.mitigatedAt)) : h.plotRight;
        if (x1 <= x0) continue;
        const yT = h.yOfPrice(f.top), yB = h.yOfPrice(f.bottom);
        if (yB < 0 || yT > h.plotH) continue;
        const col = f.side === 'bisi' ? C.up : C.down;
        const faded = f.mitigatedAt !== null ? 0.4 : 1;
        ctx.fillStyle = rgba(col, 0.1 * faded);
        ctx.fillRect(x0, yT, x1 - x0, Math.max(1, yB - yT));
        ctx.strokeStyle = rgba(col, 0.35 * faded);
        ctx.strokeRect(Math.round(x0) + 0.5, Math.round(yT) + 0.5, Math.round(x1 - x0) - 1, Math.max(1, Math.round(yB - yT) - 1));
        if (yB - yT >= 12) {
            ctx.fillStyle = rgba(col, 0.85 * faded);
            ctx.fillText(`${f.tf} ${f.side.toUpperCase()} · ${KIND[f.kind]}`, x0 + 4, yT + 2);
        }
    }
}
