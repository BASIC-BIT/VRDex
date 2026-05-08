import { fetchQuery } from "convex/nextjs";
import { api } from "@convex-generated-api";

export async function fetchBackendStatus() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return { kind: "missing-url" as const };
  }

  try {
    const data = await fetchQuery(api.health.status, {});

    return {
      kind: "live" as const,
      data,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`Server-side Convex fetchQuery failed: ${message}`);

    return {
      kind: "error" as const,
    };
  }
}
