// AES-256-GCM for connector credentials. Web Crypto, not node:crypto, so the
// default Convex runtime (mutations) can import this without "use node".
const IV_BYTES = 12;
const TAG_BYTES = 16;

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

async function connectorKey(usage: "encrypt" | "decrypt") {
  const raw = process.env.VRDEX_CONNECTOR_TOKEN_KEY;
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    bytes = raw ? fromBase64(raw) : undefined;
  } catch {
    bytes = undefined;
  }
  if (bytes?.length !== 32) {
    throw new Error("VRDEX_CONNECTOR_TOKEN_KEY must be 32 bytes, base64 encoded.");
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [usage]);
}

export async function encryptSecret(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, tagLength: TAG_BYTES * 8 },
      await connectorKey("encrypt"),
      new TextEncoder().encode(plain),
    ),
  );
  const body = sealed.subarray(0, sealed.length - TAG_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  return `v1:${toBase64(iv)}:${toBase64(tag)}:${toBase64(body)}`;
}

const decodeSegment = (value: string) => {
  try {
    return fromBase64(value);
  } catch {
    return null;
  }
};

export async function decryptSecret(cipher: string): Promise<string> {
  const [version, ...segments] = cipher.split(":");
  if (version !== "v1") throw new Error("CONNECTOR_CIPHER_VERSION");
  const [iv, tag, bodyBytes] = segments.length === 3 ? segments.map(decodeSegment) : [];
  if (!iv || !tag || !bodyBytes || iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error("CONNECTOR_CIPHER_FORMAT");
  const sealed = new Uint8Array(bodyBytes.length + TAG_BYTES);
  sealed.set(bodyBytes);
  sealed.set(tag, bodyBytes.length);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: TAG_BYTES * 8 },
    await connectorKey("decrypt"),
    sealed,
  );
  return new TextDecoder().decode(plain);
}
