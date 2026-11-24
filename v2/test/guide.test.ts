import { describe, expect, it } from 'vitest';
import { guideSteps } from '../src/ui/guide';

const utc = (t: number) => new Date(t).toISOString().slice(11, 16);

describe('guideSteps', () => {
    const steps = guideSteps(Date.UTC(2026, 10, 24, 12, 0), utc);

    it('gives six short steps', () => {
        expect(steps.map((s) => s.title)).toEqual([
            'Get ready', 'Check the bias', 'Wait for a zone', 'Wait for the setup', 'Place the trade', 'After the trade',
        ]);
        for (const s of steps) expect(s.lines.length).toBeLessThanOrEqual(3);
    });

    it('uses the real window times: open the tool 30 minutes early', () => {
        expect(steps[0].lines[0]).toBe('Open the tool at 13:45. The window is 14:15–15:45.');
    });

    it('moves with US daylight saving', () => {
        expect(guideSteps(Date.UTC(2026, 6, 15, 12, 0), utc)[0].lines[0]).toBe('Open the tool at 12:45. The window is 13:15–14:45.');
    });

    it('keeps the strategy numbers', () => {
        const text = steps.flatMap((s) => s.lines).join(' ');
        for (const s of ['3 trades', '2 losses', 'Stop too wide', 'limit order']) expect(text).toContain(s);
    });
});
