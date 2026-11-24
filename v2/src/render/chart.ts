import type { OrderBook } from '../data/book';
import { barDelta } from '../model/cvd';
import type { Bar, Candle, Print } from '../model/types';
import { drawBook } from './bookProfile';
import { drawBar, drawCandle, type CellMode } from './footprint';
import { FrameScheduler } from './frame';
import { drawCvd, drawSummary, SUMMARY_ROW_H, type SummaryItem } from './panes';
import { barAtX, fitView, niceStep, priceAtY, xOfBar, yOfPrice, type View } from './scale';
import { C, MONO, SANS, rgba } from './theme';

export type { CellMode } from './footprint';

export interface ChartSource {
    length: number;
    candle(i: number): Candle;
    bar(i: number): Bar;
    cvd(i: number): number;
    prints(from: number, to: number): Print[];
    rowSize: number;
    tfMs: number;
    priceDecimals: number;
    coveredFrom: number | null;
    book: OrderBook | null;
    bookSynced: boolean;
}

export interface ChartOptions {
    mode: CellMode;
    showCvd: boolean;
    showBook: boolean;
    bigPrintUsd: number;
}

/** Drawing hook for extra layers (fair value gaps etc.), called inside the plot clip. */
export interface OverlayHelpers {
    xOfTime(t: number): number;
    yOfPrice(p: number): number;
    plotRight: number;
    plotH: number;
    firstTime: number;
}

const AXIS_W = 64;
const BOOK_W = 120;
const TIME_H = 22;
const CVD_H = 80;

