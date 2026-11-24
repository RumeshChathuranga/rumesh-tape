import { describe, expect, it, vi } from 'vitest';
import { Alerts, defaultNotify, type AlertItem } from '../src/ui/alerts';

const item = (key: string, time = 0): AlertItem => ({ key, time, title: 'Zone reached', body: '15m BISI', kind: 'zone' });

describe('Alerts', () => {
    it('sounds and notifies once per key', () => {
        const sound = vi.fn(), notify = vi.fn(), onChange = vi.fn();
        const a = new Alerts({ sound, notify });
        a.onChange = onChange;
        expect(a.push(item('z1'))).toBe(true);
        expect(a.push(item('z1'))).toBe(false);
        expect(sound).toHaveBeenCalledTimes(1);
        expect(notify).toHaveBeenCalledWith('Zone reached', '15m BISI');
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('keeps the 50 newest, newest first', () => {
        const a = new Alerts({ sound: () => {}, notify: () => {} });
        for (let i = 0; i < 60; i++) a.push(item(`k${i}`, i));
        expect(a.items).toHaveLength(50);
        expect(a.items[0].key).toBe('k59');
    });

    it('does nothing (and does not throw) when notifications are unavailable', () => {
        expect(() => defaultNotify('t', 'b')).not.toThrow();
    });
});
