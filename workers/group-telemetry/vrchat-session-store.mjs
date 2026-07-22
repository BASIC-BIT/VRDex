const KEYCHAIN_SERVICE = "vrdex-group-telemetry";
const SESSION_SCHEMA_VERSION = 1;

function accountKey(alias) {
  const normalized = typeof alias === "string" ? alias.trim() : "";
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(normalized)) {
    throw new Error("VRDEX_VRCHAT_PROOF_ACCOUNT_ALIAS must use 1-64 letters, numbers, dots, underscores, or hyphens.");
  }
  return `vrchat:${normalized.toLowerCase()}`;
}

function requireCookie(value, label) {
  if (typeof value !== "string" || value.length < 8 || value.length > 4096 || /[\u0000-\u0020\u007f;]/.test(value)) {
    throw new Error(`${label} is malformed.`);
  }
  return value;
}

function validatedRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== SESSION_SCHEMA_VERSION) {
    throw new Error("Stored VRChat session has an unsupported format.");
  }
  if (typeof value.userId !== "string" || !/^usr_[A-Za-z0-9-]{8,120}$/.test(value.userId)) {
    throw new Error("Stored VRChat service-account ID is malformed.");
  }
  if (typeof value.savedAt !== "string" || !Number.isFinite(Date.parse(value.savedAt))) {
    throw new Error("Stored VRChat session timestamp is malformed.");
  }
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    userId: value.userId,
    authCookie: requireCookie(value.authCookie, "Stored VRChat auth cookie"),
    ...(value.twoFactorAuthCookie === undefined
      ? {}
      : { twoFactorAuthCookie: requireCookie(value.twoFactorAuthCookie, "Stored VRChat two-factor cookie") }),
    savedAt: value.savedAt,
  };
}

export class VrchatSessionStoreError extends Error {
  constructor(message, { cause, code = "keychain_error" } = {}) {
    super(message, { cause });
    this.name = "VrchatSessionStoreError";
    this.code = code;
  }
}

export class VrchatKeychainSessionStore {
  constructor({ keytarLoader = () => import("keytar"), clock = Date.now } = {}) {
    this.keytarLoader = keytarLoader;
    this.clock = clock;
    this.keytar = undefined;
  }

  async client() {
    if (this.keytar) return this.keytar;
    let imported;
    try {
      imported = await this.keytarLoader();
    } catch (cause) {
      throw new VrchatSessionStoreError("Windows Credential Manager is unavailable; no plaintext session fallback is permitted.", { cause });
    }
    const client = imported?.default ?? imported;
    if (!["getPassword", "setPassword", "deletePassword"].every((method) => typeof client?.[method] === "function")) {
      throw new VrchatSessionStoreError("The operating-system credential vault adapter is invalid.");
    }
    this.keytar = client;
    return client;
  }

  async load(alias) {
    const key = accountKey(alias);
    const client = await this.client();
    const raw = await client.getPassword(KEYCHAIN_SERVICE, key);
    if (raw === null) return undefined;
    try {
      return validatedRecord(JSON.parse(raw));
    } catch (cause) {
      await client.deletePassword(KEYCHAIN_SERVICE, key);
      throw new VrchatSessionStoreError("The invalid stored VRChat session was removed from the operating-system credential vault.", {
        cause,
        code: "invalid_session_removed",
      });
    }
  }

  async save(alias, session) {
    const key = accountKey(alias);
    const record = validatedRecord({
      schemaVersion: SESSION_SCHEMA_VERSION,
      userId: session?.userId,
      authCookie: session?.authCookie,
      twoFactorAuthCookie: session?.twoFactorAuthCookie,
      savedAt: new Date(this.clock()).toISOString(),
    });
    const client = await this.client();
    await client.setPassword(KEYCHAIN_SERVICE, key, JSON.stringify(record));
    return record;
  }

  async clear(alias) {
    const client = await this.client();
    return client.deletePassword(KEYCHAIN_SERVICE, accountKey(alias));
  }
}
