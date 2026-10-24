import {
  foregroundPlayback,
  type ForegroundPlayback,
} from "./foreground-playback";
import type { PlaybackAdapter } from "./event-playback-owner";
/** A local handle: deliberately has no EventPlaybackOwner or persistent request. */
export class LocalPreviewPlayer {
  private adapter?: PlaybackAdapter;
  private closed = false;
  constructor(
    private create: () => PlaybackAdapter,
    private stopped: () => void,
    private focus: ForegroundPlayback = foregroundPlayback,
  ) {}
  start() {
    if (this.closed) return false;
    if (this.adapter) return true;
    let adapter: PlaybackAdapter;
    try {
      adapter = this.create();
    } catch {
      this.stopped();
      return false;
    }
    this.adapter = adapter;
    adapter.setMuted(true);
    void adapter.play().catch(() => {
      if (this.adapter === adapter) this.stop();
    });
    return true;
  }
  monitor() {
    if (!this.start()) return false;
    this.focus.acquire(this, () => this.stop());
    this.adapter?.setMuted(false);
    const adapter = this.adapter;
    void adapter?.play().catch(() => {
      if (this.adapter === adapter) this.stop();
    });
    return true;
  }
  stop() {
    const adapter = this.adapter;
    this.adapter = undefined;
    adapter?.setMuted(true);
    adapter?.pause();
    adapter?.dispose();
    this.focus.release(this);
    this.stopped();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.stop();
  }
}
