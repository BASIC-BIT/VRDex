import { containsProofCode, proofSurfaceFields } from "./proof-matching.mjs";
import { applySessionCookies, setCookieHeaders } from "./vrchat-login.mjs";

const DEFAULT_BASE_URL = "https://api.vrchat.cloud/api/1";

export class VrchatProviderError extends Error {
  constructor(message, { status = 0, retryAfterMs, category = "provider_error" } = {}) {
    super(message);
    this.name = "VrchatProviderError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.category = category;
  }
}

function requireExternalId(value, prefix, label) {
  if (typeof value !== "string" || !value.startsWith(prefix) || value.length > 120) {
    throw new VrchatProviderError(`${label} is malformed.`, { category: "schema_drift" });
  }
  return value;
}

function requireInstanceId(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new VrchatProviderError("Instance ID is malformed.", { category: "schema_drift" });
  }
  return value;
}

function sanitizeGroupInstanceLocator(value, groupId, label) {
  const normalized = requireInstanceId(value);
  const groupMarkers = [...normalized.matchAll(/group\((grp_[A-Za-z0-9-]+)\)/g)].map((match) => match[1]);
  if (groupMarkers.some((marker) => marker !== groupId)) {
    throw new VrchatProviderError(`${label} belongs to another group.`, { category: "schema_drift" });
  }
  return normalized
    .replace(/(~(?:hidden|private)\()[^)]{1,120}(\))/gi, "$1subject-redacted$2")
    .replace(/usr_[A-Za-z0-9-]{1,100}/gi, "subject-redacted");
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new VrchatProviderError(`${label} is malformed.`, { category: "schema_drift" });
  }
  return value;
}

