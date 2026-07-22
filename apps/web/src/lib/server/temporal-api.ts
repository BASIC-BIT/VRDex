import {
  TemporalIdempotencyHeaderSchema,
  type TemporalParseRequest,
} from "@vrdex/api-contracts";

import { internal } from "@convex-generated-api";
import type { Id } from "../../../../../convex/_generated/dataModel";

import {
  evaluateOptionalApiBearerRequest,
} from "@/lib/server/api-v0";
import { convexAdminHttpClient } from "@/lib/server/convex-http";
import {
  hashContinuationToken,
  hashTemporalInput,
  problem,
  type TemporalJob,
} from "./temporal-response";

export {
  completedTemporalResponse,
  createContinuationToken,
  hashContinuationToken,
  hashTemporalInput,
  pendingTemporalResponse,
  problem,
  temporalSubmissionError,
} from "./temporal-response";
const DEFAULT_TIME_ZONE = "America/New_York";
const SYNC_BUDGET_MS = 1_800;
const POLL_INTERVAL_MS = 150;

type AuthorizedTemporalRequest = {
  ownerUserId: Id<"users">;
  tokenId: string;
};

export function parseTemporalIdempotencyKey(request: Request) {
  const parsed = TemporalIdempotencyHeaderSchema.safeParse({
    "idempotency-key": request.headers.get("idempotency-key") ?? undefined,
  });
  if (!parsed.success) {
    return {
      ok: false as const,
      response: problem(
        400,
        "Invalid Idempotency-Key",
        "Use 1 to 128 letters, numbers, dots, underscores, colons, or hyphens.",
      ),
    };
  }
  return {
    ok: true as const,
    value: parsed.data["idempotency-key"],
  };
}

export async function authorizeTemporalApiRequest(request: Request) {
  const evaluation = await evaluateOptionalApiBearerRequest(request, {
    requiredScopes: ["time:parse"],
    routeClass: "time_parse",
  });
  if (!evaluation.ok) {
    return evaluation;
  }
  if (evaluation.context.credential.kind === "anonymous") {
    return {
      ok: false as const,
      response: problem(401, "Bearer token required", "Use a personal API token with the time:parse scope."),
    };
  }
  if (evaluation.context.credential.kind !== "api_token") {
    return {
      ok: false as const,
      response: problem(403, "Personal token required", "OAuth access to time parsing is not enabled during the closed beta."),
    };
  }
  if (evaluation.context.credential.ownerKind !== "user") {
    return {
      ok: false as const,
      response: problem(403, "User token required", "Time parsing beta access belongs to an individual VRDex account."),
    };
  }
  return {
    ok: true as const,
    context: {
      ownerUserId: evaluation.context.credential.ownerUserId as Id<"users">,
      tokenId: evaluation.context.credential.tokenId,
    } satisfies AuthorizedTemporalRequest,
  };
}

export async function submitTemporalJob(args: {
  auth: AuthorizedTemporalRequest;
  body: TemporalParseRequest;
  continuationToken: string;
}) {
  const referenceInstant = args.body.referenceInstant ?? new Date().toISOString();
  const timeZone = args.body.timeZone ?? DEFAULT_TIME_ZONE;
  return convexAdminHttpClient().mutation(internal.temporalParsing.submitForApiOwner, {
    ownerUserId: args.auth.ownerUserId,
    credentialId: args.auth.tokenId,
    continuationTokenHash: hashContinuationToken(args.continuationToken),
    text: args.body.text,
    inputHash: hashTemporalInput(args.body.text),
    timeZone,
    ...(args.body.locale === undefined ? {} : { locale: args.body.locale }),
    ...(args.body.country === undefined ? {} : { country: args.body.country }),
    ...(args.body.subdivision === undefined ? {} : { subdivision: args.body.subdivision }),
    referenceInstant,
    ...(args.body.retainInput === undefined ? {} : { retainInput: args.body.retainInput }),
  });
}

export async function waitForImmediateTemporalResult(args: {
  auth: AuthorizedTemporalRequest;
  continuationToken: string;
}) {
  const deadline = Date.now() + SYNC_BUDGET_MS;
  while (Date.now() < deadline) {
    const job = await getTemporalJob(args);
    if (job?.status === "succeeded" || job?.status === "failed") {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return null;
}

export async function getTemporalJob(args: {
  auth: AuthorizedTemporalRequest;
  continuationToken: string;
}): Promise<TemporalJob | null> {
  return convexAdminHttpClient().query(internal.temporalParsing.getJobForApiOwner, {
    ownerUserId: args.auth.ownerUserId,
    continuationTokenHash: hashContinuationToken(args.continuationToken),
  }) as Promise<TemporalJob | null>;
}
