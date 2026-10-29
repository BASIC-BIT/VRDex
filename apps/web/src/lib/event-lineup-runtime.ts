import type { PlaybackMode, DjMetadata } from "@vrdex/media-relay";
import type { AudioObservationSample } from "./event-audio-observation";
import { createObservedVrcdnSource, type ObservedVrcdnSource } from "./vrcdn-observed-source";
import { clearPlaybackEvidence, observeAudio } from "./event-audio-observation";
import { joinSlot, handoffEligibleAt, handoffBoundaryAt, shouldHandoff } from "./event-playback";
import { followingSlot, nextSlot, reconcileSlot, sameLineupSource, type LineupSlot } from "./event-lineup-session";

export type LineupEvent = { title: string; startAt: number; doorsOpenAt?: number; endAt?: number; slots: LineupSlot[] };
export type LineupSnapshot = { started: boolean; following: boolean; paused: boolean; muted: boolean; volume: number; current?: string; connected: boolean; unavailable: boolean; nextPlaybackBlocked?: boolean; playbackBlocked?: boolean };
export type LineupObservedSource = {
  readonly media: HTMLMediaElement;
  readonly grantId?: string;
  readonly metadata?: DjMetadata;
  play(): Promise<boolean>; pause(): void; release(): void;
  setMuted(value: boolean): void; setVolume(value: number): void;
  ready(): boolean; sample(at: number, paused: boolean): AudioObservationSample;
  setMode?(mode: PlaybackMode): Promise<boolean>;
  recover?(explicit: boolean): Promise<boolean>;
  rebind?(slot: LineupSlot): Promise<boolean>;
  refresh?(): Promise<void>;
};
export type NativeLineupOptions = {
  create(slot: LineupSlot, prepared: boolean, isCurrent: () => boolean, continuationGrantId?: string): Promise<LineupObservedSource>;
  onCurrent(source: LineupObservedSource, slot: LineupSlot): void;
};
type Connection = { slot: LineupSlot; source: LineupObservedSource; evidence: ReturnType<typeof clearPlaybackEvidence>; startupDeadline: number; progressed: boolean };
// Cold MSE/audio initialization can exceed the established-source failure window.
// Bound initialization separately; readiness and handoff still require decoded progress.
const STARTUP_ALLOWANCE_MS = 5000;
const failedConnection = (connection: Connection, at: number) =>
  connection.evidence.failureSince !== undefined && at - connection.evidence.failureSince >= 1000 &&
  (connection.progressed || at >= connection.startupDeadline);
const backoff = [1000, 2000, 4000, 10000];

