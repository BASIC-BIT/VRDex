/** Body limits apply while streaming; failures never include provider payloads or URLs. */
export async function boundedJson(
  response: Response,
  limit = 131072,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw Error("Provider response failed");
  }
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    signal?.throwIfAborted();
    for (;;) {
      const part = await reader.read();
      signal?.throwIfAborted();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw Error("Provider response size exceeded");
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel();
    reader.releaseLock();
  }
}
export function deadline(signal?: AbortSignal, ms = 1500): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
