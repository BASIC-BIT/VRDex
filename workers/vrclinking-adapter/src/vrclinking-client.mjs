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
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

  async function fetchPage(guildId, discordUserId, token, page) {
    const query = new URLSearchParams({
      search: discordUserId,
      searchBy: "DiscordId",
      page: String(page),
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401 || response.status === 403) {
      // The delegation is no longer usable; surfaced so operators can be told
      // to re-delegate rather than silently returning "not linked".
      throw new VrclinkingProviderError("Delegated credential was rejected.", {
        status: response.status,
        reason: "credential_rejected",
      });
    }

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new VrclinkingProviderError(`Provider returned HTTP ${response.status}.`, {
        status: response.status,
        reason: response.status === 429 ? "rate_limited" : "provider_error",
      });
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new VrclinkingProviderError("Provider returned malformed JSON.", {
        reason: "schema_drift",
      });
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
    for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
      const payload = await fetchPage(guildId, discordUserId, token, page);

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

    // Exhausting the bound without a match is indistinguishable from no match
    // for the claimant, and the page cap is ours rather than the provider's.
    return null;
  };
}
