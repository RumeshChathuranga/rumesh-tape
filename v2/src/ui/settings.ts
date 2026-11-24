import { ROW_MULTS } from '../model/bins';
import { TIMEFRAMES, type Timeframe } from '../model/types';
import type { CellMode } from '../render/chart';

export const SETTINGS_KEY = 'rumeshTape.v2';
export const HISTORY_HOURS = [1, 2, 6, 24, 48] as const;
export type HistoryHours = (typeof HISTORY_HOURS)[number];
const MODES: CellMode[] = ['bidask', 'volume', 'delta'];
export type FvgSetting = 'off' | 'chart' | 'all';
const FVG: FvgSetting[] = ['off', 'chart', 'all'];

export interface Settings {
    symbol: string;
    tf: Timeframe;
    rowMult: number | 'auto';
    mode: CellMode;
    historyHours: HistoryHours;
    showCvd: boolean;
    showBook: boolean;
    bigPrintUsd: number | 'auto';
    fvg: FvgSetting;
    showMitigated: boolean;
    showScalp: boolean;
    showLevels: boolean;
}

export const DEFAULTS: Settings = {
    symbol: 'BTCUSDT',
    tf: '5m',
    rowMult: 'auto',
    mode: 'bidask',
    historyHours: 2,
    showCvd: true,
    showBook: true,
    bigPrintUsd: 'auto',
    fvg: 'all',
    showMitigated: false,
    showScalp: true,
    showLevels: true,
};

const pick = <T>(v: unknown, ok: (v: unknown) => boolean, fallback: T): T => (ok(v) ? (v as T) : fallback);

/** Saved settings merged over the defaults; anything invalid falls back to its default. */
export function loadSettings(storage: Storage): Settings {
    let raw: Record<string, unknown> = {};
    try { raw = JSON.parse(storage.getItem(SETTINGS_KEY) ?? '{}') ?? {}; } catch { raw = {}; }
    const sym = typeof raw.symbol === 'string' && /^[A-Za-z0-9]{2,20}$/.test(raw.symbol) ? raw.symbol.toUpperCase() : DEFAULTS.symbol;
    return {
        symbol: sym,
        tf: pick(raw.tf, (v) => TIMEFRAMES.includes(v as Timeframe), DEFAULTS.tf),
        rowMult: pick(raw.rowMult, (v) => v === 'auto' || ROW_MULTS.includes(v as number), DEFAULTS.rowMult),
        mode: pick(raw.mode, (v) => MODES.includes(v as CellMode), DEFAULTS.mode),
        historyHours: pick(raw.historyHours, (v) => (HISTORY_HOURS as readonly unknown[]).includes(v), DEFAULTS.historyHours),
        showCvd: pick(raw.showCvd, (v) => typeof v === 'boolean', DEFAULTS.showCvd),
        showBook: pick(raw.showBook, (v) => typeof v === 'boolean', DEFAULTS.showBook),
        bigPrintUsd: pick(raw.bigPrintUsd, (v) => v === 'auto' || (typeof v === 'number' && v > 0 && Number.isFinite(v)), DEFAULTS.bigPrintUsd),
        fvg: pick(raw.fvg, (v) => FVG.includes(v as FvgSetting), DEFAULTS.fvg),
        showMitigated: pick(raw.showMitigated, (v) => typeof v === 'boolean', DEFAULTS.showMitigated),
        showScalp: pick(raw.showScalp, (v) => typeof v === 'boolean', DEFAULTS.showScalp),
        showLevels: pick(raw.showLevels, (v) => typeof v === 'boolean', DEFAULTS.showLevels),
    };
}

export function saveSettings(s: Settings, storage: Storage): void {
    try { storage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* storage full or blocked */ }
}
