// Minimal VRCLinking client covering the single route this adapter needs.
// Shape is taken from the OpenAPI-generated client in the public VRCLinking
// SDK; see docs/backend/vrclinking-api.md.

const DEFAULT_BASE_URL = "https://vrclinking.com/api";

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

  /**
   * Look up one guild member by Discord id.
   *
   * Returns the matching `SearchMember` or null. The caller receives provider
   * data for the requested member only; nothing else from the page is exposed.
   */
  return async function getGuildMemberByDiscordId(guildId, discordUserId, token) {
    const query = new URLSearchParams({ search: discordUserId, searchBy: "DiscordId" });
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

    const results = Array.isArray(payload?.results) ? payload.results : [];

    // Search is fuzzy by contract, so require an exact Discord id match rather
    // than trusting the first row.
    return results.find((member) => member?.id === discordUserId) ?? null;
  };
}
