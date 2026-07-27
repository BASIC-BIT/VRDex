function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function generateRecentAuthProof() {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashRecentAuthProof(proof: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(proof),
  );
  return hex(new Uint8Array(digest));
}
