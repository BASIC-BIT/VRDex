import { randomBytes } from "node:crypto";

import { oauthIssuerUrl } from "./oauth-jwt";

const consentTransactionPattern = /^vrdx_consent_[A-Za-z0-9_-]{43}$/;

export function createOAuthConsentTransactionValue() {
  return `vrdx_consent_${randomBytes(32).toString("base64url")}`;
}

export function normalizeOAuthConsentTransactionValue(value: string) {
  const transaction = value.trim();

  if (!consentTransactionPattern.test(transaction)) {
    throw new Error("OAuth consent transaction is invalid.");
  }

  return transaction;
}

function bytesToHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashOAuthConsentTransactionValue(value: string) {
  const bytes = new TextEncoder().encode(normalizeOAuthConsentTransactionValue(value));
  return bytesToHex(await crypto.subtle.digest("SHA-256", bytes));
}

export function oauthConsentCompletionErrorDescription(reason: string) {
  return reason === "invalid_transaction"
    ? "The OAuth consent transaction is invalid or expired. Restart authorization."
    : "The OAuth client cannot use the requested redirect URI, resource, or scopes.";
}

export function oauthConsentOriginAllowed(
  request: Request,
  production = process.env.NODE_ENV === "production",
) {
  if (!production) {
    return true;
  }

  const origin = request.headers.get("origin");

  if (origin === null) {
    return false;
  }

  try {
    return new URL(origin).origin === new URL(oauthIssuerUrl(request)).origin;
  } catch {
    return false;
  }
}
