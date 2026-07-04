import { apiScopes, type ApiScope } from "./auth";

const oauthClientIdHexLength = 24;
const oauthSecretLookupHexLength = 16;
const oauthSecretVerifierHexLength = 64;
const oauthClientIdPattern = new RegExp(`^vrdx_app_[0-9a-f]{${oauthClientIdHexLength}}$`);
const oauthClientSecretPattern = new RegExp(
  `^vrdx_secret_([0-9a-f]{${oauthSecretLookupHexLength}})\\.([0-9a-f]{${oauthSecretVerifierHexLength}})$`,
);

export const oauthClientTypes = ["public", "confidential"] as const;
export const oauthGrantTypes = ["authorization_code", "refresh_token", "client_credentials"] as const;
export const oauthApplicationStatuses = ["active", "revoked"] as const;

export type OAuthClientType = (typeof oauthClientTypes)[number];
export type OAuthGrantType = (typeof oauthGrantTypes)[number];
export type OAuthApplicationStatus = (typeof oauthApplicationStatuses)[number];

export type OAuthClientSecretParts = {
  secretPrefix: string;
  secretValue: string;
  verifier: string;
};

function randomHex(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);

  return bytesToHex(bytes);
}

function bytesToHex(bytes: Uint8Array | ArrayBuffer) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  return [...view].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase();

  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]" || normalized === "::1";
}

function normalizeUrlString(value: string, options: { label: string; allowLoopbackHttp?: boolean }) {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${options.label} must be an absolute URL.`);
  }

  if (url.username || url.password) {
    throw new Error(`${options.label} must not contain credentials.`);
  }

  if (url.hash) {
    throw new Error(`${options.label} must not contain a fragment.`);
  }

  if (url.protocol === "https:") {
    return url.toString();
  }

  if (options.allowLoopbackHttp === true && url.protocol === "http:" && isLoopbackHostname(url.hostname)) {
    return url.toString();
  }

  throw new Error(`${options.label} must use HTTPS${options.allowLoopbackHttp ? " or loopback HTTP" : ""}.`);
}

export function createOAuthClientId() {
  return `vrdx_app_${randomHex(12)}`;
}

export function normalizeOAuthClientId(value: string) {
  const clientId = value.trim();

  if (!oauthClientIdPattern.test(clientId)) {
    throw new Error("OAuth client id must use the vrdx_app_<24 hex> format.");
  }

  return clientId;
}

export function createOAuthClientSecretValue(): OAuthClientSecretParts {
  const lookup = randomHex(8);
  const verifier = randomHex(32);
  const secretPrefix = `vrdx_secret_${lookup}`;

  return {
    secretPrefix,
    verifier,
    secretValue: `${secretPrefix}.${verifier}`,
  };
}

export function parseOAuthClientSecretValue(value: string) {
  const match = oauthClientSecretPattern.exec(value.trim());

  if (match === null) {
    return null;
  }

  return {
    secretPrefix: `vrdx_secret_${match[1]}`,
    verifier: match[2],
  };
}

export async function hashOAuthClientSecretValue(value: string, pepper: string) {
  const normalizedPepper = pepper.trim();

  if (!normalizedPepper) {
    throw new Error("VRDEX_OAUTH_CLIENT_SECRET_PEPPER is required for OAuth client secret hashing.");
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${normalizedPepper}:${value.trim()}`),
  );

  return bytesToHex(digest);
}

export function normalizeOAuthClientType(value: string): OAuthClientType {
  if ((oauthClientTypes as readonly string[]).includes(value)) {
    return value as OAuthClientType;
  }

  throw new Error("OAuth client type must be public or confidential.");
}

export function normalizeOAuthApplicationName(value: string) {
  const name = value.trim().replace(/\s+/g, " ");

  if (!name) {
    throw new Error("OAuth application name is required.");
  }

  if (name.length > 80) {
    throw new Error("OAuth application name must be 80 characters or fewer.");
  }

  return name;
}

export function normalizeOAuthApplicationDescription(value: string | undefined) {
  const description = value?.trim().replace(/\s+/g, " ");

  if (!description) {
    return undefined;
  }

  return description.slice(0, 500);
}

export function normalizeOAuthOptionalUrl(value: string | undefined, label: string) {
  const raw = value?.trim();

  if (!raw) {
    return undefined;
  }

  return normalizeUrlString(raw, { label });
}

export function normalizeOAuthRedirectUris(values: readonly string[]) {
  if (values.length === 0) {
    throw new Error("At least one OAuth redirect URI is required.");
  }

  if (values.length > 10) {
    throw new Error("OAuth applications can register at most 10 redirect URIs.");
  }

  const redirectUris = values.map((value) =>
    normalizeUrlString(value, { label: "OAuth redirect URI", allowLoopbackHttp: true }),
  );

  return [...new Set(redirectUris)];
}

export function normalizeOAuthScopes(scopes: readonly string[] | undefined): ApiScope[] {
  const requested = scopes === undefined || scopes.length === 0 ? ["public:read"] : scopes;
  const uniqueScopes = [...new Set(requested)];

  for (const scope of uniqueScopes) {
    if (!(apiScopes as readonly string[]).includes(scope)) {
      throw new Error(`Unsupported OAuth scope: ${scope}`);
    }
  }

  return uniqueScopes as ApiScope[];
}

export function normalizeOAuthGrantTypes(
  grantTypes: readonly string[] | undefined,
  clientType: OAuthClientType,
): OAuthGrantType[] {
  const requested =
    grantTypes === undefined || grantTypes.length === 0
      ? clientType === "public"
        ? ["authorization_code", "refresh_token"]
        : ["authorization_code", "refresh_token", "client_credentials"]
      : grantTypes;
  const uniqueGrantTypes = [...new Set(requested)];

  for (const grantType of uniqueGrantTypes) {
    if (!(oauthGrantTypes as readonly string[]).includes(grantType)) {
      throw new Error(`Unsupported OAuth grant type: ${grantType}`);
    }
  }

  if (clientType === "public" && uniqueGrantTypes.includes("client_credentials")) {
    throw new Error("Public OAuth clients cannot use client credentials.");
  }

  return uniqueGrantTypes as OAuthGrantType[];
}
