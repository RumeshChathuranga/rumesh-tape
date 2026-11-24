export interface AlertItem {
    key: string;
    time: number;
    title: string;
    body: string;
    kind: 'zone' | 'setup';
}

const MAX_ITEMS = 50;
let audio: AudioContext | null = null;

/** Two short rising tones. Silent when the browser has no Web Audio. */
export function defaultSound(): void {
    try {
        const Ctx = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
        if (!Ctx) return;
        audio ??= new Ctx();
        const t0 = audio.currentTime;
        [660, 880].forEach((f, i) => {
            const o = audio!.createOscillator(), g = audio!.createGain();
            o.type = 'sine';
            o.frequency.value = f;
            g.gain.setValueAtTime(0.18, t0 + i * 0.16);
            g.gain.exponentialRampToValueAtTime(0.001, t0 + i * 0.16 + 0.14);
            o.connect(g).connect(audio!.destination);
            o.start(t0 + i * 0.16);
            o.stop(t0 + i * 0.16 + 0.15);
        });
    } catch { /* audio blocked */ }
}

/** Browser notification, only when the user has allowed them. */
export function defaultNotify(title: string, body: string): void {
    try {
        const N = (globalThis as { Notification?: typeof Notification }).Notification;
        if (N && N.permission === 'granted') new N(title, { body, tag: title + body });
    } catch { /* not supported */ }
}

/** Must be called from a click: browsers only ask in response to the user. */
export async function requestNotifyPermission(): Promise<void> {
    const N = (globalThis as { Notification?: typeof Notification }).Notification;
    if (N && N.permission === 'default') await N.requestPermission();
}

/** Zone and setup alerts: each key fires once (sound, notification, list). */
export class Alerts {
    items: AlertItem[] = [];
    onChange?: () => void;
    private seen = new Set<string>();
    private readonly sound: () => void;
    private readonly notify: (title: string, body: string) => void;

    constructor(o: { sound?: () => void; notify?: (title: string, body: string) => void } = {}) {
        this.sound = o.sound ?? defaultSound;
        this.notify = o.notify ?? defaultNotify;
    }

    push(a: AlertItem): boolean {
        if (this.seen.has(a.key)) return false;
        this.seen.add(a.key);
        this.items = [a, ...this.items].slice(0, MAX_ITEMS);
        this.sound();
        this.notify(a.title, a.body);
        this.onChange?.();
        return true;
    }
}
