import { createHash, randomBytes } from "node:crypto";

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

export function hashOAuthConsentTransactionValue(value: string) {
  return createHash("sha256")
    .update(normalizeOAuthConsentTransactionValue(value), "utf8")
    .digest("hex");
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
