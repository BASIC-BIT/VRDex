import {
  AdmissionSchema,
  type Admission,
  type PlaybackMode,
  type PublicContext,
} from "@vrdex/media-relay";
import { createNativeHlsAdapter } from "./native-hls-adapter";
import type {
  PlaybackAdapter,
  PlaybackRequest,
  AdapterNotify,
} from "./event-playback-owner";
export type RelayPlaybackClient = {
  open(
    context: PublicContext,
    streamId: string,
    mode: PlaybackMode,
  ): Promise<unknown>;
  get(id: string): Promise<unknown>;
  refresh(id: string): Promise<unknown>;
  restart(id: string): Promise<unknown>;
  release(id: string): Promise<unknown>;
};
export function relayPlaybackEnabled() {
  return process.env.NEXT_PUBLIC_MEDIA_RELAY_ENABLED === "true";
}
export function relayContext(
  request: Extract<PlaybackRequest, { kind: "vrcdn" }>,
): PublicContext {
  return "profileId" in request
    ? {
        kind: "profile",
        profileId: request.profileId,
        linkId: request.sourceId,
      }
    : {
        kind: "event",
        eventId: request.eventId,
        selectedSourceId: request.sourceId,
      };
}
/** Admission is lazy and all completions belong to one explicit playback intent. */
export function createRelayPlaybackAdapter({
  request: initialRequest,
  mode: initialMode,
  mount,
  notify,
  client,
  createNative = createNativeHlsAdapter,
}: {
  request: Extract<PlaybackRequest, { kind: "vrcdn" }>;
  mode: PlaybackMode;
  mount: HTMLElement;
  notify: AdapterNotify;
  client: RelayPlaybackClient;
  createNative?: typeof createNativeHlsAdapter;
}): PlaybackAdapter {
  let request = initialRequest,
    mode = initialMode,
    disposed = false,
    version = 0,
    intent = false;
  let grantId: string | undefined,
    admission: Promise<Admission> | undefined,
    native: PlaybackAdapter | undefined;
  let expiresAt = 0;
  let volume = 1,
    muted = false;
  let wake: (() => void) | undefined;
  const release = (id: string) => {
    void client.release(id).catch(() => {});
  };
  const read = async () => {
    const result = AdmissionSchema.parse(
      await (grantId
        ? client.get(grantId)
        : client.open(relayContext(request), request.sourceId, mode)),
    );
    if (result.kind === "ready" || result.kind === "preparing") {
      const id = result.kind === "ready" ? result.grant.id : result.grantId;
      if (disposed) release(id);
      else grantId = id;
    }
    return result;
  };
  async function play(): Promise<boolean> {
    intent = true;
    const token = ++version;
    if (native && grantId && Date.now() >= expiresAt) {
      // A foreground refresh during recovery may have extended the server grant
      // without returning ready metadata. Resolve it before requesting a new one.
      const current = AdmissionSchema.parse(await client.get(grantId));
      if (disposed || !intent || token !== version) return false;
      if (current.kind === "ready") expiresAt = current.grant.expiresAt;
      else {
        native.dispose();
        native = undefined;
        if (current.kind !== "preparing") {
          release(grantId);
          grantId = undefined;
        }
      }
    }
    if (native) return native.play();
    const deadline = Date.now() + 30_000;
    while (!disposed && intent && token === version) {
      const pending = admission ?? (admission = read());
      let result: Admission;
      try {
        result = await pending;
      } finally {
        if (admission === pending) admission = undefined;
      }
      if (disposed || !intent || token !== version) return false;
      if (result.kind === "ready") {
        expiresAt = result.grant.expiresAt;
        native = createNative({
          grant: result,
          mode,
          mount,
          notify: (patch) => {
            if (!disposed) notify(patch);
          },
        });
        native.update(request);
        native.setVolume(volume);
        native.setMuted(muted);
        return native.play();
      }
      if (result.kind !== "preparing" || Date.now() >= deadline) {
        notify({
          status: "unavailable",
          unavailableReason:
            result.kind === "unavailable" && result.reason === "unsupported"
              ? "unsupported"
              : undefined,
        });
        return false;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(
          () => {
            wake = undefined;
            resolve();
          },
          Math.min(3000, result.retryAfterMs),
        );
        wake = () => {
          clearTimeout(timer);
          wake = undefined;
          resolve();
        };
      });
    }
    return false;
  }
  return {
    play,
    async retry() {
      // Recreate media without surrendering the continuation capability.
      native?.dispose();
      native = undefined;
      intent = true;
      const token = ++version;
      if (!grantId) return play();
      const result = AdmissionSchema.parse(await client.restart(grantId));
      if (disposed || !intent || token !== version) return false;
      if (result.kind === "unavailable" && result.reason === "expired") {
        release(grantId);
        grantId = undefined;
        return play();
      }
      admission = Promise.resolve(result);
      return play();
    },
    pause() {
      intent = false;
      version++;
      wake?.();
      native?.pause();
    },
    async setMode(next) {
      mode = next;
      if (native) return native.setMode?.(next) ?? false;
      return false;
    },
    async refresh() {
      if (disposed || !grantId) return;
      const token = version;
      const result = AdmissionSchema.parse(await client.refresh(grantId));
      if (disposed || token !== version) return;
      if (result.kind === "ready") expiresAt = result.grant.expiresAt;
      if (result.kind === "unavailable") {
        native?.pause();
        notify({
          status: "unavailable",
          unavailableReason:
            result.kind === "unavailable" && result.reason === "unsupported"
              ? "unsupported"
              : undefined,
        });
      }
    },
    setVolume(value) {
      volume = value;
      native?.setVolume(value);
    },
    setMuted(value) {
      muted = value;
      native?.setMuted(value);
    },
    update(value) {
      if (value.kind === "vrcdn") request = value;
      native?.update(value);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      intent = false;
      version++;
      wake?.();
      native?.dispose();
      if (grantId) release(grantId);
    },
  };
}

/** Foreground-only capability renewal is independent of native demand accounting. */
export function retainForegroundGrant(
  owner: { refresh(): Promise<void> },
  visibility: EventTarget,
  isVisible: () => boolean,
  intervalMs = 60_000,
) {
  let busy = false,
    stopped = false;
  const refresh = () => {
    if (stopped || !isVisible() || busy) return;
    busy = true;
    void owner
      .refresh()
      .catch(() => {})
      .finally(() => {
        busy = false;
      });
  };
  visibility.addEventListener("visibilitychange", refresh);
  const timer = setInterval(refresh, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
    visibility.removeEventListener("visibilitychange", refresh);
  };
}
