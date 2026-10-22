/** Synchronous handoff before audible Play. A stopped participant cannot release its successor. */
export class ForegroundPlayback {
  private current?: { identity: object; stop: () => void };
  acquire(identity: object, stop: () => void) {
    if (this.current?.identity === identity) return;
    const previous = this.current;
    this.current = { identity, stop };
    previous?.stop();
  }
  release(identity: object) { if (this.current?.identity === identity) this.current = undefined; }
}
export const foregroundPlayback = new ForegroundPlayback();
