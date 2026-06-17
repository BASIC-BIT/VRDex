import { ConvexHttpClient } from "convex/browser";

export function convexHttpClient() {
  const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;

  if (!convexUrl) {
    throw new Error("Convex URL is not configured.");
  }

  return new ConvexHttpClient(convexUrl);
}
