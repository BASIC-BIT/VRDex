import { NextRequest, NextResponse } from "next/server";
import { api, internal } from "@convex-generated-api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import { convexAdminHttpClient } from "@/lib/server/convex-http";
import {
  deleteProfileAssetObjects,
  headProfileAssetObject,
  isProfileAssetStorageConfigured,
} from "@/lib/server/profile-asset-storage";

export const dynamic = "force-dynamic";

function secretFor(request: NextRequest) {
  const token = process.env.VRDEX_E2E_BROWSER_TOKEN?.trim();
  const secret = process.env.VRDEX_E2E_CONVEX_SECRET?.trim();
  const supplied =
    request.headers.get("x-vrdex-e2e-token") ??
    request.cookies.get("vrdex_e2e_token")?.value;
  const url = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (
    process.env.VERCEL_ENV === "production" ||
    process.env.VRDEX_ENABLE_E2E_HELPERS !== "true" ||
    process.env.VRDEX_ENABLE_E2E_AUTH_HELPERS !== "true" ||
    url !== "https://scrupulous-corgi-247.convex.cloud" ||
    !token ||
    !secret ||
    supplied !== token
  )
    return null;
  return secret;
}

const unavailable = () =>
  NextResponse.json(
    { error: "Staging media fixture is unavailable." },
    { status: 403 },
  );
const failed = () =>
  NextResponse.json(
    {
      error:
        "Staging media fixture operation failed. Preserve the run ID and retry cleanup.",
    },
    { status: 409 },
  );

export async function GET(request: NextRequest) {
  const secret = secretFor(request);
  if (!secret) return unavailable();
  try {
    if (
      !isProfileAssetStorageConfigured() ||
      process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED !== "true" ||
      process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED !== "true"
    )
      return failed();
    return NextResponse.json(
      await convexAdminHttpClient().query(internal.e2eMedia.preflight, {
        secret,
        cleanupOnly: request.nextUrl.searchParams.get("mode") === "cleanup",
      }),
    );
  } catch {
    return failed();
  }
}

async function execute(request: NextRequest, cleanup: boolean) {
  const secret = secretFor(request);
  if (!secret) return unavailable();
  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.runId !== "string" ||
    !/^media-[a-z0-9-]{1,32}$/.test(body.runId) ||
    (body.op !== "lookup" && typeof body.profileId !== "string")
  ) {
    return NextResponse.json(
      { error: "A media run ID and profile ID are required." },
      { status: 400 },
    );
  }
  const args = {
    secret,
    runId: body.runId,
    profileId: body.profileId as Id<"profiles">,
  };
  try {
    const client = convexAdminHttpClient();
    if (!cleanup && body.op === "lookup") {
      return NextResponse.json(await client.query(internal.e2eMedia.findFixture, {
        secret, runId: body.runId,
      }));
    }
    if (cleanup) {
      const prepared = await client.mutation(
        internal.e2eMedia.prepareCleanup,
        args,
      );
      if (prepared.profileMissing) {
        return NextResponse.json({ deleted: true, deletedMedia: true, alreadyDeleted: true });
      }
      if ((prepared.safeDeleteAfter ?? 0) > Date.now())
        return NextResponse.json({ error: "Fixture signed transfer may still be valid.",
          retryAt: prepared.safeDeleteAfter }, { status: 409 });
      if (prepared.storageKeys.length)
        await deleteProfileAssetObjects(prepared.storageKeys);
      for (const key of prepared.storageKeys)
        if (await headProfileAssetObject(key)) throw new Error("Fixture object remains after deletion.");
      const finished = await client.mutation(internal.e2eMedia.finishCleanup, {
        ...args,
        deletedStorageKeys: prepared.storageKeys,
      });
      const result = await client.mutation(api.e2e.cleanupProfileBySlug, {
        secret,
        slug: finished.slug,
      });
      return NextResponse.json({
        deleted: result.deleted,
        deletedMedia: finished.deletedMedia,
        deletedObjects: prepared.storageKeys.length,
        releasedReservations: finished.releasedReservations,
      });
    }
    if (body.op === "inspect")
      return NextResponse.json(
        await client.query(internal.e2eMedia.inspect, args),
      );
    if (body.op === "inspect-audit")
      return NextResponse.json(await client.query(internal.e2eMedia.inspectAudit, args));
    if (body.op === "worker-cleanup-proof" && typeof body.submissionId === "string") {
      const submissionId = body.submissionId as Id<"profileMediaSubmissions">;
      const proofArgs = { ...args, submissionId };
      const before = await client.mutation(internal.e2eMedia.makeRejectedFixtureDue, proofArgs);
      if (!(await Promise.all(before.storageKeys.map(headProfileAssetObject))).some(Boolean))
        throw new Error("Rejected fixture has no stored object.");
      const sweep = await client.action(internal.contributionCleanup.sweep, {});
      const after = await client.query(internal.e2eMedia.inspectRejectedFixtureDeletion, proofArgs);
      if (!sweep.configured || !sweep.ok || !after.blobDeleted ||
        after.storageKeys.some((key) => !before.storageKeys.includes(key)) ||
        (await Promise.all(before.storageKeys.map(headProfileAssetObject))).some(Boolean))
        throw new Error("Cleanup worker did not delete exact fixture objects.");
      return NextResponse.json({ workerDeleted: true, deletedObjects: before.storageKeys.length });
    }
    if (
      body.op === "assign-review-owner" &&
      typeof body.reviewerEmail === "string"
    ) {
      return NextResponse.json(
        await client.mutation(internal.e2eMedia.assignReviewOwner, {
          ...args,
          reviewerEmail: body.reviewerEmail,
        }),
      );
    }
    return NextResponse.json(
      { error: "Unknown media fixture operation." },
      { status: 400 },
    );
  } catch {
    return failed();
  }
}

export async function POST(request: NextRequest) {
  return execute(request, false);
}
export async function DELETE(request: NextRequest) {
  return execute(request, true);
}
