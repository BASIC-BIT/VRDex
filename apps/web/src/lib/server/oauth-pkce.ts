import { randomBytes } from "node:crypto";

const authorizationCodePattern = /^vrdx_code_[0-9a-f]{32}$/;
const refreshTokenPattern = /^vrdx_rt_[0-9a-f]{48}$/;
const codeChallengePattern = /^[A-Za-z0-9_-]{43,128}$/;
const codeVerifierPattern = /^[A-Za-z0-9._~-]{43,128}$/;

export function createOAuthAuthorizationCodeValue() {
  return `vrdx_code_${randomBytes(16).toString("hex")}`;
}

export function normalizeOAuthAuthorizationCodeValue(value: string) {
  const code = value.trim();

  if (!authorizationCodePattern.test(code)) {
    throw new Error("OAuth authorization code is malformed.");
  }

  return code;
}

function bytesToHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes: ArrayBuffer) {
  return Buffer.from(bytes).toString("base64url");
}

async function sha256Digest(value: string) {
  return await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
}

export async function hashOAuthAuthorizationCodeValue(value: string) {
  return bytesToHex(await sha256Digest(normalizeOAuthAuthorizationCodeValue(value)));
}

export function createOAuthRefreshTokenValue() {
  return `vrdx_rt_${randomBytes(24).toString("hex")}`;
}

export function normalizeOAuthRefreshTokenValue(value: string) {
  const refreshToken = value.trim();

  if (!refreshTokenPattern.test(refreshToken)) {
    throw new Error("OAuth refresh token is malformed.");
  }

  return refreshToken;
}

export function refreshTokenPepper() {
  const pepper = process.env.VRDEX_OAUTH_REFRESH_TOKEN_PEPPER?.trim();

  if (!pepper) {
    throw new Error("VRDEX_OAUTH_REFRESH_TOKEN_PEPPER is required for OAuth refresh token hashing.");
  }

  return pepper;
}

export async function hashOAuthRefreshTokenValue(value: string, pepper: string) {
  const normalizedPepper = pepper.trim();

  if (!normalizedPepper) {
    throw new Error("OAuth refresh token pepper is required.");
  }

  return bytesToHex(await sha256Digest(`${normalizedPepper}:${normalizeOAuthRefreshTokenValue(value)}`));
}

export function normalizeOAuthCodeVerifier(value: string) {
  const verifier = value.trim();

  if (!codeVerifierPattern.test(verifier)) {
    throw new Error("OAuth code_verifier is malformed.");
  }

  return verifier;
}

export function normalizeOAuthCodeChallenge(value: string) {
  const challenge = value.trim();

  if (!codeChallengePattern.test(challenge)) {
    throw new Error("OAuth code_challenge is malformed.");
  }

  return challenge;
}

export function normalizeOAuthCodeChallengeMethod(value: string) {
  const method = value.trim() || "S256";

  if (method !== "S256") {
    throw new Error("OAuth code_challenge_method must be S256.");
  }

  return method;
}

export async function deriveS256CodeChallenge(verifier: string) {
  return bytesToBase64Url(await sha256Digest(normalizeOAuthCodeVerifier(verifier)));
}
