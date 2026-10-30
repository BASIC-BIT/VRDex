import { containsProofCode, proofSurfaceFields } from "./proof-matching.mjs";
import { applySessionCookies, setCookieHeaders } from "./session-cookies.mjs";

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
   * this a dead session is first noticed by the first real proof claim. A
   * session for an account other than the one the secret names is treated the
   * same as an expired one: nothing may be read with it.
   */
  async verifySession({ expectedUserId } = {}) {
    const user = await this.request("/auth/user");
    if (!user || typeof user !== "object" || typeof user.id !== "string" || !/^usr_[A-Za-z0-9-]{8,120}$/.test(user.id)) {
      throw new VrchatProviderError("Current user response is malformed.", { category: "schema_drift" });
    }
    if (expectedUserId !== undefined && user.id !== expectedUserId) {
      throw new VrchatProviderError("Session belongs to another account.", { status: 401, category: "authentication" });
    }
    return { userId: user.id };
  }

  /**
   * Follow a cookie the provider rotates or clears on an authenticated
   * response, otherwise the next request presents a retired value and 401s on
   * its own. In memory only: a restart reloads the transferred secret, which
   * is the recorded limitation of a read-only secret. A cleared `auth` is
   * not followed; there is no header to send without it, and the next request
   * reports the dead session either way.
   */
  followSessionCookies(response) {
    const cookies = new Map([["auth", this.authCookie], ...(this.twoFactorAuthCookie ? [["twoFactorAuth", this.twoFactorAuthCookie]] : [])]);
    applySessionCookies(cookies, setCookieHeaders(response));
    this.authCookie = cookies.get("auth") ?? this.authCookie;
    this.twoFactorAuthCookie = cookies.get("twoFactorAuth");
  }

  async request(path, { method = "GET", body, form, maxResponseBytes, allowEmptyResponse = false } = {}) {
    if (body !== undefined && form !== undefined) throw new VrchatProviderError("Request has both a JSON and a form body.", { category: "invalid_input" });
    // Empty-response endpoints still use a bounded body read and reject redirects.
    if (allowEmptyResponse && !maxResponseBytes) maxResponseBytes = 1024 * 1024;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    this.requestCounts.total += 1;
    let response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        ...(maxResponseBytes ? { redirect: "error" } : {}),
        signal: controller.signal,
        headers: {
          accept: "application/json",
          // fetch sets the multipart boundary for FormData itself.
          ...(form === undefined ? { "content-type": "application/json" } : {}),
          "user-agent": this.userAgent,
          cookie: `auth=${this.authCookie}${this.twoFactorAuthCookie ? `; twoFactorAuth=${this.twoFactorAuthCookie}` : ""}`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(form === undefined ? {} : { body: form }),
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
    this.followSessionCookies(response);
    if (response.status === 204) {
      clearTimeout(timeout);
      return null;
    }
    // The deadline stays armed until the body is read. `fetch` resolves on
    // headers, so clearing it here — as the `finally` above used to — left a
    // provider that sends headers and then stalls the body with no timeout at
    // all: the await never settles, the worker never leaves `checkProofs`,
    // telemetry stops, and the claimed batch stays stamped until a restart.
    try {
      if (!maxResponseBytes) return await response.json();
      if (!response.body) {
        if (allowEmptyResponse) return null;
        throw new Error("Missing provider body.");
      }
      const reader = response.body.getReader();
      const chunks = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > maxResponseBytes) throw new Error("Provider body exceeds limit.");
          chunks.push(value);
        }
      } finally { await reader.cancel(); }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      if (allowEmptyResponse && length === 0) return null;
      return JSON.parse(new TextDecoder().decode(bytes));
    }
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
    let groupCreatedAt = group.createdAt == null ? undefined :
      typeof group.createdAt === "string" && /^\d{4}-\d\d-\d\dT/.test(group.createdAt) ? Date.parse(group.createdAt) : NaN;
    if (groupCreatedAt !== undefined && (!Number.isSafeInteger(groupCreatedAt) || groupCreatedAt < 0 || groupCreatedAt > this.clock())) {
      groupCreatedAt = undefined;
    }
    const returnedGroupId = requireExternalId(group.id, "grp_", "Group ID");
    if (returnedGroupId.toLowerCase() !== groupId.toLowerCase()) {
      throw new VrchatProviderError("Group response belongs to another group.", { category: "schema_drift" });
    }
    const normalized = {
      groupId,
      memberCount: nonNegativeInteger(group.memberCount, "Group member count"),
      ...(groupCreatedAt === undefined ? {} : { groupCreatedAt }),
      membershipStatus: typeof group.membershipStatus === "string" ? group.membershipStatus : "unknown",
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
      : `/profile/${encodeURIComponent(requireExternalId(targetExternalId, "usr_", "User ID"))}`;
    const record = await this.request(path);

    if (!record || typeof record !== "object" ||
      (!isGroup && (Array.isArray(record) || record.id !== targetExternalId || typeof record.bio !== "string"))) {
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

  async leaveGroup(groupId, { requireConfirmation = false } = {}) {
    const normalizedGroupId = requireExternalId(groupId, "grp_", "Group ID");
    this.groupCache.delete(normalizedGroupId);
    try {
      return await this.request(`/groups/${encodeURIComponent(normalizedGroupId)}/leave`, { method: "POST" });
    } catch (error) {
      if (!requireConfirmation && error instanceof VrchatProviderError && error.status === 404) return null;
      throw error;
    }
  }

  async connectGroup(groupId, { admissionMode = "managed", joinPolicy: authorizedPolicy, admissionAt, authorizeRequest, recordInspection, revoked = false } = {}) {
    if (admissionMode === "explicit") {
      if (!["request", "invite"].includes(authorizedPolicy) || !Number.isSafeInteger(admissionAt) || admissionAt <= 0 ||
          typeof authorizeRequest !== "function" || typeof recordInspection !== "function")
        throw new VrchatProviderError("Explicit admission authority is unavailable.", { category: "membership" });
      const inspect = async () => {
        if (!await authorizeRequest("metadata")) return null;
        const group = await this.getGroup(groupId, { maxAgeMs: 0 });
        const membership = group.membershipStatus === "member" ? "member"
          : group.membershipStatus === "requested" ? "requested"
          : group.membershipStatus === "invited" ? "invited"
          : ["banned", "userblocked"].includes(group.membershipStatus) ? "banned"
          : ["inactive", "none"].includes(group.membershipStatus) ? "absent" : null;
        if (!membership) throw new VrchatProviderError("Group membership is unreadable.", { category: "schema_drift" });
        const result = await recordInspection({ membership, visibility: group.groupVisibility, joinPolicy: group.joinPolicy });
        return result.accepted ? { ...group, membership, state: membership === "member" ? "active" : membership === "requested" ? "awaiting_approval" : "awaiting_invite" } : null;
      };
      let group = await inspect();
      if (!group || revoked || group.groupVisibility !== "public" || group.joinPolicy !== authorizedPolicy || ["member", "requested", "banned"].includes(group.membership)) return group;
      const operation = authorizedPolicy === "request" && group.membership === "absent" ? "request_join"
        : authorizedPolicy === "invite" && group.membership === "invited" ? "accept_invite" : null;
      if (!operation || !await authorizeRequest(operation)) return group;
      await this.joinGroup(groupId);
      return inspect();
    }
    if (admissionMode === "automatic" && !await authorizeRequest("metadata")) return null;
    let group;
    try {
      group = await this.getGroup(groupId);
    } catch (error) {
      if (admissionMode === "automatic" && [403, 404].includes(error?.status)) return { admissionRequired: "invalid" };
      throw error;
    }
    if (admissionMode === "automatic") {
      const reason = group.groupVisibility !== "public" ? "private"
        : group.joinPolicy === "request" || group.joinPolicy === "invite" ? group.joinPolicy
        : group.joinPolicy !== "free" ? "invalid" : undefined;
      if (reason) return { ...group, state: "blocked", admissionRequired: reason };
      if (group.membershipStatus === "member") return { ...group, state: "active", transition: "already_member" };
      if (["banned", "userblocked"].includes(group.membershipStatus))
        throw new VrchatProviderError("Automatic group membership is unavailable.", { category: "membership", status: 403 });
      if (["requested", "unknown"].includes(group.membershipStatus)) return { ...group, state: "blocked", admissionRequired: "invalid" };
      if (!await authorizeRequest("join")) return null;
      await this.joinGroup(groupId);
      if (!await authorizeRequest("metadata")) return null;
      group = await this.getGroup(groupId);
      if (group.membershipStatus !== "member")
        throw new VrchatProviderError("Automatic group membership was not confirmed.", { category: "membership", status: 403 });
      return { ...group, state: "active", transition: "joined" };
    }
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

  async readAggregateSnapshot(groupId, { admissionMode = "managed", joinPolicy: authorizedPolicy, authorizeRequest } = {}) {
    const guarded = admissionMode === "automatic" || authorizeRequest !== undefined;
    if (guarded && !await authorizeRequest("metadata")) return null;
    const group = await this.getGroup(groupId, { maxAgeMs: guarded ? 0 : this.groupCacheTtlMs });
    if ((admissionMode === "automatic" || admissionMode === "explicit") && (group.groupVisibility !== "public" || group.joinPolicy !== (admissionMode === "explicit" ? authorizedPolicy : "free")))
      throw new VrchatProviderError("Automatic group policy changed.", { category: "membership", status: 403 });
    if (group.membershipStatus !== "member") throw new VrchatProviderError(`Service account membership is ${group.membershipStatus}.`, { status: 403, category: "membership" });
    if (guarded && !await authorizeRequest("instances")) return null;
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
