/** Collapses any number of render requests into a single animation frame. */
export class FrameScheduler {
    private pending = false;

    constructor(
        private readonly fn: () => void,
        private readonly raf: (cb: FrameRequestCallback) => number = (cb) => requestAnimationFrame(cb),
    ) {}

    request(): void {
        if (this.pending) return;
        this.pending = true;
        this.raf(() => {
            this.pending = false;
            this.fn();
        });
    }
}
