type CleanupResponse = { status(): number; json(): Promise<unknown> };

export async function retryMediaFixtureDelete<T extends CleanupResponse>(
  attempt: () => Promise<T>,
  now = Date.now,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  const deadline = now() + 12 * 60_000;
  let response: T;
  do {
    response = await attempt();
    if (response.status() !== 409) return response;
    const body = await response.json().catch(() => null) as { retryAt?: unknown } | null;
    if (typeof body?.retryAt !== "number" || !Number.isFinite(body.retryAt)) return response;
    const remaining = deadline - now();
    if (remaining <= 0) return response;
    await sleep(Math.min(remaining, 60_000, Math.max(1_000, body.retryAt - now() + 1_000)));
  } while (true);
}
