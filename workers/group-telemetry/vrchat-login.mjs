import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

const DEFAULT_API_BASE_URL = "https://api.vrchat.cloud/api/1";
const MAX_LOGIN_BODY_BYTES = 16 * 1024;

class LoginChallenge extends Error {
  constructor(message, kind, isInitial = false) {
    super(message);
    this.name = "LoginChallenge";
    this.kind = kind;
    this.isInitial = isInitial;
  }
}

export class VrchatSessionValidationError extends Error {
  constructor(message, { status = 0, clearable = false, cause } = {}) {
    super(message, { cause });
    this.name = "VrchatSessionValidationError";
    this.status = status;
    this.clearable = clearable;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isLoopbackHost(host, expectedPort) {
  let parsed;
  try {
    parsed = new URL(`http://${host}`);
  } catch {
    return false;
  }
  return !host.includes("@") && !parsed.username && !parsed.password && parsed.pathname === "/" &&
    !parsed.search && !parsed.hash && Number(parsed.port || 80) === expectedPort &&
    ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname.toLowerCase());
}

function isLoopbackOrigin(origin, expectedPort) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" && !origin.includes("@") && !parsed.username && !parsed.password &&
    parsed.pathname === "/" && !parsed.search && !parsed.hash && Number(parsed.port || 80) === expectedPort &&
    ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname.toLowerCase());
}

function setCookieHeaders(response) {
  if (typeof response.headers.getSetCookie === "function") return response.headers.getSetCookie();
  const combined = response.headers.get("set-cookie");
  return combined ? [combined] : [];
}

function applySessionCookies(target, headers) {
  for (const header of headers) {
    const pair = header.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if ((name === "auth" || name === "twoFactorAuth") && value) target.set(name, value);
  }
}

function requireServiceAccountId(body, expectedUserId) {
  const userId = typeof body?.id === "string" ? body.id.trim() : "";
  if (!/^usr_[A-Za-z0-9-]{8,120}$/.test(userId)) throw new Error("VRChat returned a malformed service-account identity.");
  if (expectedUserId && userId !== expectedUserId) throw new Error("Authenticated VRChat account does not match VRDEX_VRCHAT_PROOF_USER_ID.");
  return userId;
}

