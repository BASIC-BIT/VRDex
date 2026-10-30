import type { DjMetadata } from "@vrdex/media-relay";
import { foregroundPlayback } from "./foreground-playback";
import type { LineupEvent, LineupSnapshot } from "./event-lineup-runtime";
import { isInScheduledWatchWindow } from "../../../../convex/_eventRuntime";

import {
  readPlaybackMode,
  writePlaybackMode,
  playbackModeStorage,
  type PlaybackMode,
} from "./playback-mode";

type EventIdentity = {
  eventId: string;
  eventSlug: string;
  href: string;
  title: string;
  startAt: number;
  doorsOpenAt?: number;
  endAt?: number;
};
type ProfileIdentity = {
  profileId: string;
  profileSlug: string;
  eventId?: never;
  eventSlug?: never;
  startAt?: never;
  href: string;
  title: string;
};
type VrcdnRequest = {
  kind: "vrcdn";
  sourceId: string;
  src: string;
  transport: "mpegts" | "video";
};
export type PlaybackRequest =
  | (ProfileIdentity & VrcdnRequest)
  | (EventIdentity &
      (
        | {
            kind: "vrcdn";
            sourceId: string;
            src: string;
            transport: "mpegts" | "video";
          }
        | {
            kind: "twitch";
            sourceId: string;
            channel?: string;
            video?: string;
            collection?: string;
          }
        | { kind: "performer_sequence"; event: LineupEvent }
      ));
export type PlaybackStatus =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "blocked"
  | "unavailable";
export type PlaybackSnapshot = {
  request?: PlaybackRequest;
  status: PlaybackStatus;
  unavailableReason?: "unsupported" | "ended";
  mode: PlaybackMode;
  volume: number;
  muted: boolean;
  lineup?: LineupSnapshot;
  metadata?: DjMetadata;
};
export type PlaybackAdapter = {
  play(): Promise<boolean>;
  pause(): void;
  setVolume(value: number): void;
  setMuted(value: boolean): void;
  update(request: PlaybackRequest): void;
  dispose(): void;
  readonly media?: HTMLMediaElement;
  refresh?(): Promise<void>;
  retry?(): Promise<boolean>;
  setMode?(mode: PlaybackMode): Promise<boolean>;
  setMetadata?(metadata: DjMetadata): void;
  manual?(key: string): void;
  live?(): void;
  retryNextPlayback?(): void;
};
export type AdapterNotify = (
  state: Partial<
    Pick<PlaybackSnapshot, "status" | "lineup" | "unavailableReason" | "metadata">
  >,
) => void;
export function playbackContextKey(request: PlaybackRequest): string {
  return "profileId" in request
    ? `profile:${request.profileId}`
    : `event:${request.eventId}`;
}
export function playbackSourceKey(request: PlaybackRequest): string {
  return JSON.stringify(
    request.kind === "performer_sequence"
      ? [playbackContextKey(request), request.kind]
      : request.kind === "vrcdn"
        ? [
            playbackContextKey(request),
            request.kind,
            request.sourceId,
            request.src,
            request.transport,
          ]
        : [
            playbackContextKey(request),
            request.kind,
            request.sourceId,
            request.channel,
            request.video,
            request.collection,
          ],
  );
}

