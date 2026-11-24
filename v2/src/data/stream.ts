/**
 * One Binance combined-stream WebSocket. Reconnects after an unexpected
 * close; after `close()` it is silent for good.
 */
export class MarketStream {
    onOpen?: () => void;
    private ws: WebSocket | null = null;
    private closed = true;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        readonly url: string,
        private readonly onMessage: (msg: { stream: string; data: any }) => void,
        private readonly o: { WebSocketImpl?: typeof WebSocket; reconnectMs?: number } = {},
    ) {}

    open(): void {
        this.closed = false;
        this.connect();
    }

    close(): void {
        this.closed = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        const ws = this.ws;
        this.ws = null;
        if (ws) {
            ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
            try { ws.close(); } catch { /* already closed */ }
        }
    }

    private connect() {
        const Impl = this.o.WebSocketImpl ?? WebSocket;
        const ws = new Impl(this.url);
        this.ws = ws;
        ws.onopen = () => this.onOpen?.();
        ws.onmessage = (e: MessageEvent) => {
            if (this.closed) return;
            try { this.onMessage(JSON.parse(e.data)); } catch (err) { console.error('stream message', err); }
        };
        ws.onclose = () => {
            if (this.closed || this.ws !== ws) return;
            this.timer = setTimeout(() => this.connect(), this.o.reconnectMs ?? 3000);
        };
        ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
    }
}
