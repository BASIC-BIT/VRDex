import { apiScopes, type ApiScope } from "./auth";

const tokenLookupHexLength = 24;
const tokenVerifierHexLength = 64;
const apiTokenPattern = new RegExp(`^vrdx_([0-9a-f]{${tokenLookupHexLength}})\\.([0-9a-f]{${tokenVerifierHexLength}})$`);

export type ApiTokenParts = {
  tokenPrefix: string;
  tokenValue: string;
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

export function createApiTokenValue(): ApiTokenParts {
  const lookup = randomHex(12);
  const verifier = randomHex(32);
  const tokenPrefix = `vrdx_${lookup}`;

  return {
    tokenPrefix,
    verifier,
    tokenValue: `${tokenPrefix}.${verifier}`,
  };
}

export function parseApiTokenValue(value: string) {
  const match = apiTokenPattern.exec(value.trim());

  if (match === null) {
    return null;
  }

  return {
    tokenPrefix: `vrdx_${match[1]}`,
    verifier: match[2],
  };
}

export async function hashApiTokenValue(value: string, pepper: string) {
  const normalizedPepper = pepper.trim();

  if (!normalizedPepper) {
    throw new Error("VRDEX_API_TOKEN_PEPPER is required for API token hashing.");
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${normalizedPepper}:${value.trim()}`),
  );

  return bytesToHex(digest);
}

export function timingSafeEqualString(first: string, second: string) {
  const length = Math.max(first.length, second.length);
  let mismatch = first.length === second.length ? 0 : 1;

  for (let index = 0; index < length; index += 1) {
    mismatch |= (first.charCodeAt(index) || 0) ^ (second.charCodeAt(index) || 0);
  }

  return mismatch === 0;
}

export function normalizeApiTokenLabel(value: string) {
  const label = value.trim().replace(/\s+/g, " ");

  if (!label) {
    throw new Error("API token label is required.");
  }

  if (label.length > 80) {
    throw new Error("API token label must be 80 characters or fewer.");
  }

  return label;
}

export function normalizeApiTokenScopes(scopes: readonly string[] | undefined): ApiScope[] {
  const requested = scopes === undefined || scopes.length === 0 ? ["public:read"] : scopes;
  const uniqueScopes = [...new Set(requested)];

  for (const scope of uniqueScopes) {
    if (!(apiScopes as readonly string[]).includes(scope)) {
      throw new Error(`Unsupported API token scope: ${scope}`);
    }
  }

  return uniqueScopes as ApiScope[];
}
