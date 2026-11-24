import type { Profile } from '../model/levels';
import type { Zone } from '../model/zones';
import type { OverlayHelpers } from './chart';
import { C, SANS, rgba } from './theme';

export interface LevelLayer {
    vwap: { t: number; v: number }[];
    profile: Profile | null;      // previous day
    nakedPocs: number[];
    zones: Zone[];
    touched: (id: string) => number | null;
}

function hline(ctx: CanvasRenderingContext2D, h: OverlayHelpers, p: number, color: string, dash: number[], label: string) {
    const y = Math.round(h.yOfPrice(p)) + 0.5;
    if (y < 0 || y > h.plotH) return;
    ctx.strokeStyle = color;
    ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(h.plotRight, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, h.plotRight - 64, y - 2);
}

/** VWAP, previous-day value area, naked POCs and the strategy zones. */
export function drawLevels(ctx: CanvasRenderingContext2D, h: OverlayHelpers, o: LevelLayer): void {
    ctx.save();
    ctx.font = `500 10px ${SANS}`;
    ctx.lineWidth = 1;
    if (o.profile) {
        hline(ctx, h, o.profile.vah, rgba(C.textDim, 0.55), [6, 4], 'Prev VAH');
        hline(ctx, h, o.profile.val, rgba(C.textDim, 0.55), [6, 4], 'Prev VAL');
        hline(ctx, h, o.profile.poc, rgba(C.textDim, 0.8), [6, 4], 'Prev POC');
    }
    for (const p of o.nakedPocs) hline(ctx, h, p, rgba(C.textDim, 0.7), [2, 3], 'Naked POC');

    if (o.vwap.length > 1) {
        ctx.strokeStyle = rgba(C.accent, 0.85);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        o.vwap.forEach((pt, i) => {
            const x = h.xOfTime(pt.t), y = h.yOfPrice(pt.v);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        const last = o.vwap[o.vwap.length - 1];
        ctx.fillStyle = rgba(C.accent, 0.9);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText('VWAP', Math.min(h.plotRight - 40, h.xOfTime(last.t) + 6), h.yOfPrice(last.v) - 2);
        ctx.lineWidth = 1;
    }

    for (const z of o.zones) {
        const yT = h.yOfPrice(z.top), yB = h.yOfPrice(z.bottom);
        if (yB < 0 || yT > h.plotH) continue;
        const faded = o.touched(z.id) !== null ? 0.35 : 1;
        const col = z.grade === 'A' ? C.accent : C.textDim;
        ctx.strokeStyle = rgba(col, 0.7 * faded);
        ctx.setLineDash(z.grade === 'A' ? [] : [4, 3]);
        ctx.strokeRect(0.5, Math.round(yT) + 0.5, h.plotRight - 1, Math.max(1, Math.round(yB - yT)));
        ctx.setLineDash([]);
        ctx.fillStyle = rgba(col, 0.9 * faded);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(`${z.grade} · ${z.label}${faded < 1 ? ' · touched' : ''}`, 6, Math.max(2, yT + 2));
    }
    ctx.restore();
}
