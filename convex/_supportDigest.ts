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
  owner_opt_out: "Owner opt-out",
  pre_claim_safety: "Pre-claim safety review",
};

/** Every line of requester text carries this. See `formatDigestEntry`. */
const QUOTE_PREFIX = "> ";
const ENTRY_SEPARATOR = "-".repeat(60);

export type DigestRequest = {
  table: "supportRequests" | "profileSuppressionRequests";
  id: string;
  topic: string;
  profileSlug: string | null;
  profileType: "person" | "community" | null;
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
 * The values a digest needs, or `null` when it is deliberately switched off.
 *
 * The recipient alone decides "off". A deployment that has never named a
 * mailbox is in the ordinary state, and the cron reporting that is correct.
 *
 * A recipient without the SES settings is a different thing entirely: somebody
 * asked for mail and the deployment cannot send it. Returning `null` there let
 * the cron succeed hourly while disputes piled up unseen, which is the exact
 * silence this feature exists to remove, so it throws and fails the run instead.
 */
export function supportDigestConfig(
  env: Record<string, string | undefined>,
): SupportDigestConfig | null {
  const recipient = optionalEnv(env, "VRDEX_SUPPORT_DIGEST_TO");

  if (recipient === undefined) {
    return null;
  }

  const sender = optionalEnv(env, "AWS_SES_FROM_EMAIL");
  const region = optionalEnv(env, "AWS_SES_REGION");

  if (sender === undefined || region === undefined) {
    throw new Error(
      "VRDEX_SUPPORT_DIGEST_TO is set but AWS_SES_FROM_EMAIL or AWS_SES_REGION is missing, so support requests cannot be delivered.",
    );
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
 * Where the profile a request names actually lives.
 *
 * `/p/` and `/c/` are separate routes that each fetch by type, so a community
 * slug under `/p/` is a 404. Emitting one for every request handed operators a
 * dead link for exactly the disputes that concern communities.
 */
function profileHref(
  siteUrl: string,
  slug: string,
  profileType: "person" | "community" | null,
): string {
  return `${siteUrl}/${profileType === "community" ? "c" : "p"}/${slug}`;
}

/**
 * One request as a block of the digest body.
 *
 * Plain text on purpose. The point of this mail is that someone can act on it,
 * which means the identifiers have to survive being read on a phone, quoted into
 * a reply, and pasted into the Convex dashboard.
 *
 * Every line of requester text is prefixed, and that is a boundary rather than a
 * style choice. The message is written by an anonymous stranger, and pasted in
 * raw it could contain its own `Reply to:` line and its own run of hyphens,
 * which is this format's entry separator. That let a requester append a second
 * entry with forged contact and identity fields, in the one mailbox an ownership
 * decision is made from. Prefixed, no line they write can be mistaken for a
 * field this file wrote.
 */
export function formatDigestEntry(
  request: DigestRequest,
  siteUrl: string | undefined,
): string {
  const label = TOPIC_LABELS[request.topic] ?? request.topic;
  const profile =
    request.profileSlug === null
      ? (request.displayName ?? "not given")
      : `${request.profileSlug}${siteUrl === undefined ? "" : ` (${profileHref(siteUrl, request.profileSlug, request.profileType)})`}`;
  const message =
    request.message.trim() === ""
      ? `${QUOTE_PREFIX}(no message)`
      : request.message
          .split("\n")
          .map((line) => `${QUOTE_PREFIX}${line}`)
          .join("\n");

  return [
    `${label} at ${new Date(request.createdAt).toISOString()}`,
    `Profile: ${profile}`,
    `Reply to: ${request.requesterContact ?? "not given"}`,
    // Absent for every anonymous request, which recovery requests generally are.
    // Named rather than omitted, so its absence is a fact rather than a gap.
    `Signed in as: ${request.requesterSubject ?? "not signed in"}`,
    // Named so the operator knows which table to resolve it in. The two have
    // different consequences: accepting a suppression retracts profiles from
    // discovery, and nothing at all happens automatically for the rest.
    `Record: ${request.table}/${request.id}`,
    "",
    `Message (every line below is the requester's, quoted):`,
    message,
  ].join("\n");
}

export function formatDigestBody(
  requests: DigestRequest[],
  siteUrl: string | undefined,
): string {
  return requests
    .map((request) => formatDigestEntry(request, siteUrl))
    .join(`\n\n${ENTRY_SEPARATOR}\n\n`);
}