export class VrchatOperatorLogin {
  constructor({
    userAgent,
    expectedUserId,
    accountAlias,
    apiBaseUrl = DEFAULT_API_BASE_URL,
    fetcher = fetch,
    timeoutMs = 10 * 60_000,
    // Per-request bound, distinct from `timeoutMs` above, which is how long an
    // operator has to answer a login challenge. Without it a provider that
    // returns headers and then stalls the body hangs the command forever —
    // after `Set-Cookie` has already superseded the live session, so killing
    // the process leaves production holding cookies VRChat has retired.
    requestTimeoutMs = 20_000,
  }) {
    if (typeof userAgent !== "string" || userAgent.trim().length < 8) throw new Error("An identifying VRChat User-Agent is required.");
    if (expectedUserId !== undefined && !/^usr_[A-Za-z0-9-]{8,120}$/.test(expectedUserId)) {
      throw new Error("VRDEX_VRCHAT_PROOF_USER_ID is malformed.");
    }
    if (accountAlias !== undefined && !/^[A-Za-z0-9._-]{1,64}$/.test(accountAlias)) {
      throw new Error("VRDEX_VRCHAT_PROOF_ACCOUNT_ALIAS is malformed.");
    }
    this.userAgent = userAgent.trim();
    this.expectedUserId = expectedUserId;
    this.accountAlias = accountAlias;
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, "");
    this.fetcher = fetcher;
    this.timeoutMs = timeoutMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.cookies = new Map();
    this.pendingCredentials = undefined;
    this.server = undefined;
    this.port = undefined;
    this.token = undefined;
    this.timeout = undefined;
    this.completion = undefined;
    this.resolveCompletion = undefined;
    this.rejectCompletion = undefined;
  }

  cookieHeader() {
    return ["auth", "twoFactorAuth"]
      .flatMap((name) => this.cookies.has(name) ? [`${name}=${this.cookies.get(name)}`] : [])
      .join("; ");
  }

  async providerRequest(path, init = {}) {
    return this.fetcher(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: { "user-agent": this.userAgent, ...init.headers },
    });
  }

  async verifySession() {
    const response = await this.providerRequest("/auth/user", { headers: { cookie: this.cookieHeader() } });
    applySessionCookies(this.cookies, setCookieHeaders(response));
    const body = await response.json().catch(() => ({}));
    if (response.status !== 200) throw new Error(`VRChat session validation failed (${response.status}).`);
    return requireServiceAccountId(body, this.expectedUserId);
  }

  async validateSession(session) {
    const storedUserId = session?.userId;
    if (storedUserId !== undefined && !/^usr_[A-Za-z0-9-]{8,120}$/.test(storedUserId)) {
      throw new VrchatSessionValidationError("Stored VRChat service-account identity is malformed.", { clearable: true });
    }
    if (this.expectedUserId && storedUserId && this.expectedUserId !== storedUserId) {
      throw new VrchatSessionValidationError("Stored VRChat session belongs to a different configured service account.", { clearable: true });
    }
    this.cookies.clear();
    for (const [name, value] of [["auth", session?.authCookie], ["twoFactorAuth", session?.twoFactorAuthCookie]]) {
      if (value === undefined && name === "twoFactorAuth") continue;
      if (typeof value !== "string" || value.length < 8 || value.length > 4096 || /[\u0000-\u0020\u007f;]/.test(value)) {
        throw new VrchatSessionValidationError(`Stored VRChat ${name} cookie is malformed.`, { clearable: true });
      }
      this.cookies.set(name, value);
    }
    // One deadline across the request *and* the body read. `fetch` resolves on
    // headers, so bounding only the request left a provider that sent headers
    // and then stalled the body hanging here — after `applySessionCookies`
    // below had already taken whatever rotation it sent, which is exactly when
    // hanging is most expensive.
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    let response;
    let body;

    try {
      response = await this.providerRequest("/auth/user", {
        headers: { cookie: this.cookieHeader() },
        signal: controller.signal,
      });
      applySessionCookies(this.cookies, setCookieHeaders(response));
      body = await response.json().catch(() => ({}));
    } catch (cause) {
      // Not `clearable`: the session was never rejected, so the caller's
      // rotated-cookie recovery path should still save what it holds.
      throw new VrchatSessionValidationError("VRChat session validation could not reach the provider.", { cause });
    } finally {
      clearTimeout(deadline);
    }
    if (response.status !== 200) {
      throw new VrchatSessionValidationError(`VRChat session validation failed (${response.status}).`, {
        status: response.status,
        clearable: response.status === 401 || response.status === 403,
      });
    }
    const userId = typeof body?.id === "string" ? body.id.trim() : "";
    if (!/^usr_[A-Za-z0-9-]{8,120}$/.test(userId)) {
      throw new VrchatSessionValidationError("VRChat returned a malformed service-account identity.");
    }
    const expectedUserId = this.expectedUserId ?? storedUserId;
    if (expectedUserId && userId !== expectedUserId) {
      throw new VrchatSessionValidationError("Stored VRChat session authenticated as a different service account.", { clearable: true });
    }
    return {
      userId,
      authCookie: this.cookies.get("auth"),
      twoFactorAuthCookie: this.cookies.get("twoFactorAuth"),
    };
  }

  /**
   * The cookies this instance currently holds, including any rotation VRChat
   * applied during a validation that then failed.
   *
   * `validateSession` applies `Set-Cookie` before it checks the status or parses
   * the body, so a 200 with a truncated payload supersedes the caller's session
   * and then throws — leaving the only working pair here and nowhere else.
   * Callers that can persist it should, unless the failure was an
   * authentication one, where the rotated pair is dead too.
   */
  currentSessionCookies() {
    const authCookie = this.cookies.get("auth");

    if (typeof authCookie !== "string") {
      return undefined;
    }

    return { authCookie, twoFactorAuthCookie: this.cookies.get("twoFactorAuth") };
  }

  async authenticate(username, password, factorKind, code) {
    if (username || password) this.pendingCredentials = { username, password };
    const credentials = this.pendingCredentials;
    if (!credentials?.username || !credentials.password) throw new Error("Username and password are required.");

    if (factorKind === "totp" || factorKind === "emailOtp") {
      if (!code) throw new LoginChallenge("Enter the current verification code.", factorKind);
      const path = factorKind === "totp"
        ? "/auth/twofactorauth/totp/verify"
        : "/auth/twofactorauth/emailotp/verify";
      const response = await this.providerRequest(path, {
        method: "POST",
        headers: { cookie: this.cookieHeader(), "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      applySessionCookies(this.cookies, setCookieHeaders(response));
      await response.arrayBuffer().catch(() => undefined);
      if (response.status !== 200) throw new LoginChallenge(`Verification failed (${response.status}).`, factorKind);
      const userId = await this.verifySession();
      return { userId, authCookie: this.cookies.get("auth"), twoFactorAuthCookie: this.cookies.get("twoFactorAuth") };
    }

    this.cookies.clear();
    const basic = Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64");
    const response = await this.providerRequest("/auth/user", { headers: { authorization: `Basic ${basic}` } });
    applySessionCookies(this.cookies, setCookieHeaders(response));
    const body = await response.json().catch(() => ({}));
    const requiredFactors = Array.isArray(body?.requiresTwoFactorAuth) ? body.requiresTwoFactorAuth : [];
    if (requiredFactors.includes("totp")) throw new LoginChallenge("Authenticator verification is required.", "totp", true);
    if (requiredFactors.includes("emailOtp")) throw new LoginChallenge("Email verification is required.", "emailOtp", true);
    if (requiredFactors.length > 0) throw new Error("VRChat requested an unsupported verification method.");
    if (response.status !== 200) throw new Error(`VRChat login failed (${response.status}).`);
    const userId = requireServiceAccountId(body, this.expectedUserId);
    return { userId, authCookie: this.cookies.get("auth"), twoFactorAuthCookie: this.cookies.get("twoFactorAuth") };
  }

  async readBody(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_LOGIN_BODY_BYTES) throw Object.assign(new Error("Login request body is too large."), { status: 413 });
      chunks.push(buffer);
    }
    return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  }

  render(response, { error, stage = "initial" } = {}) {
    const factor = stage === "totp" || stage === "emailOtp";
    const title = factor ? (stage === "totp" ? "Authenticator code" : "Email verification code") : "VRDex service-account login";
    const fields = factor
      ? `<input type="hidden" name="factorKind" value="${stage}"><label>${title}<input name="code" inputmode="numeric" autocomplete="one-time-code" required autofocus></label>`
      : `<label>Username or email<input name="username" autocomplete="username" required autofocus></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label>`;
    const accountLabel = escapeHtml(this.accountAlias ?? "configured service account");
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("x-frame-options", "DENY");
    response.setHeader("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>:root{color-scheme:dark;font-family:system-ui,sans-serif}body{min-height:100vh;margin:0;display:grid;place-items:center;background:#0b1020;color:#f8fafc}main{width:min(420px,calc(100vw - 32px));padding:28px;border:1px solid #334155;border-radius:12px;background:#111827}h1{font-size:1.35rem}p{color:#cbd5e1;line-height:1.5}.error{color:#fecaca}label{display:grid;gap:8px;margin:16px 0;font-weight:650}input,button{width:100%;padding:12px;border-radius:8px;font:inherit}input{border:1px solid #475569;background:#020617;color:#f8fafc}button{border:0;background:#67e8f9;color:#083344;font-weight:800;cursor:pointer}</style></head><body><main><h1>${title}</h1><p>Sign in for <strong>${accountLabel}</strong>. This local proof process sends the password and verification code directly to VRChat and never saves them. After authentication, it saves only the resulting session in the operating-system credential vault under this alias.</p>${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}<form method="POST" action="/submit?token=${encodeURIComponent(this.token)}">${fields}<button type="submit">${factor ? "Verify" : "Sign in"}</button></form></main></body></html>`);
  }

  renderSuccess(response) {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("content-security-policy", "default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    response.end("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Authentication complete</title></head><body><p>VRChat authentication succeeded. You may close this window; keep the proof terminal open until it confirms session storage.</p></body></html>");
  }

  validatedUrl(request, response) {
    if (!this.port || !isLoopbackHost(request.headers.host ?? "", this.port)) {
      response.statusCode = 403;
      response.end("Invalid host");
      return undefined;
    }
    // Sandboxed browser surfaces serialize their otherwise same-page origin as
    // `null`. The loopback-only listener, exact Host/port check, and 192-bit
    // one-time URL token remain the CSRF boundary for that browser case.
    if (request.headers.origin && request.headers.origin !== "null" && !isLoopbackOrigin(request.headers.origin, this.port)) {
      response.statusCode = 403;
      response.end("Invalid origin");
      return undefined;
    }
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${this.port}`);
    if (url.searchParams.get("token") !== this.token) {
      response.statusCode = 403;
      response.end("Invalid token");
      return undefined;
    }
    return url;
  }

  async handleRequest(request, response) {
    const url = this.validatedUrl(request, response);
    if (!url) return;
    if (request.method === "GET" && url.pathname === "/") {
      this.render(response);
      return;
    }
    if (request.method !== "POST" || url.pathname !== "/submit") {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }
    if (!(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) {
      response.statusCode = 415;
      response.end("Unsupported content type");
      return;
    }
    try {
      const params = await this.readBody(request);
      const result = await this.authenticate(
        params.get("username")?.trim() ?? "",
        params.get("password") ?? "",
        params.get("factorKind")?.trim(),
        params.get("code")?.trim(),
      );
      if (!result.authCookie) throw new Error("VRChat did not issue an auth session cookie.");
      this.pendingCredentials = undefined;
      this.renderSuccess(response);
      this.resolveCompletion?.(result);
      await this.close();
    } catch (error) {
      if (error?.status === 413) {
        response.statusCode = 413;
        response.end("Login request body is too large");
        return;
      }
      if (error instanceof LoginChallenge) {
        this.render(response, { error: error.isInitial ? undefined : error.message, stage: error.kind });
        return;
      }
      this.cookies.clear();
      this.pendingCredentials = undefined;
      this.render(response, { error: error instanceof Error ? error.message : "Login failed." });
    }
  }

  async start() {
    if (this.server) throw new Error("VRChat operator login is already running.");
    this.token = randomBytes(24).toString("hex");
    this.completion = new Promise((resolve, reject) => {
      this.resolveCompletion = resolve;
      this.rejectCompletion = reject;
    });
    this.server = createServer((request, response) => {
      this.handleRequest(request, response).catch(() => {
        response.statusCode = 500;
        response.end("Local login failed");
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", resolve);
    });
    const address = this.server.address();
    this.port = typeof address === "object" && address ? address.port : undefined;
    this.timeout = setTimeout(() => {
      this.rejectCompletion?.(new Error("VRChat operator login timed out."));
      this.close().catch(() => undefined);
    }, this.timeoutMs);
    return { url: `http://127.0.0.1:${this.port}/?token=${encodeURIComponent(this.token)}` };
  }

  waitForLogin() {
    if (!this.completion) throw new Error("VRChat operator login has not started.");
    return this.completion;
  }

  async close() {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = undefined;
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise((resolve) => server.close(resolve));
  }
}
