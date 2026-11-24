import { describe, expect, it } from 'vitest';
import { DEFAULTS, loadSettings, saveSettings } from '../src/ui/settings';

function memoryStorage(init: Record<string, string> = {}): Storage {
    const m = new Map(Object.entries(init));
    return {
        get length() { return m.size; },
        clear: () => m.clear(),
        getItem: (k) => m.get(k) ?? null,
        key: (i) => [...m.keys()][i] ?? null,
        removeItem: (k) => { m.delete(k); },
        setItem: (k, v) => { m.set(k, String(v)); },
    };
}

describe('settings', () => {
    it('starts from the defaults', () => {
        expect(loadSettings(memoryStorage())).toEqual(DEFAULTS);
    });

    it('drops invalid values and keeps valid ones', () => {
        const s = loadSettings(memoryStorage({ 'rumeshTape.v2': JSON.stringify({ tf: '2h', historyHours: 3, mode: 'x', symbol: 'ethusdt', showCvd: false }) }));
        expect(s).toMatchObject({ tf: '5m', historyHours: 2, mode: 'bidask', symbol: 'ETHUSDT', showCvd: false });
    });

    it('survives broken JSON', () => {
        expect(loadSettings(memoryStorage({ 'rumeshTape.v2': '{nope' }))).toEqual(DEFAULTS);
    });

    it('round-trips through storage', () => {
        const st = memoryStorage();
        const s = { ...DEFAULTS, tf: '30m' as const, rowMult: 5, bigPrintUsd: 'auto' as const };
        saveSettings(s, st);
        expect(loadSettings(st)).toEqual(s);
    });

    it('keeps fair value gap settings and defaults to all timeframes', () => {
        expect(DEFAULTS).toMatchObject({ fvg: 'all', showMitigated: false });
        const ok = loadSettings(memoryStorage({ 'rumeshTape.v2': JSON.stringify({ fvg: 'chart', showMitigated: true }) }));
        expect(ok).toMatchObject({ fvg: 'chart', showMitigated: true });
        const bad = loadSettings(memoryStorage({ 'rumeshTape.v2': JSON.stringify({ fvg: 'x', showMitigated: 'yes' }) }));
        expect(bad).toMatchObject({ fvg: 'all', showMitigated: false });
    });
});
