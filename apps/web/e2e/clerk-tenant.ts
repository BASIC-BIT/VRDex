export async function assertClerkTestTenant(
  secretKey: string,
  expectedFrontendApi: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!secretKey.startsWith("sk_test_") || !/^https:\/\/[a-z0-9-]+\.clerk\.accounts\.dev$/.test(expectedFrontendApi)) {
    throw new Error("Clerk recovery requires a development secret and tenant.");
  }
  // The authenticated domains response identifies the secret's instance.
  // A publishable key or an empty users response cannot establish this binding.
  const response = await fetcher("https://api.clerk.com/v1/domains", {
    method: "GET",
    headers: { authorization: `Bearer ${secretKey}` },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  }).catch(() => { throw new Error("Clerk tenant verification request failed."); });
  if (!response.ok) throw new Error("Clerk tenant verification request failed.");
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== "object" || !("data" in body) || !Array.isArray(body.data)) {
    throw new Error("Clerk tenant verification returned an invalid response.");
  }
  const primary = body.data.filter((entry: unknown) => entry && typeof entry === "object" &&
    "is_satellite" in entry && entry.is_satellite === false);
  if (primary.length !== 1 || primary[0].object !== "domain" ||
    ![expectedFrontendApi, `${expectedFrontendApi}/`].includes(primary[0].frontend_api_url)) {
    throw new Error("Clerk secret tenant does not match the staging deployment.");
  }
}
