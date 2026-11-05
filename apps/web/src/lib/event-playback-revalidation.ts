import type {
  EventPlaybackOwner,
  PlaybackRequest,
} from "./event-playback-owner";

/** Poll the public projection independently of route/auth lifetime. Fail closed on errors/timeouts. */
export function retainPlaybackAuthorization(
  owner: EventPlaybackOwner,
  read: (slug: string) => Promise<PlaybackRequest | null>,
  intervalMs = 15_000,
  timeoutMs = 10_000,
) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const generation = owner.generation;
  const active = owner.getSnapshot().request;
  const slug =
    active && "profileId" in active ? active.profileSlug : active?.eventSlug;
  async function refresh() {
    if (stopped || !slug || owner.generation !== generation) return;
    let expired = false;
    timeout = setTimeout(() => {
      expired = true;
      if (!stopped) owner.revalidate(null, generation);
    }, timeoutMs);
    try {
      const request = await read(slug);
      if (!stopped && !expired) owner.revalidate(request, generation);
    } catch {
      if (!stopped && !expired) owner.revalidate(null, generation);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (!stopped && owner.generation === generation)
        timer = setTimeout(refresh, intervalMs);
    }
  }
  void refresh();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (timeout) clearTimeout(timeout);
  };
}