function retryAfterMs(response) {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function joinPolicy(value) {
  if (value === "open") return "free";
  if (value === "request") return "request";
  if (value === "invite" || value === "closed") return "invite";
  return "unknown";
}

function groupVisibility(value) {
  if (value === "private") return "private";
  if (value === "default") return "public";
  return "unknown";
}

export class VrchatClient {
  constructor({
    authCookie,
    twoFactorAuthCookie,
    userAgent,
    fetcher = fetch,
    baseUrl = DEFAULT_BASE_URL,
    timeoutMs = 15_000,
    groupCacheTtlMs = 5 * 60_000,
    clock = Date.now,
  }) {
    if (typeof authCookie !== "string" || authCookie.trim().length < 8) throw new Error("A service-account auth cookie is required.");
    if (twoFactorAuthCookie !== undefined && (typeof twoFactorAuthCookie !== "string" || twoFactorAuthCookie.trim().length < 8)) throw new Error("The service-account two-factor cookie is invalid.");
    if (typeof userAgent !== "string" || !userAgent.includes("/")) throw new Error("An identifying application/version User-Agent is required.");
    this.authCookie = authCookie.trim();
    this.twoFactorAuthCookie = twoFactorAuthCookie?.trim();
    this.userAgent = userAgent.trim();
    this.fetcher = fetcher;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeoutMs = timeoutMs;
    this.groupCacheTtlMs = Math.max(0, Math.floor(groupCacheTtlMs));
    this.clock = clock;
    this.groupCache = new Map();
    this.requestCounts = { total: 0, success: 0, clientError: 0, serverError: 0, rateLimited: 0 };
  }

  /**
   * Confirm the stored session is still accepted, spending one request.
   *
   * Nothing else touches the provider while no group is assigned, so without
   * this a dead session is first noticed by the first real proof claim. The
   * provider may rotate the cookie on this call; the live client follows it,
   * otherwise the next check presents a retired value and 401s on its own.
   * The rotated value is not written back to the secret: a restart reloads the
   * transferred one, which is the recorded limitation of a read-only secret.
   */
  async verifySession() {
    const user = await this.request("/auth/user", {
      onResponse: (response) => {
        const cookies = new Map([["auth", this.authCookie], ...(this.twoFactorAuthCookie ? [["twoFactorAuth", this.twoFactorAuthCookie]] : [])]);
        applySessionCookies(cookies, setCookieHeaders(response));
        this.authCookie = cookies.get("auth") ?? this.authCookie;
        this.twoFactorAuthCookie = cookies.get("twoFactorAuth");
      },
    });
    if (!user || typeof user !== "object" || typeof user.id !== "string" || !/^usr_[A-Za-z0-9-]{8,120}$/.test(user.id)) {
      throw new VrchatProviderError("Current user response is malformed.", { category: "schema_drift" });
    }
    return { userId: user.id };
  }

  async request(path, { method = "GET", body, onResponse } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    this.requestCounts.total += 1;
    let response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": this.userAgent,
          cookie: `auth=${this.authCookie}${this.twoFactorAuthCookie ? `; twoFactorAuth=${this.twoFactorAuthCookie}` : ""}`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      clearTimeout(timeout);
      if (error?.name === "AbortError") throw new VrchatProviderError("Provider request timed out.", { category: "timeout" });
      throw new VrchatProviderError("Provider request failed.", { category: "network" });
    }
    if (!response.ok) {
      clearTimeout(timeout);
      if (response.status === 429) this.requestCounts.rateLimited += 1;
      else if (response.status >= 500) this.requestCounts.serverError += 1;
      else this.requestCounts.clientError += 1;
      throw new VrchatProviderError(`Provider returned HTTP ${response.status}.`, {
        status: response.status,
        retryAfterMs: retryAfterMs(response),
        category: response.status === 401 ? "authentication" : response.status === 404 ? "visibility" : response.status === 429 ? "rate_limit" : response.status >= 500 ? "transient" : "provider_error",
      });
    }
    this.requestCounts.success += 1;
    onResponse?.(response);
    if (response.status === 204) {
      clearTimeout(timeout);
      return null;
    }
    // The deadline stays armed until the body is read. `fetch` resolves on
    // headers, so clearing it here — as the `finally` above used to — left a
    // provider that sends headers and then stalls the body with no timeout at
    // all: the await never settles, the worker never leaves `checkProofs`,
    // telemetry stops, and the claimed batch stays stamped until a restart.
    try { return await response.json(); }
    catch (error) {
      if (error?.name === "AbortError") throw new VrchatProviderError("Provider request timed out.", { category: "timeout" });
      throw new VrchatProviderError("Provider returned malformed JSON.", { status: response.status, category: "schema_drift" });
    }
    finally { clearTimeout(timeout); }
  }

  async getGroup(groupId, { maxAgeMs = 0 } = {}) {
    requireExternalId(groupId, "grp_", "Group ID");
    const cached = this.groupCache.get(groupId);
    if (maxAgeMs > 0 && cached && this.clock() - cached.cachedAt <= maxAgeMs) return cached.group;
    const group = await this.request(`/groups/${encodeURIComponent(groupId)}`);
    if (!group || typeof group !== "object") throw new VrchatProviderError("Group response is malformed.", { category: "schema_drift" });
    const normalized = {
      groupId: requireExternalId(group.id, "grp_", "Group ID"),
      memberCount: nonNegativeInteger(group.memberCount, "Group member count"),
      membershipStatus: typeof group.membershipStatus === "string" ? group.membershipStatus : "inactive",
      joinPolicy: joinPolicy(group.joinState),
      groupVisibility: groupVisibility(group.privacy),
    };
    this.groupCache.set(groupId, { cachedAt: this.clock(), group: normalized });
    return normalized;
  }

  /**
   * Look for a one-time ownership proof code on a VRChat user or group.
   *
   * Returns only a boolean. The bio or description text is read in-process and
   * deliberately never returned, cached, or logged, so the control plane learns
   * whether the code was present and nothing else about the subject.
   */
  async findProofCode(targetType, targetExternalId, proofCode) {
    const isGroup = targetType === "vrchat_group";
    const path = isGroup
      ? `/groups/${encodeURIComponent(requireExternalId(targetExternalId, "grp_", "Group ID"))}`
      : `/users/${encodeURIComponent(requireExternalId(targetExternalId, "usr_", "User ID"))}`;
    const record = await this.request(path);

    if (!record || typeof record !== "object") {
      throw new VrchatProviderError("Proof target response is malformed.", {
        category: "schema_drift",
      });
    }

    return containsProofCode(
      proofSurfaceFields(targetType).map((field) => record[field]),
      proofCode,
    );
  }

  async joinGroup(groupId) {
    const normalizedGroupId = requireExternalId(groupId, "grp_", "Group ID");
    this.groupCache.delete(normalizedGroupId);
    return this.request(`/groups/${encodeURIComponent(normalizedGroupId)}/join`, { method: "POST" });
  }

  async leaveGroup(groupId) {
    const normalizedGroupId = requireExternalId(groupId, "grp_", "Group ID");
    this.groupCache.delete(normalizedGroupId);
    try {
      return await this.request(`/groups/${encodeURIComponent(normalizedGroupId)}/leave`, { method: "POST" });
    } catch (error) {
      if (error instanceof VrchatProviderError && error.status === 404) return null;
      throw error;
    }
  }

  async connectGroup(groupId) {
    let group = await this.getGroup(groupId);
    if (group.membershipStatus === "member") return { ...group, state: "active", transition: "already_member" };
    if (group.membershipStatus === "banned" || group.membershipStatus === "userblocked") return { ...group, state: "blocked", transition: group.membershipStatus };
    if (group.membershipStatus === "requested") return { ...group, state: "awaiting_approval", transition: "request_pending" };
    if (group.membershipStatus === "invited") {
      await this.joinGroup(groupId);
      group = await this.getGroup(groupId);
      return group.membershipStatus === "member"
        ? { ...group, state: "active", transition: "accepted_invite" }
        : { ...group, state: "awaiting_invite", transition: group.membershipStatus };
    }
    if (group.joinPolicy === "invite") return { ...group, state: "awaiting_invite", transition: "manual_invite_required" };
    if (group.joinPolicy === "unknown") return { ...group, state: "connecting", transition: "unsupported_join_state" };
    await this.joinGroup(groupId);
    group = await this.getGroup(groupId);
    if (group.membershipStatus === "member") return { ...group, state: "active", transition: "joined" };
    if (group.membershipStatus === "requested") return { ...group, state: "awaiting_approval", transition: "requested" };
    return { ...group, state: "connecting", transition: group.membershipStatus };
  }

  async readAggregateSnapshot(groupId) {
    const group = await this.getGroup(groupId, { maxAgeMs: this.groupCacheTtlMs });
    if (group.membershipStatus !== "member") throw new VrchatProviderError(`Service account membership is ${group.membershipStatus}.`, { status: 403, category: "membership" });
    const rawInstances = await this.request(`/groups/${encodeURIComponent(groupId)}/instances`);
    if (!Array.isArray(rawInstances)) throw new VrchatProviderError("Group instance response is malformed.", { category: "schema_drift" });
    const instances = rawInstances.map((item) => {
      if (!item || typeof item !== "object" || !item.world || typeof item.world !== "object") throw new VrchatProviderError("Group instance item is malformed.", { category: "schema_drift" });
      if (typeof item.location !== "string" || item.location.length > 500) throw new VrchatProviderError("Instance location is malformed.", { category: "schema_drift" });
      const vrchatWorldId = requireExternalId(item.world.id, "wrld_", "World ID");
      const rawInstanceId = requireInstanceId(item.instanceId);
      if (item.location !== `${vrchatWorldId}:${rawInstanceId}`) throw new VrchatProviderError("Instance location does not match its world and instance ID.", { category: "schema_drift" });
      return {
        providerInstanceId: sanitizeGroupInstanceLocator(rawInstanceId, groupId, "Instance ID"),
        providerLocation: sanitizeGroupInstanceLocator(item.location, groupId, "Instance location"),
        vrchatWorldId,
        population: nonNegativeInteger(item.memberCount, "Instance member count"),
      };
    });
    return { group, instances, observedAt: this.clock() };
  }
}
