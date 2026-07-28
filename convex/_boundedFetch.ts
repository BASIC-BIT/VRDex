/**
 * `fetch` with a deadline that stays armed until the response body is read.
 *
 * Every provider call from a Convex action needs one of these. `fetch` resolves
 * as soon as headers arrive, so a timer cleared around the fetch alone bounds
 * nothing: a provider that sends headers and then stalls the body leaves the
 * await unresolved until the action runtime kills it. Five separate instances of
 * that shape reached review in this feature — the VRChat client, the VRCLinking
 * client, the Discord OAuth calls, and the adapter round-trip — each fixed where
 * it was reported. This is the shared version so the next caller inherits it.
 *
 * The body is read inside the deadline and returned parsed, so an early return
 * on a non-2xx cannot leave the timer armed either.
 */
export type BoundedResponse = {
  ok: boolean;
  status: number;
  /** Parsed JSON body, or `undefined` when the body was absent or unparseable. */
  body: unknown;
};

export const DEFAULT_PROVIDER_TIMEOUT_MS = 10_000;

export async function boundedFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_PROVIDER_TIMEOUT_MS,
): Promise<BoundedResponse> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.json().catch(() => undefined);

    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(deadline);
  }
}
