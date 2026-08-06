import type { Id } from "./_generated/dataModel";

/**
 * Formatting and configuration for the support digest, kept out of the action.
 *
 * `supportRequestDigest.ts` is a `"use node"` module so it can reach the SES
 * client, and importing that module pulls the whole AWS SDK in with it. Nothing
 * here needs the SDK, so it lives where a test can reach it without loading one.
 */

const TOPIC_LABELS: Record<string, string> = {
  ownership_dispute: "Ownership dispute",
  transfer: "Transfer",
  recovery: "Recovery",
  feedback: "Feedback",
};

export type DigestRequest = {
  id: Id<"supportRequests">;
  topic: string;
  profileSlug: string | null;
  displayName: string | null;
  requesterContact: string | null;
  requesterSubject: string | null;
  message: string;
  createdAt: number;
};

export type SupportDigestConfig = {
  recipient: string;
  sender: string;
  region: string;
  siteUrl: string | undefined;
};

function optionalEnv(env: Record<string, string | undefined>, name: string): string | undefined {
  const value = env[name]?.trim();

  return value ? value : undefined;
}

/**
 * The three values a digest cannot be sent without, or nothing.
 *
 * A deployment that has never configured a recipient is the ordinary state, not
 * a broken one, so this reports absence rather than throwing. The cron would
 * otherwise fail every hour on every deployment with nothing to fix.
 *
 * SES itself is already provisioned and out of sandbox, and its variables are
 * set wherever mail is expected to work, so in practice the recipient is the
 * only one of these that is ever missing.
 */
export function supportDigestConfig(
  env: Record<string, string | undefined>,
): SupportDigestConfig | null {
  const recipient = optionalEnv(env, "VRDEX_SUPPORT_DIGEST_TO");
  const sender = optionalEnv(env, "AWS_SES_FROM_EMAIL");
  const region = optionalEnv(env, "AWS_SES_REGION");

  if (recipient === undefined || sender === undefined || region === undefined) {
    return null;
  }

  return {
    recipient,
    sender,
    region,
    siteUrl: optionalEnv(env, "SITE_URL")?.replace(/\/+$/, ""),
  };
}

export function supportDigestSubject(count: number): string {
  return count === 1 ? "VRDex support: 1 new request" : `VRDex support: ${count} new requests`;
}

/**
 * One request as a block of the digest body.
 *
 * Plain text on purpose. The point of this mail is that someone can act on it,
 * which means the identifiers have to survive being read on a phone, quoted into
 * a reply, and pasted into the Convex dashboard.
 */
export function formatDigestEntry(
  request: DigestRequest,
  siteUrl: string | undefined,
): string {
  const label = TOPIC_LABELS[request.topic] ?? request.topic;
  const profile =
    request.profileSlug === null
      ? (request.displayName ?? "not given")
      : `${request.profileSlug}${siteUrl === undefined ? "" : ` (${siteUrl}/p/${request.profileSlug})`}`;

  return [
    `${label} at ${new Date(request.createdAt).toISOString()}`,
    `Profile: ${profile}`,
    `Reply to: ${request.requesterContact ?? "not given"}`,
    // Absent for every anonymous request, which recovery requests generally are.
    // Named rather than omitted, so its absence is a fact rather than a gap.
    `Signed in as: ${request.requesterSubject ?? "not signed in"}`,
    "",
    request.message,
  ].join("\n");
}

export function formatDigestBody(
  requests: DigestRequest[],
  siteUrl: string | undefined,
): string {
  return requests
    .map((request) => formatDigestEntry(request, siteUrl))
    .join(`\n\n${"-".repeat(60)}\n\n`);
}
