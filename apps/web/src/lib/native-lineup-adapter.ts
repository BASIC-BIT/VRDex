import { AdmissionSchema, PlaybackRebindSchema, type PlaybackMode } from "@vrdex/media-relay";
import { EventLineupSession, type LineupObservedSource } from "./event-lineup-runtime";
import { createNativeObservedSource } from "./native-hls-observed-source";
import type { AdapterNotify, PlaybackAdapter, PlaybackRequest } from "./event-playback-owner";
import type { RelayPlaybackClient } from "./relay-playback-adapter";
import type { LineupSlot } from "./event-lineup-session";

/** Uses the established foreground lineup coordinator, with element-owned gain and scoped grants. */
export function createNativeLineupAdapter({ request, mount, notify, mode: initialMode, client }: {
  request: Extract<PlaybackRequest, { kind: "performer_sequence" }>;
  mount: HTMLElement; notify: AdapterNotify; mode: PlaybackMode; client: RelayPlaybackClient;
}): PlaybackAdapter {
  let mode = initialMode, disposed = false;
  let previousEvent = JSON.stringify(request.event);
  const releases = new Set<() => void>();
  const waits = new Set<() => void>();
  const release = (id: string) => { void client.release(id).catch(() => {}); };
  async function wait(ms: number) {
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); waits.delete(done); resolve(); };
      const timer = setTimeout(done, Math.min(3000, ms)); waits.add(done);
    });
  }
  const session = new EventLineupSession(request.event, mount, lineup => {
    notify({ lineup, ...(lineup.current ? {} : { metadata: undefined }), status: lineup.playbackBlocked ? "blocked" : lineup.unavailable ? "unavailable" : lineup.paused ? "paused" : "playing" });
  }, undefined, {
    async create(slot, prepared, isCurrent, continuationGrantId) {
      if (!slot.stream) throw Error("Unavailable source");
      let id: string | undefined;
      let released = false, sourceIntent = 0;
      let releasedId: string | undefined;
      const cleanup = () => {
        released = true; releases.delete(cleanup);
        // Close can precede admission. A late grant still needs its own release.
        if (id && releasedId !== id) { releasedId = id; release(id); }
      };
      releases.add(cleanup);
      try {
        let result = AdmissionSchema.parse(await client.open({ kind: "event", eventId: request.eventId, selectedSourceId: slot.key }, slot.stream.streamId, mode, continuationGrantId));
        const deadline = Date.now() + 30_000;
        while (true) {
          if (result.kind === "ready" || result.kind === "preparing") id = result.kind === "ready" ? result.grant.id : result.grantId;
          if (disposed || !isCurrent()) { cleanup(); throw Error("Obsolete source"); }
          if (result.kind !== "preparing" || Date.now() >= deadline) break;
          await wait(result.retryAfterMs);
          if (disposed || !isCurrent()) { cleanup(); throw Error("Obsolete source"); }
          result = AdmissionSchema.parse(await client.get(result.grantId));
        }
        if (result.kind !== "ready") {
          if (!prepared && result.kind === "unavailable" && result.reason === "unsupported") notify({ status: "unavailable", unavailableReason: "unsupported" });
          cleanup(); throw Error("Unavailable source");
        }
        let admission = result;
        const observed = await createNativeObservedSource({ grant: admission, mode, isCurrent, mount,
          onNativePause: () => session.nativePlayback(true, observed.media),
          onNativePlay: () => session.nativePlayback(false, observed.media),
        });
        observed.setMuted(prepared);
        const source: LineupObservedSource = {
          ...observed,
          get media() { return observed.media; },
          get grantId() { return id; },
          get metadata() { return admission.metadata; },
          pause() { sourceIntent++; observed.pause(); },
          async setMode(next) { sourceIntent++; return observed.setMode(next); },
          release() { sourceIntent++; observed.release(); cleanup(); },
          async recover(explicit) {
            if (released || disposed || !id) return false;
            const token = ++sourceIntent;
            let result = AdmissionSchema.parse(await (explicit ? client.restart(id) : client.get(id)));
            if (released || disposed || token !== sourceIntent) return false;
            if (explicit && result.kind === "unavailable" && result.reason === "expired") {
              // Actual expiry requires ordinary new admission, including the calendar window.
              release(id); id = undefined;
              result = AdmissionSchema.parse(await client.open(admission.grant.context, admission.grant.streamKey.split("/")[1], mode));
            }
            const deadline = Date.now() + 30_000;
            while (true) {
              if (result.kind === "ready" || result.kind === "preparing") id = result.kind === "ready" ? result.grant.id : result.grantId;
              if (released || disposed) { if (id) release(id); return false; }
              if (token !== sourceIntent) return false;
              if (!explicit || result.kind !== "preparing" || Date.now() >= deadline) break;
              await wait(result.retryAfterMs);
              if (released || disposed || token !== sourceIntent) return false;
              result = AdmissionSchema.parse(await client.get(result.grantId));
            }
            if (result.kind !== "ready") {
              if (result.kind === "unavailable" && result.reason === "unsupported" && session.media === observed.media) notify({ status: "unavailable", unavailableReason: "unsupported" });
              return false;
            }
            admission = result;
            return observed.recoverMedia(result);
          },
          async rebind(target: LineupSlot) {
            if (!client.rebind || !id || released || admission.grant.context.kind !== "event") return false;
            const result = PlaybackRebindSchema.parse(await client.rebind(id, target.key, admission.grant.context.selectedSourceId, admission.grant.contextRevision));
            if (released || disposed || result.kind !== "rebound") return false;
            admission = { ...admission, grant: result.grant, metadata: result.metadata }; observed.updateGrant(admission); return true;
          },
          async refresh() {
            if (!id || released) return;
            const result = AdmissionSchema.parse(await client.refresh(id));
            if (disposed || released) return;
            if (result.kind === "ready") { admission = result; observed.updateGrant(result); if (session.media === observed.media) notify({ metadata: result.metadata }); }
            else if (result.kind === "unavailable") { observed.pause(); notify({ status: "unavailable" }); }
          },
        };
        return source;
      } catch (error) { cleanup(); throw error; }
    },
    onCurrent(source) { notify({ metadata: source.metadata, unavailableReason: undefined }); },
  });
  void session.setMode(initialMode);
  return {
    get media() { return session.media; },
    async play() { await session.play(); return !session.state.paused; },
    async retry() { await session.play(); return !session.state.paused; },
    pause() { session.pause(); waits.forEach(done => done()); },
    setVolume: value => session.setVolume(value), setMuted: value => session.setMuted(value),
    async setMode(next) { mode = next; return session.setMode(next); },
    refresh: () => session.refresh(),
    update(value) { if (value.kind === "performer_sequence") { const next = JSON.stringify(value.event); if (next !== previousEvent) { previousEvent = next; session.update(value.event); } } },
    manual: key => session.manual(key), live: () => session.live(), retryNextPlayback: () => session.retryNextPlayback(),
    dispose() { disposed = true; session.dispose(); waits.forEach(done => done()); releases.forEach(cleanup => cleanup()); },
  };
}
