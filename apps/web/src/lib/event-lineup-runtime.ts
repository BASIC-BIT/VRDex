import { createObservedVrcdnSource, type ObservedVrcdnSource } from "./vrcdn-observed-source";
import { clearPlaybackEvidence, observeAudio, AUDIO_SILENCE_DURATION_MS } from "./event-audio-observation";
import { joinSlot, handoffEligibleAt, shouldHandoff } from "./event-playback";
import { followingSlot, nextSlot, reconcileSlot, type LineupSlot } from "./event-lineup-session";

export type LineupEvent = { title: string; startAt: number; doorsOpenAt?: number; endAt?: number; slots: LineupSlot[] };
export type LineupSnapshot = { started: boolean; following: boolean; paused: boolean; muted: boolean; volume: number; current?: string; connected: boolean; unavailable: boolean; nextPlaybackBlocked?: boolean };
type Connection = { slot: LineupSlot; source: ObservedVrcdnSource; evidence: ReturnType<typeof clearPlaybackEvidence> };
const backoff = [1000, 2000, 4000, 10000];

/** One mounted event session owns every media node, request generation and retry deadline. */
export class EventLineupSession {
  state: LineupSnapshot = { started: false, following: true, paused: true, muted: false, volume: 1, connected: false, unavailable: false };
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
    private createSource = createObservedVrcdnSource) {
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
        this.selected = match;
        if (this.current) this.current.slot = match;
        this.state.current = match.key;
      }
    }
    this.resetEvidence(); this.emit();
  }
  private select(slot: LineupSlot | undefined) {
    this.releaseNext();
    if (slot?.stream && this.current?.slot.stream?.streamId === slot.stream.streamId) {
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
    if (!this.context) {
      this.context = new AudioContext(); this.viewer = this.context.createGain(); this.viewer.connect(this.context.destination);
      this.context.addEventListener("statechange", this.resetEvidence);
    }
    try { await this.context.resume(); } catch {
      if (!this.disposed && request === this.playRequest) { this.state.paused = true; this.emit(); }
      return;
    }
    if (this.disposed || request !== this.playRequest) return;
    this.state.started = true; this.state.paused = false;
    if (this.state.following) {
      const scheduled = this.scheduleSlot();
      // Reconciled selection survives transport recovery and overtime pause/resume.
      const overtime = this.event.endAt !== undefined && Date.now() >= this.event.endAt && this.selected !== undefined && this.selected.key === this.event.slots.at(-1)?.key;
      if (!overtime) this.select(scheduled);
    }
    this.resetEvidence();
    const active = this.current;
    if (active) void active.source.play().then(accepted => {
      if (this.disposed || request !== this.playRequest || active !== this.current) return;
      if (!accepted) { this.state.paused = true; this.releaseNext(); this.emit(); }
    });
    this.tick(); this.emit();
  }
  retryNextPlayback() {
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
    void connection.source.play().then(accepted => {
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
  volume(value: number) { this.state.volume = value; this.state.muted = value === 0; this.setGain(); }
  mute() { if (this.state.muted && this.state.volume === 0) this.state.volume = 1; this.state.muted = !this.state.muted; this.setGain(); }
  private setGain() { if (this.viewer) this.viewer.gain.value = this.state.muted ? 0 : this.state.volume; this.emit(); }
  private async connect(slot: LineupSlot, prepared: boolean) {
    if (!slot.stream || !this.context || !this.viewer || this.disposed) return;
    if (prepared) this.nextPending = true; else this.currentPending = true;
    const token = prepared ? ++this.nextGeneration : ++this.currentGeneration;
    const context = this.context;
    const request = this.playRequest;
    try {
      const source = await this.createSource(context, this.viewer, slot.stream.questUrl, () => !this.disposed && token === (prepared ? this.nextGeneration : this.currentGeneration));
      if (this.disposed || token !== (prepared ? this.nextGeneration : this.currentGeneration)) { source.release(); return; }
      const acceptedSlot = prepared ? slot : reconcileSlot(slot, this.event.slots);
      if (!acceptedSlot || (!prepared && acceptedSlot.key !== this.selected?.key)) { source.release(); return; }
      const connection = { slot: acceptedSlot, source, evidence: clearPlaybackEvidence(performance.now()) };
      if (prepared) { this.next = connection; source.video.hidden = true; }
      else { this.current = connection; source.gain.gain.value = 1; }
      this.mount.append(source.video);
      void source.play().then(accepted => {
        if (this.disposed || request !== this.playRequest || token !== (prepared ? this.nextGeneration : this.currentGeneration)) return;
        if (prepared) this.state.nextPlaybackBlocked = !accepted;
        if (!accepted && !prepared) { this.state.paused = true; this.state.unavailable = false; this.releaseNext(); }
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
      while (successor?.stream && successor.stream.streamId === this.current.slot.stream?.streamId &&
        scheduleNow >= Math.max(this.selected!.endAt ?? successor.startAt, successor.startAt)) {
        this.select(successor);
        successor = followingSlot(successor, this.event.slots);
      }
    }
    const active = this.current;
    const candidate = this.selected && this.state.following ? nextSlot(this.selected, this.event.slots, scheduleNow) : undefined;
    const eligibleAt = this.selected && candidate ? handoffEligibleAt(this.selected, candidate) : Infinity;
    const eligible = visible && scheduleNow >= eligibleAt && !!candidate?.stream && candidate.stream.streamId !== this.selected?.stream?.streamId;
    if (!eligible && (this.next || this.nextPending)) this.releaseNext();
    for (const connection of [active, this.next]) {
      if (!connection) continue;
      connection.evidence = observeAudio(connection.evidence, connection.source.sample(at, this.state.paused));
    }
    if (active) {
      this.state.connected = active.evidence.progressing;
      this.state.unavailable = !active.evidence.progressing && active.evidence.failureSince !== undefined && at - active.evidence.failureSince >= 1000;
      if (this.next && !this.state.nextPlaybackBlocked && !this.nextPlayPending && shouldHandoff({ scheduleNow, observationNow: at, eligibleAt,
        following: this.state.following, paused: this.state.paused, nextReady: this.next.source.ready(),
        evidence: active.evidence, silenceDurationMs: AUDIO_SILENCE_DURATION_MS })) {
        active.source.gain.gain.value = 0; this.releaseCurrent();
        this.current = this.next; this.next = undefined; this.nextGeneration++;
        this.nextAttempt = 0; this.nextRetryAt = 0; this.nextPending = false;
        this.selected = this.current.slot; this.state.current = this.selected.key;
        this.current.source.video.hidden = false; this.current.source.gain.gain.value = 1;
        this.resetEvidence(); this.emit(); return;
      }
    }
    if (eligible && candidate && !this.state.nextPlaybackBlocked && !this.nextPlayPending && !this.nextPending && at >= this.nextRetryAt && (!this.next || (this.next.evidence.failureSince !== undefined && at - this.next.evidence.failureSince >= 1000))) {
      this.next?.source.release(); this.next = undefined; void this.connect(candidate, true);
    }
    if (visible && this.selected?.stream && !this.currentPending && at >= this.currentRetryAt && (!active || (active.evidence.failureSince !== undefined && at - active.evidence.failureSince >= 1000))) {
      // Recovery never discards progressing buffered media merely because transport ended.
      active?.source.release(); this.current = undefined; void this.connect(this.selected, false);
    }
    this.emit();
  }
  dispose() {
    this.disposed = true; clearInterval(this.timer); document.removeEventListener("visibilitychange", this.resetEvidence);
    this.releaseNext(); this.releaseCurrent(); this.context?.removeEventListener("statechange", this.resetEvidence);
    void this.context?.close().catch(() => {});
  }
}
