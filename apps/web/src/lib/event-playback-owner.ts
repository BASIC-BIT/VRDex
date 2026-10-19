import type { LineupEvent, LineupSnapshot } from "./event-lineup-runtime";
import { isInScheduledWatchWindow } from "../../../../convex/_eventRuntime";

type EventIdentity = { eventId: string; eventSlug: string; href: string; title: string; startAt: number; doorsOpenAt?: number; endAt?: number };
export type PlaybackRequest = EventIdentity & (
  | { kind: "vrcdn"; sourceId: string; src: string; transport: "mpegts" | "video" }
  | { kind: "twitch"; sourceId: string; channel?: string; video?: string; collection?: string }
  | { kind: "performer_sequence"; event: LineupEvent }
);
export type PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "blocked" | "unavailable";
export type PlaybackSnapshot = { request?: PlaybackRequest; status: PlaybackStatus; volume: number; muted: boolean; lineup?: LineupSnapshot };
export type PlaybackAdapter = {
  play(): Promise<boolean>; pause(): void; setVolume(value: number): void; setMuted(value: boolean): void;
  update(request: PlaybackRequest): void; dispose(): void;
  manual?(key: string): void; live?(): void; retryNextPlayback?(): void;
};
export type AdapterNotify = (state: Partial<Pick<PlaybackSnapshot, "status" | "lineup">>) => void;
export function playbackSourceKey(request: PlaybackRequest): string {
  return JSON.stringify(request.kind === "performer_sequence" ? [request.eventId, request.kind] :
    request.kind === "vrcdn" ? [request.eventId, request.kind, request.sourceId, request.src, request.transport] :
      [request.eventId, request.kind, request.sourceId, request.channel, request.video, request.collection]);
}

/** Owns one foreground transport. Route components supply intent, never media nodes. */
export class EventPlaybackOwner {
  private state: PlaybackSnapshot = { status: "idle", volume: 1, muted: false };
  private listeners = new Set<() => void>();
  private adapter?: PlaybackAdapter;
  private attempt = 0;
  private started = false;
  generation = 0;
  constructor(private create: (request: PlaybackRequest, notify: AdapterNotify) => PlaybackAdapter) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit(patch: Partial<PlaybackSnapshot>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  private release() { this.generation++; this.attempt++; this.started = false; this.adapter?.dispose(); this.adapter = undefined; }
  async play(request: PlaybackRequest) {
    const same = this.state.request && playbackSourceKey(this.state.request) === playbackSourceKey(request);
    if ((!same || !this.started) && !isInScheduledWatchWindow({ ...request, now: Date.now() })) return;
    if (same && this.adapter && ["playing", "loading"].includes(this.state.status)) return;
    if (!same || !this.adapter) {
      this.release();
      const generation = this.generation;
      this.emit({ request, status: "loading", lineup: undefined });
      try {
        this.adapter = this.create(request, patch => { if (generation === this.generation) { if (patch.status === "playing") this.started = true; this.emit(patch); } });
        this.adapter.setVolume(this.state.volume); this.adapter.setMuted(this.state.muted);
      } catch { this.emit({ status: "unavailable" }); return; }
    }
    const attempt = ++this.attempt;
    this.emit({ status: "loading" });
    try {
      const accepted = await this.adapter!.play();
      if (attempt === this.attempt && this.state.status !== "unavailable") { if (accepted) this.started = true; this.emit({ status: accepted ? "playing" : "blocked" }); }
    } catch { if (attempt === this.attempt) this.emit({ status: "unavailable" }); }
  }
  pause() { this.attempt++; this.adapter?.pause(); if (this.state.request) this.emit({ status: "paused" }); }
  setVolume(value: number) { if (!Number.isFinite(value)) return; const volume = Math.max(0, Math.min(1, value)); this.adapter?.setVolume(volume); this.emit({ volume }); }
  setMuted(muted: boolean) { this.adapter?.setMuted(muted); this.emit({ muted }); }
  close() { this.release(); this.emit({ request: undefined, status: "idle", lineup: undefined }); }
  update(request: PlaybackRequest) {
    if (request.eventId !== this.state.request?.eventId) return;
    if (playbackSourceKey(request) !== playbackSourceKey(this.state.request)) {
      this.release(); this.emit({ request, status: "paused", lineup: undefined }); return;
    }
    this.adapter?.update(request); this.emit({ request });
  }
  /** Active-event revalidation tokens must be captured before asynchronous work. */
  revalidate(request: PlaybackRequest | null, generation: number) {
    if (generation !== this.generation) return;
    if (!request || request.eventId !== this.state.request?.eventId) {
      this.release(); this.emit({ status: "unavailable", request: undefined, lineup: undefined });
    } else this.update(request);
  }
  manual(key: string) { this.adapter?.manual?.(key); }
  live() { this.adapter?.live?.(); }
  retryNextPlayback() { this.adapter?.retryNextPlayback?.(); }
}
