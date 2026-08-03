import { claimError } from "./_claimErrors";

/**
 * Refuse to send credentials to a plaintext endpoint.
 *
 * Every overridable outbound base URL here carries something worth stealing:
 * the proof adapters get the shared bearer token, the claimant's Discord id and
 * tenant secret references; Discord's API gets the OAuth client secret, the
 * authorization code, and the resulting access token. All of them exist as
 * overrides so hosted E2E can point at a stub, which is exactly how a
 * hand-edited `http://` reaches production.
 *
 * `http` is allowed only on loopback, where there is no wire to sniff. Same
 * rule the VRCLinking provider client enforces for its own base URL.
 */
export function requireSecureOutboundUrl(value: string, name: string): string {
  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    throw claimError("ADAPTER_UNAVAILABLE", `${name}_invalid`);
  }

  // `[::1]` is loopback too, and `URL` keeps the brackets in `hostname`.
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);

  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback)) {
    throw claimError("ADAPTER_UNAVAILABLE", `${name}_insecure`);
  }

  return value;
}
