import { NextRequest, NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";
import { convexAdminHttpClient } from "@/lib/server/convex-http";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const token = process.env.VRDEX_E2E_BROWSER_TOKEN?.trim();
  const secret = process.env.VRDEX_E2E_CONVEX_SECRET?.trim();
  const target = new URL(
    process.env.CONVEX_URL ??
      process.env.NEXT_PUBLIC_CONVEX_URL ??
      "https://invalid.invalid",
  );
  const permitted =
    target.origin === "https://scrupulous-corgi-247.convex.cloud" ||
    (target.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(target.hostname));
  if (
    process.env.VERCEL_ENV === "production" ||
    !permitted ||
    process.env.VRDEX_ENABLE_E2E_HELPERS !== "true" ||
    process.env.VRDEX_ENABLE_E2E_AUTH_HELPERS !== "true" ||
    !secret ||
    !token ||
    request.headers.get("x-vrdex-e2e-token") !== token
  )
    return NextResponse.json(
      { error: "Club staff fixture is unavailable." },
      { status: 403 },
    );
  const body = await request.json().catch(() => null);
  if (
    !body ||
    ![
      "seed",
      "lookup",
      "expireInvitation",
      "cleanup",
      "seedAnalytics",
      "cleanupAnalytics",
    ].includes(body.op) ||
    typeof body.runId !== "string" ||
    !/^[a-z0-9-]{1,48}$/.test(body.runId)
  )
    return NextResponse.json(
      { error: "Invalid club fixture request." },
      { status: 400 },
    );
  const args =
    body.op === "lookup"
      ? { secret, runId: body.runId }
      : body.op === "seed"
        ? { secret, runId: body.runId, ownerClerkUserId: body.ownerClerkUserId }
        : {
            secret,
            runId: body.runId,
            profileId: body.profileId,
            ...(body.op === "expireInvitation"
              ? { invitationId: body.invitationId }
              : {}),
          };
  try {
    const result = await convexAdminHttpClient().mutation(
      makeFunctionReference<"mutation">(`e2eClubStaff:${body.op}`),
      args,
    );
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      {
        error:
          "Club fixture operation failed. Preserve the run ID for cleanup.",
      },
      { status: 409 },
    );
  }
}
