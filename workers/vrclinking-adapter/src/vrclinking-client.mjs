// Minimal VRCLinking client covering the single route this adapter needs.
// Shape is taken from the OpenAPI-generated client in the public VRCLinking
// SDK; see docs/backend/vrclinking-api.md.

const DEFAULT_BASE_URL = "https://vrclinking.com/api";
// Bound on how far an exact-id search will page. A search for one Discord id
// should land on page one; this only exists so a provider that mis-reports
// `totalPages` cannot loop.
const MAX_SEARCH_PAGES = 5;

export class VrclinkingProviderError extends Error {
  constructor(message, { status = 0, reason = "provider_error" } = {}) {
    super(message);
    this.name = "VrclinkingProviderError";
    this.status = status;
    this.reason = reason;
  }
}

export function createVrclinkingClient({
  baseUrl = process.env.VRDEX_VRCLINKING_BASE_URL || DEFAULT_BASE_URL,
  fetcher = fetch,
  timeoutMs = 10_000,
} = {}) {
  // Every request to this host carries a community's delegated key as a bearer
  // token, and the README invites overriding the base URL to point at a stub —
  // so a hand-edited `http://` or a typo'd host would put those credentials on
  // the wire in the clear. Plain HTTP is allowed only for a loopback stub.
  const BASE_URL_RULE =
    "VRDEX_VRCLINKING_BASE_URL must be an absolute URL using https, or http on localhost for a local stub.";
  let parsedBaseUrl;

  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    // Without this, a scheme-less value (`vrclinking.com/api`) crashes startup
    // with a bare `TypeError: Invalid URL` naming neither the variable nor the
    // rule the guard below exists to state.
    throw new Error(BASE_URL_RULE);
  }

  // `[::1]` is loopback too, and `URL` keeps the brackets in `hostname`.
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsedBaseUrl.hostname);

  if (parsedBaseUrl.protocol !== "https:" && !(parsedBaseUrl.protocol === "http:" && isLoopback)) {
    throw new Error(BASE_URL_RULE);
  }

  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

  async function fetchPage(guildId, discordUserId, token, page, controller) {
    const query = new URLSearchParams({
      search: discordUserId,
      searchBy: "DiscordId",
      page: String(page),
    });
    let response;

    try {
      response = await fetcher(
        `${normalizedBaseUrl}/members/${encodeURIComponent(guildId)}?${query.toString()}`,
        {
          method: "GET",
          signal: controller.signal,
          headers: { accept: "application/json", authorization: `Bearer ${token}` },
        },
      );
    } catch (error) {
      throw new VrclinkingProviderError(
        error?.name === "AbortError" ? "Provider request timed out." : "Provider request failed.",
        { reason: error?.name === "AbortError" ? "timeout" : "network" },
      );
    }

    // Every non-2xx path below abandons the response without reading it. Cancel
    // the body rather than leaving the socket pinned until GC.
    // `Promise.resolve` around it: optional chaining short-circuits only on a
    // nullish `body`/`cancel`, so a `cancel` that returns undefined would throw
    // a TypeError off `.catch` — and that TypeError would replace the
    // `credential_rejected` classification the caller needs to evict a stale
    // token from the secret cache.
    const discard = () =>
      Promise.resolve(response.body?.cancel?.()).catch(() => undefined);

    if (response.status === 401 || response.status === 403) {
      // The delegation is no longer usable; surfaced so operators can be told
      // to re-delegate rather than silently returning "not linked".
      discard();
      throw new VrclinkingProviderError("Delegated credential was rejected.", {
        status: response.status,
        reason: "credential_rejected",
      });
    }

    if (response.status === 404) {
      discard();
      return null;
    }

    if (!response.ok) {
      discard();
      throw new VrclinkingProviderError(`Provider returned HTTP ${response.status}.`, {
        status: response.status,
        reason: response.status === 429 ? "rate_limited" : "provider_error",
      });
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new VrclinkingProviderError(
        error?.name === "AbortError" ? "Provider request timed out." : "Provider returned malformed JSON.",
        { reason: error?.name === "AbortError" ? "timeout" : "schema_drift" },
      );
    }

    // A missing or non-array `results` is schema drift, not an empty search. A
    // caller that reads it as an empty search reports a real negative — the
    // claimant is told they are not linked because the provider changed its
    // response shape.
    if (!Array.isArray(payload?.results)) {
      throw new VrclinkingProviderError("Provider response had no results array.", {
        reason: "schema_drift",
      });
    }

    return payload;
  }

  async function search(guildId, discordUserId, token, controller) {
    for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
      const payload = await fetchPage(guildId, discordUserId, token, page, controller);

      if (payload === null) {
        return null;
      }

      // Fuzzy by contract, so require an exact match rather than the first row.
      const match = payload.results.find((member) => member?.id === discordUserId);

      if (match !== undefined) {
        return match;
      }

      const totalPages = Number(payload.totalPages);

      if (payload.results.length === 0 || !Number.isFinite(totalPages) || page >= totalPages) {
        return null;
      }
    }

    // Reaching here means the provider said more pages remain and our own cap
    // stopped the search, which is not the same as the provider running out of
    // rows. Returning null would tell a claimant whose id sits past the cap
    // that they are not linked — a real negative they cannot act on — so report
    // it as a provider failure and let the caller answer "unavailable".
    throw new VrclinkingProviderError(
      "Search reached the page bound before finding an exact match.",
      { reason: "search_incomplete" },
    );
  }

  /**
   * Look up one guild member by Discord id.
   *
   * Returns the matching `SearchMember` or null. The caller receives provider
   * data for the requested member only; nothing else from the page is exposed.
   *
   * The provider's search is fuzzy and paginated, so the exact id can sit on a
   * page after the first. Stopping at page one would report a linked claimant as
   * unlinked, which is a real negative the claimant cannot do anything about.
   */
  return async function getGuildMemberByDiscordId(guildId, discordUserId, token) {
    // One deadline for the whole lookup, not one per request. Per-request
    // timers bound nothing useful when a lookup pages up to five times, and the
    // old one stopped covering the response body entirely — `fetch` resolves on
    // headers, so a provider that sent headers and then stalled the body left
    // the read with no deadline at all.
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await search(guildId, discordUserId, token, controller);
    } finally {
      clearTimeout(deadline);
    }
  };
}
