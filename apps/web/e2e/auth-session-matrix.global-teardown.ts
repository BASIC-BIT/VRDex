import { request } from "@playwright/test";

import { authSessionMatrixIdentity } from "./auth-session-matrix-identity";

export default async function cleanupAuthSessionMatrixAccount() {
  const runId = process.env.VRDEX_AUTH_MATRIX_RUN_ID?.trim();
  if (!runId) {
    return;
  }

  const baseURL =
    process.env.PLAYWRIGHT_BASE_URL?.trim().replace(/\/+$/, "") ??
    `http://127.0.0.1:${process.env.PLAYWRIGHT_TEST_PORT ?? "3002"}`;
  const token =
    process.env.VRDEX_E2E_BROWSER_TOKEN ??
    (process.env.PLAYWRIGHT_BASE_URL ? undefined : "local-playwright-token");

  if (!token) {
    throw new Error(
      "VRDEX_E2E_BROWSER_TOKEN must be set to clean up the auth-session matrix account.",
    );
  }

  const api = await request.newContext({ baseURL });
  try {
    const response = await api.delete("/api/e2e/auth", {
      headers: { "x-vrdex-e2e-token": token },
      data: { email: authSessionMatrixIdentity(runId).email },
    });

    if (!response.ok()) {
      throw new Error(
        `Auth-session matrix cleanup failed with HTTP ${response.status()}.`,
      );
    }
  } finally {
    await api.dispose();
  }
}