const pad2 = (n: number) => (n < 10 ? '0' : '') + n;
const hhmm = (t: number) => { const d = new Date(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

export class Chart {
    source: ChartSource | null = null;
    options: ChartOptions = { mode: 'bidask', showCvd: true, showBook: true, bigPrintUsd: 100_000 };
    overlay: ((ctx: CanvasRenderingContext2D, h: OverlayHelpers) => void) | null = null;
    renders = 0;

    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private readonly sched: FrameScheduler;
    private readonly ro: ResizeObserver;
    private W = 0;
    private H = 0;
    private view: View = { barW: 24, scrollBars: 0, priceMid: 0, pxPerPrice: 1 };
    private autoY = true;
    private cross: { x: number; y: number } | null = null;
    private drag: { x: number; y: number; scroll: number; mid: number; ppp: number; axis: boolean } | null = null;

    constructor(private readonly host: HTMLElement, raf?: (cb: FrameRequestCallback) => number) {
        this.canvas = document.createElement('canvas');
        this.canvas.style.display = 'block';
        this.canvas.style.touchAction = 'none';
        host.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d')!;
        this.sched = new FrameScheduler(() => this.renderNow(), raf);
        this.ro = new ResizeObserver(() => this.resize());
        this.ro.observe(host);
        this.bindEvents();
        this.resize();
    }

    requestRender(): void { this.sched.request(); }

    resetView(): void {
        this.view.scrollBars = 0;
        this.autoY = true;
        this.requestRender();
    }

    destroy(): void {
        this.ro.disconnect();
        this.canvas.remove();
    }

    private resize() {
        const dpr = window.devicePixelRatio || 1;
        this.W = this.host.clientWidth;
        this.H = this.host.clientHeight;
        this.canvas.width = Math.max(1, Math.round(this.W * dpr));
        this.canvas.height = Math.max(1, Math.round(this.H * dpr));
        this.canvas.style.width = `${this.W}px`;
        this.canvas.style.height = `${this.H}px`;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.renderNow();
    }

    private layout() {
        const o = this.options;
        const plotRight = Math.max(50, this.W - AXIS_W - (o.showBook ? BOOK_W : 0));
        const cvdH = o.showCvd ? CVD_H : 0;
        const plotH = Math.max(50, this.H - TIME_H - SUMMARY_ROW_H * 3 - cvdH);
        return { plotRight, plotH, cvdTop: plotH, cvdH, sumTop: plotH + cvdH, timeTop: plotH + cvdH + SUMMARY_ROW_H * 3 };
    }

    renderNow(): void {
        this.renders++;
        const { ctx, W, H } = this;
        ctx.fillStyle = C.bg;
        ctx.fillRect(0, 0, W, H);
        const s = this.source;
        if (!s || !s.length) {
            ctx.fillStyle = C.muted;
            ctx.font = `500 12px ${SANS}`;
            ctx.textAlign = 'center';
            ctx.fillText('Loading market data', W / 2, H / 2);
            return;
        }
        const L = this.layout();
        const v = this.view, n = s.length;
        const first = Math.max(0, barAtX(0, n, v, L.plotRight) - 1);
        const last = Math.min(n - 1, barAtX(L.plotRight, n, v, L.plotRight) + 1);
        if (last < first) return;
        if (this.autoY) {
            const cs: Candle[] = [];
            for (let i = first; i <= last; i++) cs.push(s.candle(i));
            const f = fitView(cs, 0, cs.length, L.plotH, v.barW);
            v.priceMid = f.priceMid;
            v.pxPerPrice = f.pxPerPrice;
        }
        const yP = (p: number) => yOfPrice(p, v, L.plotH);
        const step = niceStep(60 / v.pxPerPrice);

        // ---- plot
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, L.plotRight, L.plotH); ctx.clip();
        ctx.strokeStyle = C.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const pTop = priceAtY(0, v, L.plotH), pBot = priceAtY(L.plotH, v, L.plotH);
        for (let p = Math.ceil(pBot / step) * step; p <= pTop; p += step) {
            const y = Math.round(yP(p)) + 0.5;
            ctx.moveTo(0, y); ctx.lineTo(L.plotRight, y);
        }
        ctx.stroke();

        const firstT = s.candle(first).t;
        const xOfTime = (t: number) => {
            const i = first + (t - firstT) / s.tfMs;
            return xOfBar(first, n, v, L.plotRight) + (i - first) * v.barW;
        };
        this.drawCoverage(s, first, last, n, L.plotRight, L.plotH);
        if (this.overlay) this.overlay(ctx, { xOfTime: (t) => xOfTime(t) - v.barW / 2, yOfPrice: yP, plotRight: L.plotRight, plotH: L.plotH, firstTime: firstT });

        const rowPx = s.rowSize * v.pxPerPrice;
        const footprint = v.barW >= 8 && rowPx >= 2;
        const showText = v.barW >= 56 && rowPx >= 12;
        for (let i = first; i <= last; i++) {
            const x = xOfBar(i, n, v, L.plotRight);
            if (footprint) drawBar(ctx, s.bar(i), x, v, L.plotH, { mode: this.options.mode, rowSize: s.rowSize, barW: v.barW, showText });
            else drawCandle(ctx, s.candle(i), x, v, L.plotH, v.barW, false);
        }
        this.drawPrints(s, first, last, xOfTime, yP);
        ctx.restore();

        // ---- last price
        const lastC = s.candle(n - 1);
        const yLast = Math.round(yP(lastC.c)) + 0.5;
        const lastCol = lastC.c >= lastC.o ? C.up : C.down;
        ctx.strokeStyle = rgba(lastCol, 0.6);
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(0, yLast); ctx.lineTo(L.plotRight, yLast); ctx.stroke();
        ctx.setLineDash([]);

        if (this.options.showBook) drawBook(ctx, s.book, s.bookSynced, v, L.plotH, L.plotRight, BOOK_W, s.rowSize);

        // ---- price axis
        const axX = W - AXIS_W;
        ctx.fillStyle = C.panel;
        ctx.fillRect(axX, 0, AXIS_W, H);
        ctx.strokeStyle = C.line;
        ctx.beginPath(); ctx.moveTo(axX + 0.5, 0); ctx.lineTo(axX + 0.5, H); ctx.stroke();
        ctx.font = `500 10px ${MONO}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = C.muted;
        const dec = Math.max(s.priceDecimals, step < 1 ? Math.ceil(-Math.log10(step)) : 0);
        for (let p = Math.ceil(pBot / step) * step; p <= pTop; p += step) {
            const y = yP(p);
            if (y > 8 && y < L.plotH - 8) ctx.fillText(p.toFixed(dec), axX + 6, y);
        }
        this.axisLabel(lastC.c.toFixed(s.priceDecimals), yLast, lastCol, C.panel);

        // ---- CVD and summary
        const items: SummaryItem[] = [];
        const cvdPts: { x: number; v: number }[] = [];
        for (let i = first; i <= last; i++) {
            const c = s.candle(i), x = xOfBar(i, n, v, L.plotRight);
            items.push({ x, delta: barDelta(c), cvd: s.cvd(i), vol: c.v });
            cvdPts.push({ x, v: s.cvd(i) });
        }
        ctx.save();
        ctx.beginPath(); ctx.rect(0, L.plotH, L.plotRight, H - L.plotH); ctx.clip();
        if (L.cvdH) drawCvd(ctx, cvdPts, L.cvdTop, L.cvdH, L.plotRight);
        drawSummary(ctx, items, L.sumTop, L.plotRight, v.barW);
        ctx.restore();

        // ---- time axis
        ctx.fillStyle = C.panel;
        ctx.fillRect(0, L.timeTop, axX, TIME_H);
        ctx.strokeStyle = C.line;
        ctx.beginPath(); ctx.moveTo(0, L.timeTop + 0.5); ctx.lineTo(axX, L.timeTop + 0.5); ctx.stroke();
        ctx.fillStyle = C.muted;
        ctx.textAlign = 'center';
        ctx.font = `500 10px ${MONO}`;
        const every = Math.max(1, Math.ceil(80 / v.barW));
        for (let i = first; i <= last; i++) {
            if (i % every) continue;
            const x = xOfBar(i, n, v, L.plotRight);
            if (x > 20 && x < L.plotRight - 20) ctx.fillText(hhmm(s.candle(i).t), x, L.timeTop + TIME_H / 2);
        }

        // ---- crosshair
        const cr = this.cross;
        if (cr && cr.x < L.plotRight && cr.y < L.plotH) {
            ctx.strokeStyle = rgba(C.textDim, 0.35);
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(0, cr.y + 0.5); ctx.lineTo(L.plotRight, cr.y + 0.5);
            ctx.moveTo(cr.x + 0.5, 0); ctx.lineTo(cr.x + 0.5, L.timeTop);
            ctx.stroke();
            ctx.setLineDash([]);
            this.axisLabel(priceAtY(cr.y, v, L.plotH).toFixed(s.priceDecimals), cr.y, C.raise, C.text);
            const i = Math.min(n - 1, Math.max(0, barAtX(cr.x, n, v, L.plotRight)));
            const label = hhmm(s.candle(i).t);
            ctx.font = `500 10px ${MONO}`;
            const w = ctx.measureText(label).width + 10;
            ctx.fillStyle = C.raise;
            ctx.fillRect(cr.x - w / 2, L.timeTop + 2, w, TIME_H - 4);
            ctx.fillStyle = C.text;
            ctx.textAlign = 'center';
            ctx.fillText(label, cr.x, L.timeTop + TIME_H / 2);
        }
    }

    /** Dashed line where real trades start; bars to its left have no footprint cells. */
    private drawCoverage(s: ChartSource, first: number, last: number, n: number, plotRight: number, plotH: number) {
        if (s.coveredFrom === null) return;
        let idx = -1;
        for (let i = first; i <= last; i++) if (s.candle(i).t >= s.coveredFrom) { idx = i; break; }
        if (idx <= first) return;
        const x = Math.round(xOfBar(idx, n, this.view, plotRight) - this.view.barW / 2) + 0.5;
        const ctx = this.ctx;
        ctx.strokeStyle = rgba(C.accent, 0.5);
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, plotH); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = rgba(C.accent, 0.85);
        ctx.font = `500 10px ${SANS}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('Real trades from here', x + 6, 6);
    }

    private drawPrints(s: ChartSource, first: number, last: number, xOfTime: (t: number) => number, yP: (p: number) => number) {
        const from = s.candle(first).t, to = s.candle(last).t + s.tfMs;
        const big = s.prints(from, to).filter((p) => p.notional >= this.options.bigPrintUsd);
        if (!big.length) return;
        const max = Math.max(...big.map((p) => p.notional));
        const ctx = this.ctx;
        for (const p of big) {
            const r = 4 + 10 * Math.sqrt(p.notional / max);
            const col = p.side === 'buy' ? C.up : C.down;
            ctx.fillStyle = rgba(col, 0.3);
            ctx.strokeStyle = rgba(col, 0.9);
            ctx.beginPath();
            ctx.arc(xOfTime(p.time), yP(p.vwap), r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
    }

    private axisLabel(text: string, y: number, bg: string, fg: string) {
        const ctx = this.ctx, x = this.W - AXIS_W;
        ctx.fillStyle = bg;
        ctx.fillRect(x + 1, y - 9, AXIS_W - 1, 18);
        ctx.fillStyle = fg === C.panel ? '#FFFFFF' : fg;
        ctx.font = `600 10px ${MONO}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + 6, y);
    }

    private bindEvents() {
        const c = this.canvas;
        c.addEventListener('pointerdown', (e) => {
            c.setPointerCapture(e.pointerId);
            this.drag = { x: e.offsetX, y: e.offsetY, scroll: this.view.scrollBars, mid: this.view.priceMid, ppp: this.view.pxPerPrice, axis: e.offsetX > this.W - AXIS_W };
        });
        c.addEventListener('pointermove', (e) => {
            this.cross = { x: e.offsetX, y: e.offsetY };
            const d = this.drag;
            if (d) {
                const dx = e.offsetX - d.x, dy = e.offsetY - d.y;
                if (d.axis) {
                    this.autoY = false;
                    this.view.pxPerPrice = d.ppp * Math.exp(-dy * 0.006);
                } else {
                    const n = this.source?.length ?? 0;
                    this.view.scrollBars = Math.max(-5, Math.min(n, d.scroll + dx / this.view.barW));
                    if (!this.autoY || Math.abs(dy) > 6) {
                        this.autoY = false;
                        this.view.priceMid = d.mid + dy / this.view.pxPerPrice;
                    }
                }
            }
            this.requestRender();
        });
        const end = () => { this.drag = null; };
        c.addEventListener('pointerup', end);
        c.addEventListener('pointercancel', end);
        c.addEventListener('pointerleave', () => { this.cross = null; this.requestRender(); });
        c.addEventListener('wheel', (e) => {
            e.preventDefault();
            const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
            if (e.shiftKey || e.offsetX > this.W - AXIS_W) {
                this.autoY = false;
                this.view.pxPerPrice *= f;
            } else {
                this.view.barW = Math.max(4, Math.min(160, this.view.barW * f));
            }
            this.requestRender();
        }, { passive: false });
        c.addEventListener('dblclick', () => this.resetView());
    }
}
