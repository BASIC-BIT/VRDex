export const apiV0CorsHeaders = [
  { key: "Access-Control-Allow-Origin", value: "*" },
  { key: "Access-Control-Allow-Methods", value: "GET, HEAD, POST, PATCH, DELETE, OPTIONS" },
  {
    key: "Access-Control-Allow-Headers",
    value: "Authorization, Content-Type, If-None-Match, X-VRDEX-Upload-Token",
  },
  {
    key: "Access-Control-Expose-Headers",
    value:
      "Content-Disposition, ETag, Location, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After, WWW-Authenticate",
  },
  { key: "Access-Control-Max-Age", value: "600" },
] as const;

export function apiV0CorsResponseHeaders() {
  return Object.fromEntries(apiV0CorsHeaders.map(({ key, value }) => [key, value]));
}

export function apiV0PreflightResponse(request: Pick<Request, "method" | "url">) {
  const pathname = new URL(request.url).pathname;

  if (
    request.method !== "OPTIONS" ||
    (pathname !== "/api/v0" && !pathname.startsWith("/api/v0/"))
  ) {
    return null;
  }

  return new Response(null, {
    headers: apiV0CorsResponseHeaders(),
    status: 204,
  });
}
