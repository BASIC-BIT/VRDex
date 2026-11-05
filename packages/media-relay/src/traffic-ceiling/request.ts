/** Offline request-shape guard for a proposed CloudFront viewer-request gate.
 * CloudFront signature validation and event ordering require hosted proof. */
export function isMeterableSegmentRequest(request: {
  method: string;
  uri: string;
  querystring: string;
  headers: Readonly<Record<string, readonly string[]>>;
  keyPairId: string;
}): boolean {
  if (
    request.method !== "GET" ||
    !/^\/vrcdn\/[A-Za-z0-9_-]{2,128}\/1\/epochs\/[1-9][0-9]*\/attempt-[0-9]+-[A-Za-z0-9_-]+\/(video|audio)-[0-9]+\.ts$/.test(
      request.uri,
    ) ||
    request.querystring.length > 4096 ||
    !/^[A-Za-z0-9]+$/.test(request.keyPairId)
  )
    return false;
  // Match the signer's literal field names and order. URLSearchParams would
  // decode percent-encoded aliases such as E%78pires into accepted names.
  const query = /^Expires=[1-9][0-9]{0,11}&Signature=[A-Za-z0-9_~-]+&Key-Pair-Id=([A-Za-z0-9]+)$/.exec(
    request.querystring,
  );
  if (!query || query[1] !== request.keyPairId)
    return false;
  // Full-object GET is the only supported body-size proof. HTTP variants can
  // produce partial/multipart bodies or bypass a naive one-object charge.
  for (const name of Object.keys(request.headers)) {
    const lower = name.toLowerCase();
    if (lower === "range" || lower.startsWith("if-") || lower === "if-range")
      return false;
  }
  return true;
}