/** One mounted event session owns every media node, request generation and retry deadline. */
export class EventLineupSession {
  state: LineupSnapshot = { started: false, following: true, paused: true, muted: false, volume: 1, connected: false, unavailable: false };
  private rebinding = false;
  private queuedRebind?: { target: LineupSlot; request: number };
  private promoting?: Connection;
  private mode: PlaybackMode = "video";
  private context?: AudioContext;
  private viewer?: GainNode;
  private current?: Connection;
  private next?: Connection;
  private currentGeneration = 0;
  private nextGeneration = 0;
  private currentPending = false;
  private nextPending = false;
  private nextPlayPending = false;
  private nextPlayAttempt = 0;
  private currentRetryAt = 0;
  private nextRetryAt = 0;
  private currentAttempt = 0;
  private nextAttempt = 0;
  private selected?: LineupSlot;
  private disposed = false;
  private playRequest = 0;
  private lastSnapshot?: LineupSnapshot;
  private timer: ReturnType<typeof setInterval>;
  constructor(private event: LineupEvent, private mount: HTMLElement, private notify: (state: LineupSnapshot) => void,
    private createSource = createObservedVrcdnSource, private native?: NativeLineupOptions) {
    this.timer = setInterval(() => this.tick(), 100);
    document.addEventListener("visibilitychange", this.resetEvidence);
  }
  private emit() {
    if (this.disposed) return;
    const previous = this.lastSnapshot;
    if (previous && (Object.keys(this.state) as Array<keyof LineupSnapshot>).every(key => this.state[key] === previous[key])) return;
    this.lastSnapshot = { ...this.state };
    this.notify(this.lastSnapshot);
  }
  private resetEvidence = () => {
    for (const connection of [this.current, this.next]) if (connection) connection.evidence = clearPlaybackEvidence(performance.now());
  };
  private releaseNext() {
    const released = !!this.next;
    this.state.nextPlaybackBlocked = false; this.nextPlayPending = false;
    this.promoting = undefined;
    if (this.native) { this.next?.source.setMuted(true); this.current?.source.setMuted(this.state.muted); }
    this.nextGeneration++; this.nextPending = false; this.next?.source.release(); this.next = undefined;
    this.nextAttempt = 0;
    this.nextRetryAt = released ? performance.now() + backoff[0] : 0;
  }
  private releaseCurrent() {
    this.currentGeneration++; this.currentPending = false; this.current?.source.release(); this.current = undefined;
    this.currentAttempt = 0; this.currentRetryAt = 0;
  }
  private scheduleSlot() {
    if (this.event.endAt !== undefined && Date.now() >= this.event.endAt) return undefined;
    return joinSlot(this.event.slots, Date.now()) as LineupSlot | undefined;
  }
  update(event: LineupEvent) {
    this.event = event;
    // Every projection invalidates any prepared connection and its asynchronous callbacks.
    this.releaseNext();
    if (this.selected) {
      const match = reconcileSlot(this.selected, event.slots);
      if (!match) {
        this.playRequest++;
        this.releaseCurrent(); this.selected = undefined;
        this.state.current = undefined; this.state.connected = false; this.state.unavailable = true;
        // A revoked source needs explicit viewer action, never an automatic substitute.
        this.state.paused = true;
      } else {
        if (this.native && this.current && match.key !== this.current.slot.key) { void this.rebindCurrent(match); this.resetEvidence(); this.emit(); return; }
        this.selected = match;
        if (this.current) this.current.slot = match;
        this.state.current = match.key;
      }
    }
    this.resetEvidence(); this.emit();
  }
  private select(slot: LineupSlot | undefined) {
    this.releaseNext();
    if (slot?.stream && this.current && sameLineupSource(this.current.slot, slot)) {
      if (this.native && (this.rebinding || slot.key !== this.current.slot.key)) { void this.rebindCurrent(slot); return; }
      this.current.slot = slot; this.selected = slot; this.state.current = slot.key; this.resetEvidence();
      return;
    }
    this.releaseCurrent(); this.selected = slot;
    this.state.current = slot?.key; this.state.connected = false; this.state.unavailable = !slot?.stream;
  }
  async play() {
    if (this.disposed) return;
    const request = ++this.playRequest;
    if (!this.state.started && this.event.endAt !== undefined && Date.now() >= this.event.endAt) return;
    if (!this.native && !this.context) {
      this.context = new AudioContext(); this.viewer = this.context.createGain(); this.viewer.connect(this.context.destination); this.setGain();
      this.context.addEventListener("statechange", this.resetEvidence);
    }
    try { await this.context?.resume(); } catch {
      if (!this.disposed && request === this.playRequest) { this.state.paused = true; this.emit(); }
      return;
    }
    if (this.disposed || request !== this.playRequest) return;
    this.state.started = true; this.state.paused = false; this.state.playbackBlocked = false;
    if (this.state.following) {
      const scheduled = this.scheduleSlot();
      // Reconciled selection survives transport recovery and overtime pause/resume.
      const overtime = this.event.endAt !== undefined && Date.now() >= this.event.endAt && this.selected !== undefined && this.selected.key === this.event.slots.at(-1)?.key;
      if (!overtime && (!this.native || !this.selected)) this.select(scheduled);
    }
    this.resetEvidence();
    const active = this.current;
    if (active) void (this.native && this.state.unavailable && active.source.recover ? active.source.recover(true) : active.source.play()).catch(() => false).then(accepted => {
      if (this.disposed || request !== this.playRequest || active !== this.current) return;
      if (!accepted) { this.state.paused = true; this.state.playbackBlocked = true; this.releaseNext(); this.emit(); }
    });
    this.tick(); this.emit();
  }
  retryNextPlayback() {
    if (this.native && this.next && this.state.nextPlaybackBlocked) { void this.promoteNative(this.next, true); return; }
    const connection = this.next;
    if (this.disposed || this.state.paused || !this.state.nextPlaybackBlocked || !connection) return;
    // Recheck expiry and projection ownership before accepting the viewer gesture.
    const candidate = this.selected && nextSlot(this.selected, this.event.slots, Date.now());
    if (!this.state.following || candidate?.key !== connection.slot.key) { this.releaseNext(); this.emit(); return; }
    const generation = this.nextGeneration;
    const request = this.playRequest;
    // A fresh gesture supersedes an unresolved play on the same retained source.
    const attempt = ++this.nextPlayAttempt;
    this.nextPlayPending = true;
    void connection.source.play().catch(() => false).then(accepted => {
      if (this.disposed || attempt !== this.nextPlayAttempt || generation !== this.nextGeneration || request !== this.playRequest || connection !== this.next) return;
      this.nextPlayPending = false;
      this.state.nextPlaybackBlocked = !accepted;
      connection.evidence = clearPlaybackEvidence(performance.now());
      this.nextRetryAt = performance.now() + backoff[0];
      this.emit();
    });
  }
  pause() {
    this.playRequest++;
    if (this.currentPending && !this.current) { this.currentGeneration++; this.currentPending = false; }
    this.state.paused = true; this.current?.source.pause(); this.releaseNext(); this.resetEvidence(); this.emit();
  }
  manual(key: string) {
    this.playRequest++;
    this.state.following = false;
    this.select(this.event.slots.find(slot => slot.key === key));
    if (this.state.started && !this.state.paused) this.tick();
    this.emit();
  }
  live() { this.state.following = true; this.select(this.scheduleSlot()); if (this.state.started) void this.play(); this.emit(); }
  setVolume(value: number) { this.state.volume = value; this.setGain(); }
  setMuted(value: boolean) { this.state.muted = value; this.setGain(); }
  volume(value: number) { this.state.volume = value; this.state.muted = value === 0; this.setGain(); }
  mute() { if (this.state.muted && this.state.volume === 0) this.state.volume = 1; this.state.muted = !this.state.muted; this.setGain(); }
  private setGain() {
    if (this.viewer) this.viewer.gain.value = this.state.muted ? 0 : this.state.volume;
    if (this.native) {
      this.current?.source.setVolume(this.state.volume); this.current?.source.setMuted(this.promoting ? true : this.state.muted);
      this.next?.source.setVolume(this.state.volume); this.next?.source.setMuted(this.promoting ? this.state.muted : true);
    }
    this.emit();
  }
  nativePlayback(paused: boolean, media: HTMLMediaElement) {
    if (this.disposed || this.current?.source.media !== media) return;
    if (paused) this.pause();
    else { this.state.paused = false; this.state.playbackBlocked = false; this.resetEvidence(); this.emit(); }
  }
  get media() { return this.current?.source.media; }
  async refresh() { await this.current?.source.refresh?.(); }
  async setMode(mode: PlaybackMode) {
    this.mode = mode; this.playRequest++; this.releaseNext(); this.resetEvidence();
    return await this.current?.source.setMode?.(mode) ?? true;
  }
  private async rebindCurrent(target: LineupSlot) {
    const active = this.current, request = this.playRequest;
    if (!active || !this.native) return;
    if (this.rebinding) { this.queuedRebind = { target, request }; return; }
    this.rebinding = true;
    try {
      const accepted = await active.source.rebind?.(target);
      if (this.disposed || active !== this.current || request !== this.playRequest || document.visibilityState !== "visible") return;
      if (accepted) { active.slot = target; this.selected = target; this.state.current = target.key; this.native.onCurrent(active.source, target); }
      else { this.state.unavailable = true; this.pause(); }
      this.emit();
    } catch { if (!this.disposed && active === this.current && request === this.playRequest) { this.state.unavailable = true; this.pause(); } }
    finally {
      this.rebinding = false;
      const queued = this.queuedRebind; this.queuedRebind = undefined;
      if (queued && !this.disposed && queued.request === this.playRequest) void this.rebindCurrent(queued.target);
    }
  }
  private async promoteNative(connection: Connection, gesture = false) {
    if (this.disposed || this.state.paused || document.visibilityState !== "visible" || !this.state.following || this.next !== connection || (this.nextPlayPending && !gesture)) return;
    const candidate = this.selected && nextSlot(this.selected, this.event.slots, Date.now());
    if (candidate?.key !== connection.slot.key) return;
    const generation = this.nextGeneration, request = this.playRequest, attempt = ++this.nextPlayAttempt;
    const active = this.current;
    this.nextPlayPending = true;
    if (gesture && (!active || !shouldHandoff({ scheduleNow: Date.now(), observationNow: performance.now(), eligibleAt: handoffBoundaryAt(active.slot, connection.slot), following: true, paused: false, nextReady: true, evidence: active.evidence }))) {
      connection.source.setMuted(true);
      const accepted = await connection.source.play().catch(() => false);
      if (!this.disposed && attempt === this.nextPlayAttempt && generation === this.nextGeneration && request === this.playRequest && connection === this.next) {
        this.nextPlayPending = false; this.state.nextPlaybackBlocked = !accepted;
        connection.evidence = clearPlaybackEvidence(performance.now()); this.emit();
      }
      return;
    }
    this.promoting = connection;
    // Stop the old audible owner before unmuting. A rejection keeps next muted and explicit retry available.
    active?.source.setMuted(true);
    connection.source.setMuted(this.state.muted);
    const accepted = await connection.source.play().catch(() => false);
    if (attempt !== this.nextPlayAttempt) return;
    if (this.disposed || generation !== this.nextGeneration || request !== this.playRequest || connection !== this.next || document.visibilityState !== "visible") {
      if (connection !== this.current) connection.source.setMuted(true); if (active === this.current) active?.source.setMuted(this.state.muted);
      this.promoting = undefined; return;
    }
    this.nextPlayPending = false; this.promoting = undefined;
    if (!accepted) {
      connection.source.setMuted(true); active?.source.setMuted(this.state.muted);
      this.state.nextPlaybackBlocked = true; this.emit(); return;
    }
    const stillCandidate = this.selected && nextSlot(this.selected, this.event.slots, Date.now());
    if (!active || stillCandidate?.key !== connection.slot.key || !shouldHandoff({ scheduleNow: Date.now(), observationNow: performance.now(), eligibleAt: handoffBoundaryAt(active.slot, connection.slot), following: this.state.following, paused: this.state.paused, nextReady: connection.source.ready(), evidence: active.evidence })) {
      connection.source.setMuted(true); active?.source.setMuted(this.state.muted);
      this.state.nextPlaybackBlocked = false; this.emit(); return;
    }
    this.releaseCurrent(); this.current = connection; this.next = undefined; this.nextGeneration++;
    this.nextAttempt = 0; this.nextRetryAt = 0; this.state.nextPlaybackBlocked = false;
    this.selected = connection.slot; this.state.current = connection.slot.key;
    connection.source.setMuted(this.state.muted);
    connection.source.media.hidden = this.mode === "audio";
    this.native?.onCurrent(connection.source, connection.slot);
    this.resetEvidence(); this.emit();
  }
  private async connect(slot: LineupSlot, prepared: boolean) {
    if (!slot.stream || (!this.native && (!this.context || !this.viewer)) || this.disposed) return;
    if (prepared) this.nextPending = true; else this.currentPending = true;
    const token = prepared ? ++this.nextGeneration : ++this.currentGeneration;
    const context = this.context;
    const request = this.playRequest;
    try {
      const isCurrent = () => !this.disposed && token === (prepared ? this.nextGeneration : this.currentGeneration);
      let source: LineupObservedSource;
      if (this.native) source = await this.native.create(slot, prepared, isCurrent, this.current?.source.grantId);
      else {
        if (!context || !this.viewer) throw Error("Playback context unavailable");
        const legacy: ObservedVrcdnSource = await this.createSource(context, this.viewer, slot.stream.questUrl, isCurrent);
        source = { ...legacy, media: legacy.video, setMuted(value) { legacy.gain.gain.value = value ? 0 : 1; }, setVolume() {} };
      }
      if (this.native) await source.setMode?.(this.mode);
      if (this.disposed || token !== (prepared ? this.nextGeneration : this.currentGeneration) || (prepared && (document.visibilityState !== "visible" || this.state.paused || request !== this.playRequest))) { source.release(); return; }
      const acceptedSlot = prepared ? slot : reconcileSlot(slot, this.event.slots);
      if (!acceptedSlot || (!prepared && acceptedSlot.key !== this.selected?.key)) { source.release(); return; }
      const connection = { slot: acceptedSlot, source, evidence: clearPlaybackEvidence(performance.now()), startupDeadline: performance.now() + STARTUP_ALLOWANCE_MS, progressed: false };
      if (prepared) { this.next = connection; source.media.hidden = true; source.setMuted(true); }
      else { this.current = connection; source.setMuted(this.native ? this.state.muted : false); this.native?.onCurrent(source, acceptedSlot); }
      source.setVolume(this.state.volume);
      if (!this.native) this.mount.append(source.media);
      void source.play().catch(() => false).then(accepted => {
        if (this.disposed || request !== this.playRequest || token !== (prepared ? this.nextGeneration : this.currentGeneration)) return;
        if (prepared) this.state.nextPlaybackBlocked = !accepted;
        if (!accepted && !prepared) { this.state.playbackBlocked = true; this.state.paused = true; this.state.unavailable = false; this.releaseNext(); }
        this.emit();
      });
    } catch {
      if (token !== (prepared ? this.nextGeneration : this.currentGeneration)) return;
      if (!prepared) this.state.unavailable = true;
    } finally {
      if (token === (prepared ? this.nextGeneration : this.currentGeneration)) {
        const at = performance.now();
        if (prepared) { this.nextPending = false; this.nextRetryAt = at + backoff[Math.min(this.nextAttempt++, 3)]; }
        else { this.currentPending = false; this.currentRetryAt = at + backoff[Math.min(this.currentAttempt++, 3)]; }
      }
    }
  }
  private tick() {
    if (this.disposed || !this.state.started || this.state.paused) return;
    const at = performance.now();
    const visible = document.visibilityState === "visible";
    if (!this.selected && this.state.following) this.select(this.scheduleSlot());
    const scheduleNow = Date.now();
    if (visible && this.state.following && this.current) {
      // Identity can advance without stopping or duplicating an unchanged stream.
      // Inspect expired rows too, but never traverse a different or missing source.
      let successor = this.selected && followingSlot(this.selected, this.event.slots);
      while (successor?.stream && sameLineupSource(successor, this.current.slot) &&
        scheduleNow >= Math.max(this.selected!.endAt ?? successor.startAt, successor.startAt)) {
        if (this.native) {
          if (!this.rebinding) void this.rebindCurrent(successor);
          break;
        }
        this.select(successor);
        successor = followingSlot(successor, this.event.slots);
      }
    }
    const active = this.current;
    const candidate = this.selected && this.state.following ? nextSlot(this.selected, this.event.slots, scheduleNow) : undefined;
    const eligibleAt = this.selected && candidate ? handoffEligibleAt(this.selected, candidate) : Infinity;
    const eligible = visible && (!this.native || !!this.current) && scheduleNow >= eligibleAt && !!candidate?.stream && (!this.selected || !sameLineupSource(candidate, this.selected));
    if (!eligible && (this.next || this.nextPending)) this.releaseNext();
    for (const connection of [active, this.next]) {
      if (!connection) continue;
      connection.evidence = observeAudio(connection.evidence, connection.source.sample(at, this.state.paused));
      connection.progressed ||= connection.evidence.progressing;
    }
    if (active) {
      this.state.connected = active.evidence.progressing;
      if (active.evidence.progressing) this.state.unavailable = false;
      else if (failedConnection(active, at)) this.state.unavailable = true;
      // Silence handoff stays disabled until representative musical calibration.
      if (this.next && (active.progressed || at >= active.startupDeadline) && !this.state.nextPlaybackBlocked && !this.nextPlayPending && shouldHandoff({ scheduleNow, observationNow: at,
        eligibleAt: handoffBoundaryAt(active.slot, this.next.slot),
        following: this.state.following, paused: this.state.paused, nextReady: this.next.source.ready(),
        evidence: active.evidence })) {
        if (this.native) { void this.promoteNative(this.next); this.emit(); return; }
        active.source.setMuted(true); this.releaseCurrent();
        this.current = this.next; this.next = undefined; this.nextGeneration++;
        this.nextAttempt = 0; this.nextRetryAt = 0; this.nextPending = false;
        this.selected = this.current.slot; this.state.current = this.selected.key;
        this.current.source.media.hidden = false; this.current.source.setMuted(false);
        this.resetEvidence(); this.emit(); return;
      }
    }
    if (eligible && candidate && !this.state.nextPlaybackBlocked && !this.nextPlayPending && !this.nextPending && at >= this.nextRetryAt && (!this.next || failedConnection(this.next, at))) {
      this.next?.source.release(); this.next = undefined; void this.connect(candidate, true);
    }
    if (visible && this.selected?.stream && !this.currentPending && at >= this.currentRetryAt && (!active || failedConnection(active, at))) {
      // Recovery never discards progressing buffered media merely because transport ended.
      if (this.native && active?.source.recover) {
        if (!this.currentPending) {
          this.currentPending = true;
          const request = this.playRequest, generation = this.currentGeneration;
          void active.source.recover(false).then(accepted => {
            if (this.disposed || active !== this.current || request !== this.playRequest) return;
            if (!accepted) this.state.unavailable = true;
            active.evidence = clearPlaybackEvidence(performance.now()); active.startupDeadline = performance.now() + STARTUP_ALLOWANCE_MS; active.progressed = false;
          }).catch(() => { if (!this.disposed && active === this.current && request === this.playRequest) this.state.unavailable = true; }).finally(() => { if (generation === this.currentGeneration && active === this.current) { this.currentPending = false; this.currentRetryAt = performance.now() + backoff[0]; } });
        }
      } else { active?.source.release(); this.current = undefined; void this.connect(this.selected, false); }
    }
    this.emit();
  }
  dispose() {
    this.disposed = true; clearInterval(this.timer); document.removeEventListener("visibilitychange", this.resetEvidence);
    this.releaseNext(); this.releaseCurrent(); this.context?.removeEventListener("statechange", this.resetEvidence);
    void this.context?.close().catch(() => {});
  }
}
