/**
 * Per-delegation capabilities for the VRC Linking adapter.
 *
 * The adapter's shared bearer token authenticates the channel, not the request.
 * Once it leaks, a caller can post directly and name any guild — and because
 * secret names are derived from the guild id, checking that the reference
 * matches the guild it claims proves nothing: an attacker constructs the pair
 * as easily as VRDex does. Signing each `(guild, reference)` with a key the
 * bearer token does not carry is the binding a direct caller cannot forge.
 *
 * Deliberately short-lived. A capability is minted for one verification, so a
 * captured one is worth a few minutes rather than until the key rotates.
 */
const CAPABILITY_TTL_MS = 5 * 60 * 1_000;

function capabilityKey(): string {
  const value = process.env.VRCLINKING_ADAPTER_CAPABILITY_KEY?.trim();

  // Not optional, and not silently skipped. An adapter that accepts unsigned
  // delegations is exactly the state this exists to prevent, and a check that
  // disappears when a variable is unset is worse than no check: it looks
  // enforced in review and is not in production.
  if (!value) {
    throw new Error("VRCLINKING_ADAPTER_CAPABILITY_KEY must be set to consult a delegation.");
  }

  return value;
}

/** The exact bytes both sides sign. Order and separator are part of the contract. */
export function capabilityPayload(guildId: string, secretRef: string, expiresAt: number): string {
  return `${guildId}\n${secretRef}\n${expiresAt}`;
}

export async function signDelegation(
  guildId: string,
  secretRef: string,
  now: number = Date.now(),
): Promise<{ expiresAt: number; capability: string }> {
  const expiresAt = now + CAPABILITY_TTL_MS;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(capabilityKey()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(capabilityPayload(guildId, secretRef, expiresAt)),
  );

  return { expiresAt, capability: bytesToHex(new Uint8Array(signature)) };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