/** Owns one foreground transport. Route components supply intent, never media nodes. */
export class EventPlaybackOwner {
  private state: PlaybackSnapshot = {
    status: "idle",
    mode: readPlaybackMode(playbackModeStorage()),
    volume: 1,
    muted: false,
  };
  private listeners = new Set<() => void>();
  private adapter?: PlaybackAdapter;
  private attempt = 0;
  private started = false;
  private unavailable = false;
  generation = 0;
  constructor(
    private create: (
      request: PlaybackRequest,
      notify: AdapterNotify,
      mode: PlaybackMode,
    ) => PlaybackAdapter,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit(patch: Partial<PlaybackSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private release() {
    this.generation++;
    this.attempt++;
    this.started = false;
    this.unavailable = false;
    this.adapter?.dispose();
    this.adapter = undefined;
  }
  async play(request: PlaybackRequest) {
    const same =
      this.state.request &&
      playbackSourceKey(this.state.request) === playbackSourceKey(request);
    if (
      (!same || !this.started) &&
      !("profileId" in request) &&
      !isInScheduledWatchWindow({ ...request, now: Date.now() })
    )
      return;
    foregroundPlayback.acquire(this, () => this.pause());
    if (
      same &&
      this.adapter &&
      ["playing", "loading"].includes(this.state.status)
    )
      return;
    if (!same || !this.adapter || (this.unavailable && !this.adapter.retry)) {
      const continuing = same && this.started;
      this.release();
      this.started = Boolean(continuing);
      const generation = this.generation;
      this.emit({
        request,
        status: "loading",
        lineup: undefined,
        metadata: undefined,
        unavailableReason: undefined,
      });
      try {
        this.adapter = this.create(
          request,
          (patch) => {
            if (generation !== this.generation) return;
            if (patch.status === "unavailable") this.unavailable = true;
            if (patch.status === "playing") {
              this.unavailable = false;
              // Browser/native controls can resume without calling owner.play().
              foregroundPlayback.acquire(this, () => this.pause());
              this.started = true;
            }
            this.emit(patch);
          },
          this.state.mode,
        );
        this.adapter.setVolume(this.state.volume);
        this.adapter.setMuted(this.state.muted);
      } catch {
        this.unavailable = true;
        this.emit({ status: "unavailable" });
        return;
      }
    }
    const attempt = ++this.attempt;
    this.emit({ status: "loading", unavailableReason: undefined });
    try {
      const accepted = await (this.unavailable && this.adapter!.retry
        ? this.adapter!.retry()
        : this.adapter!.play());
      if (attempt === this.attempt && this.state.status === "loading") {
        if (accepted) {
          this.started = true;
          this.unavailable = false;
        }
        this.emit({ status: accepted ? "playing" : "blocked" });
      }
    } catch {
      if (attempt === this.attempt && this.state.status === "loading") {
        this.unavailable = true;
        this.emit({ status: "unavailable" });
      }
    }
  }
  pause() {
    foregroundPlayback.release(this);
    this.attempt++;
    this.adapter?.pause();
    if (this.state.request) this.emit({ status: "paused" });
  }
  async setMode(mode: PlaybackMode) {
    writePlaybackMode(playbackModeStorage(), mode);
    if (mode === this.state.mode) return;
    this.emit({ mode });
    const attempt = ++this.attempt;
    if (!this.adapter?.setMode) {
      if (this.adapter) {
        this.suspend();
        this.emit({ status: mode === "audio" ? "blocked" : "paused" });
      }
      return;
    }
    const playing =
      this.state.status === "playing" || this.state.status === "loading";
    try {
      const accepted = await this.adapter.setMode(mode);
      if (attempt === this.attempt && playing)
        this.emit({ status: accepted ? "playing" : "blocked" });
    } catch {
      if (attempt === this.attempt) this.emit({ status: "blocked" });
    }
  }
  setVolume(value: number) {
    if (!Number.isFinite(value)) return;
    const volume = Math.max(0, Math.min(1, value));
    this.adapter?.setVolume(volume);
    this.emit({ volume });
  }
  setMuted(muted: boolean) {
    this.adapter?.setMuted(muted);
    this.emit({ muted });
  }
  /** Release an embed that can no longer be presented, retaining its explicit retry/link. */
  suspend() {
    foregroundPlayback.release(this);
    const started = this.started;
    this.release();
    this.started = started;
    this.emit({ status: "paused", lineup: undefined });
  }
  close() {
    foregroundPlayback.release(this);
    this.release();
    this.emit({ request: undefined, status: "idle", lineup: undefined, metadata: undefined });
  }
  update(request: PlaybackRequest) {
    if (
      !this.state.request ||
      playbackContextKey(request) !== playbackContextKey(this.state.request)
    )
      return;
    if (playbackSourceKey(request) !== playbackSourceKey(this.state.request)) {
      this.release();
      this.emit({ request, status: "paused", lineup: undefined, metadata: undefined });
      return;
    }
    this.adapter?.update(request);
    this.emit({ request });
  }
  /** Active-event revalidation tokens must be captured before asynchronous work. */
  revalidate(request: PlaybackRequest | null, generation: number) {
    if (generation !== this.generation) return;
    if (
      !request ||
      !this.state.request ||
      playbackContextKey(request) !== playbackContextKey(this.state.request)
    ) {
      this.release();
      this.emit({
        status: "unavailable",
        request: undefined,
        lineup: undefined,
        metadata: undefined,
      });
    } else this.update(request);
  }
  get media() { return this.adapter?.media; }
  async refresh() {
    await this.adapter?.refresh?.();
  }
  manual(key: string) {
    this.adapter?.manual?.(key);
  }
  live() {
    this.adapter?.live?.();
  }
  retryNextPlayback() {
    this.adapter?.retryNextPlayback?.();
  }
}
