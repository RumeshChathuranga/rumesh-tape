/** Midnight Cobalt, shared with v1. */
export const C = {
    bg: '#151924',
    panel: '#0D1017',
    raise: '#1C2130',
    line: '#232938',
    lineStrong: '#313949',
    grid: '#1E2330',
    text: '#E8EDF5',
    textDim: '#B3BDCC',
    muted: '#7B8698',
    faint: '#4A5366',
    accent: '#4C8DFF',
    up: '#10B981',
    down: '#EF4444',
};

export const SANS = "'IBM Plex Sans', system-ui, sans-serif";
export const MONO = "'JetBrains Mono', ui-monospace, monospace";

/** `#RRGGBB` plus alpha as an rgba() string. */
export function rgba(hex: string, a: number): string {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
