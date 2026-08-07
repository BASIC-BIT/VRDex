import { ConvexError, v } from "convex/values";

import {
  assertOnlyKeys,
  normalizeInlineText,
  optionalInlineText,
  optionalStringValue,
  requireArrayValue,
  requireHttpsUrl,
  requireRecord,
  requireStringValue,
} from "./_inputValidation";
import { optionalField } from "./_publicFields";
import { parseVrcdnStreamLinks } from "./_vrcdnLinks";

/**
 * Mirrors the `profileLinkType` union in `schema.ts`. Kept as a value because
 * Convex validators are not enumerable at runtime, and both the submission form
 * and the link normalizer need the list.
 */
export const PROFILE_LINK_TYPES = [
  "vrchat_profile",
  "vrcdn",
  "discord",
  "soundcloud",
  "mixcloud",
  "twitch",
  "youtube",
  "spotify",
  "bandcamp",
  "instagram",
  "linktree",
  "website",
  "gumroad",
  "jinxxy",
  "payhip",
  "woocommerce",
  "kofi",
  "patreon",
  "commissions",
  "generic_store",
  "other",
] as const;

export type ProfileLinkType = (typeof PROFILE_LINK_TYPES)[number];

const PROFILE_LINK_TYPE_SET: ReadonlySet<string> = new Set(PROFILE_LINK_TYPES);

/**
 * Fallback label used when the writer supplies a type and URL but no label.
 * Mostly provider proper nouns, so this is naming rather than product copy.
 */
export const PROFILE_LINK_TYPE_LABELS: Record<ProfileLinkType, string> = {
  vrchat_profile: "VRChat",
  vrcdn: "VRCDN",
  discord: "Discord",
  soundcloud: "SoundCloud",
  mixcloud: "Mixcloud",
  twitch: "Twitch",
  youtube: "YouTube",
  spotify: "Spotify",
  bandcamp: "Bandcamp",
  instagram: "Instagram",
  linktree: "Linktree",
  website: "Website",
  gumroad: "Gumroad",
  jinxxy: "Jinxxy",
  payhip: "Payhip",
  woocommerce: "WooCommerce",
  kofi: "Ko-fi",
  patreon: "Patreon",
  commissions: "Commissions",
  generic_store: "Store",
  other: "Link",
};

/**
 * Writer-facing link shape. `type` and `presentation` stay `v.string()` here so
 * an unknown value reaches `sanitizeProfileLinks` and comes back as a readable
 * message, instead of Convex rejecting the whole argument object generically.
 */
export const profileLinkInputValidator = v.object({
  type: v.string(),
  url: v.string(),
  label: v.optional(v.string()),
  handle: v.optional(v.string()),
  presentation: v.optional(v.string()),
  /**
   * The provenance an editor's row says it arrived with.
   *
   * Accepted here and stripped before normalization, so it can never be stored
   * from writer input. `sanitizeApiProfileUpdateInput` reads it off the raw
   * argument as a claim and honours it only against a stored link that actually
   * carries it -- which is what lets a form post the whole array back without
   * an owner-authored link losing its stamp, or a writer inventing one.
   */
  source: v.optional(v.string()),
});

export const PROFILE_LINK_MAX_COUNT = 20;
export const PROFILE_LINK_LABEL_MAX_LENGTH = 120;
export const PROFILE_LINK_HANDLE_MAX_LENGTH = 160;
export const PROFILE_LINK_URL_MAX_LENGTH = 2_048;

/**
 * Hosts a branded link type is allowed to point at.
 *
 * The public profile renders the type as a branded affordance, and
 * `submitCommunityProfile` is an authenticated public mutation that publishes
 * immediately for a profile the submitter does not own. Without this, a
 * submitter could put a "Discord" button on somebody else's profile pointing
 * at an unrelated host.
 *
 * Only providers with a stable, universally used domain are listed. The
 * commerce types are deliberately absent because Bandcamp, Gumroad, Payhip and
 * WooCommerce stores routinely live on the seller's own domain, so a host check
 * would reject real links; `website`, `other`, `commissions` and
 * `generic_store` are arbitrary destinations by definition. `vrcdn` is not
 * here because `parseVrcdnStreamLinks` already constrains it far more tightly.
 */
const PROFILE_LINK_TYPE_HOSTS: Partial<Record<ProfileLinkType, readonly string[]>> = {
  vrchat_profile: ["vrchat.com"],
  discord: ["discord.com", "discord.gg", "discordapp.com"],
  soundcloud: ["soundcloud.com"],
  mixcloud: ["mixcloud.com"],
  twitch: ["twitch.tv"],
  youtube: ["youtube.com", "youtu.be"],
  spotify: ["spotify.com", "spotify.link"],
  instagram: ["instagram.com"],
  linktree: ["linktr.ee", "linktree.com"],
  kofi: ["ko-fi.com"],
  patreon: ["patreon.com"],
  jinxxy: ["jinxxy.com"],
};

function hostMatchesProvider(hostname: string, allowedDomains: readonly string[]): boolean {
  const host = hostname.replace(/^www\./i, "").toLowerCase();

  return allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export type ProfileLinkSource =
  | "owner_authored"
  | "reviewed"
  | "partner_provided"
  | "community_submitted";

export type NormalizedProfileLink = {
  type: ProfileLinkType;
  label: string;
  url: string;
  handle?: string;
  presentation?: "icon" | "copy";
};

export function isProfileLinkType(value: string): value is ProfileLinkType {
  return PROFILE_LINK_TYPE_SET.has(value);
}

/**
 * Validate and normalize a list of outbound profile links.
 *
 * Source-agnostic on purpose: the seed pipeline stamps provenance from the
 * batch it came from, while owner and community writes stamp their own. Callers
 * that persist links should go through `sanitizeProfileLinks` instead.
 */
export function normalizeOutboundLinks(value: unknown): NormalizedProfileLink[] {
  const links = requireArrayValue(value, "Outbound links");

  if (links.length > PROFILE_LINK_MAX_COUNT) {
    throw new Error(`Outbound links can include at most ${PROFILE_LINK_MAX_COUNT} values.`);
  }

  return links.map((entry, index) => {
    const link = requireRecord(entry, `Outbound link ${index + 1}`);
    assertOnlyKeys(
      link,
      ["type", "label", "url", "handle", "presentation"],
      `Outbound link ${index + 1}`,
    );
    const type = requireStringValue(link.type, "Outbound link type");
    const rawUrl = requireStringValue(link.url, "Outbound link URL");
    // A VRCDN stream is stored as `vrcdn:<streamId>` rather than an address,
    // because the service publishes no page for one. `requireHttpsUrl` is still
    // what every other type answers to; this only spares the one form that is
    // deliberately not a URL, and it has already been through the stream
    // normalizer to get here.
    const vrcdnReference = parseVrcdnStreamLinks(rawUrl)?.reference;
    const url =
      vrcdnReference !== undefined && rawUrl === vrcdnReference
        ? rawUrl
        : requireHttpsUrl(rawUrl, "Outbound link URL");

    if (!isProfileLinkType(type)) {
      throw new Error(`Unsupported outbound link type "${type}".`);
    }

    const parsedUrl = new URL(url!);
    if (parsedUrl.username || parsedUrl.password) {
      throw new Error("Outbound links must not contain embedded credentials.");
    }

    const handle = optionalInlineText(
      optionalStringValue(link.handle, "Outbound link handle"),
      "Outbound link handle",
      PROFILE_LINK_HANDLE_MAX_LENGTH,
    );
    const presentation = optionalStringValue(
      link.presentation,
      "Outbound link presentation",
    );

    if (presentation !== undefined && presentation !== "icon" && presentation !== "copy") {
      throw new Error("Outbound link presentation must be icon or copy.");
    }

    return {
      type,
      label: normalizeInlineText(
        requireStringValue(link.label, "Outbound link label"),
        "Outbound link label",
        PROFILE_LINK_LABEL_MAX_LENGTH,
      ),
      url: url!,
      ...optionalField("handle", handle),
      ...optionalField("presentation", presentation as "icon" | "copy" | undefined),
    };
  });
}

/**
 * Fill in what a two-field writer (type + URL) cannot supply, and canonicalize
 * VRCDN input before the shared HTTPS check runs.
 *
 * VRCDN is routed through `parseVrcdnStreamLinks` rather than being validated as
 * a plain URL because people paste the player URLs VRCDN hands them, which are
 * `rtspt://` and `.m3u8`/`.live.ts` stream endpoints rather than a web page.
 * Rejecting those as "not HTTPS" would be wrong, and storing them raw would
 * leave the public profile page and issue #217 re-deriving the stream id from a
 * shape they may not recognize. Normalizing to the canonical page URL plus the
 * stream id in `handle` means every reader gets the same thing.
 */
function prepareProfileLink(entry: unknown, index: number): Record<string, unknown> {
  // `source` never reaches the normalizer: provenance is stamped by the caller
  // from the writer's own subject, and `assertOnlyKeys` is left strict so any
  // other stray key is still an error rather than a silent pass.
  const { source: _claimedSource, ...link } = requireRecord(entry, `Outbound link ${index + 1}`);
  const type = requireStringValue(link.type, "Outbound link type");

  if (!isProfileLinkType(type)) {
    throw new Error(`Unsupported outbound link type "${type}".`);
  }

  const rawUrl = requireStringValue(link.url, "Outbound link URL").trim();

  // Rejected rather than truncated: the shared HTTPS helper slices at this
  // length, which would silently store a different destination than the one
  // submitted once a path, query or signed token pushed it over.
  if (rawUrl.length > PROFILE_LINK_URL_MAX_LENGTH) {
    throw new Error(`Outbound link URL must be ${PROFILE_LINK_URL_MAX_LENGTH} characters or fewer.`);
  }
  // A blank label counts as absent: the submit form sends only a type and a
  // URL, and an API caller passing "" means the same thing.
  const label =
    optionalInlineText(
      optionalStringValue(link.label, "Outbound link label"),
      "Outbound link label",
      PROFILE_LINK_LABEL_MAX_LENGTH,
    ) ?? PROFILE_LINK_TYPE_LABELS[type];

  if (type !== "vrcdn") {
    return { ...link, label, url: rawUrl };
  }

  const stream = parseVrcdnStreamLinks(rawUrl);

  if (stream === null) {
    throw new Error("Outbound link URL must be a VRCDN stream URL.");
  }

  return {
    ...link,
    label,
    // The identifier, not an address. Every spelling VRCDN hands out -- the panel
    // preview, the HLS playlist, the Quest transport stream, the RTSP endpoint --
    // says the same stream, and this is the one form that says it without
    // claiming there is a page to open.
    url: stream.reference,
    handle: optionalStringValue(link.handle, "Outbound link handle") ?? stream.streamId,
  };
}

/**
 * Normalize writer-supplied links and stamp provenance.
 *
 * `source` is a parameter rather than a constant because it is rendered as a
 * trust signal. The PATCH API can only be reached by a claimed owner, but the
 * community submit form is one signed-in person adding somebody else's profile,
 * and labelling those links owner-authored would be a straightforward lie.
 */
export function sanitizeProfileLinks(
  value: unknown,
  source: ProfileLinkSource,
): Array<NormalizedProfileLink & { source: ProfileLinkSource }> {
  try {
    const links = requireArrayValue(value, "Outbound links");

    // Checked before the per-entry pass so an oversized array is rejected
    // without parsing every entry in it first.
    if (links.length > PROFILE_LINK_MAX_COUNT) {
      throw new Error(`Outbound links can include at most ${PROFILE_LINK_MAX_COUNT} values.`);
    }

    return normalizeOutboundLinks(links.map(prepareProfileLink)).map((link) => {
      const allowedDomains = PROFILE_LINK_TYPE_HOSTS[link.type];

      if (allowedDomains !== undefined && !hostMatchesProvider(new URL(link.url).hostname, allowedDomains)) {
        throw new Error(
          `A ${PROFILE_LINK_TYPE_LABELS[link.type]} link must point at ${allowedDomains[0]}.`,
        );
      }

      return { ...link, source };
    });
  } catch (error) {
    // Convex redacts plain `Error` messages on production deployments, so a
    // link problem would otherwise reach the submit form as the generic
    // "backend unreachable" fallback even though it is entirely fixable in the
    // form. The structured payload survives, same as claim errors.
    if (error instanceof ConvexError) {
      throw error;
    }

    throw new ConvexError({
      code: "INVALID_PROFILE_LINK",
      message: error instanceof Error ? error.message : "Outbound links are invalid.",
    });
  }
}

/**
 * What makes two links the same link, as a comparable key.
 *
 * Type plus destination, and only the genuinely case-insensitive parts of the
 * destination are folded -- scheme and host. Lowercasing the whole URL made
 * `https://example.invalid/Mix` and `/mix` one link on hosts where they are two
 * pages: the seed lane dropped the second as a duplicate, and the browser lane
 * handed the first's provenance to the second.
 *
 * One function because both lanes ask the same question. They were written
 * separately and folded differently, which is how the same defect had to be
 * found twice.
 */
/**
 * Hosts whose path is case-insensitive, so two spellings are one destination.
 *
 * The web lookup's own merger keeps the same list for the same reason. Kept
 * small and explicit: this is a claim about a specific provider, not a general
 * rule about URLs.
 */
const CASE_INSENSITIVE_PATH_HOSTS = new Set(["twitch.tv"]);

/**
 * Hosts that address one profile per account, so the spellings of a URL that
 * differ only in `www.` or a trailing slash all name the same destination.
 *
 * Flattened from `PROFILE_LINK_TYPE_HOSTS` rather than restated, so a host
 * counts as a provider here exactly when the type validator already treats it as
 * one, plus VRCDN's own root. Each serves a branded profile in a single account
 * namespace, where `www.twitch.tv/Snek/` and `twitch.tv/Snek` are the same
 * channel by construction.
 *
 * Deliberately not a general rule, and both normalizations were general rules
 * once. `example.com` and `www.example.com` are distinct origins, and `/foo` and
 * `/foo/` are distinct paths a server may answer differently -- a `website` link
 * is exactly where that happens. Folding either everywhere let seed publication
 * drop one of a profile's two real links as a duplicate, and let an edit to one
 * inherit the other's metadata and provenance.
 */
const SINGLE_PROFILE_HOSTS = new Set([
  ...Object.values(PROFILE_LINK_TYPE_HOSTS).flatMap((hosts) => hosts ?? []),
  "vrcdn.live",
]);

export function profileLinkDestinationKey(link: { type: string; url: string }): string {
  try {
    const url = new URL(link.url);
    // `www.` dropped only where the two spellings are known to be one place.
    // Branded provider links carry it -- `www.twitch.tv/Snek` is the same channel
    // as `twitch.tv/snek` -- so leaving it on failed the host lookups below *and*
    // made the two spellings different destinations. Stripping it for every host
    // ran too far the other way: on an arbitrary `website` link the apex and the
    // `www` origin are two addresses that may serve two pages.
    const apex = url.host.replace(/^www\./i, "");
    const singleProfileHost = SINGLE_PROFILE_HOSTS.has(apex);
    const host = singleProfileHost ? apex : url.host;
    // Some hosts say their path is case-insensitive, and Twitch is one. Keeping
    // the case there left the seed lane publishing both spellings as separate
    // buttons and the browser lane failing the provenance match on a case-only
    // correction.
    //
    // A named list rather than folding every path, because the general case runs
    // the other way -- on most hosts `/Mix` and `/mix` are two pages, which is
    // the defect this key was written to fix.
    // Trailing slashes dropped on the same hosts and for the same reason:
    // `twitch.tv/snek/` and `twitch.tv/snek` are one channel, and a seed carrying
    // both spellings published two buttons and reported no duplicate. Elsewhere
    // `/foo` and `/foo/` are two paths a server may answer differently, so they
    // stay two destinations.
    const pathname = singleProfileHost ? url.pathname.replace(/\/+$/, "") || "/" : url.pathname;
    const path = CASE_INSENSITIVE_PATH_HOSTS.has(host) ? pathname.toLowerCase() : pathname;

    // `URL` lowercases protocol and host itself; the rest is used exactly as
    // given rather than folded along with them.
    return `${link.type}:${url.protocol}//${host}${path}${url.search}${url.hash}`;
  } catch {
    // Unparseable, so no part of it is known to be case-insensitive. Compared
    // verbatim, which can only ever treat two links as distinct rather than
    // merge them.
    return `${link.type}:${link.url}`;
  }
}

export type LenientProfileLinkResult = {
  links: Array<NormalizedProfileLink & { source: ProfileLinkSource }>;
  /** Entries that could not be normalized into a publishable link. */
  droppedCount: number;
  /** Entries that collapsed onto a link already in the list. */
  deduplicatedCount: number;
};

/**
 * Normalize links one at a time, keeping the ones that survive.
 *
 * `sanitizeProfileLinks` rejects the whole array, which is right for a writer
 * who is looking at a form and can fix their input. A seed publication has no
 * such writer: the export was produced elsewhere, possibly months earlier, and
 * one unusable row must not hold back every profile in the batch.
 *
 * Normalization is the point, not just validation. VRCDN entries collapse onto
 * the canonical `vrcdn.live/<id>` page URL, so a stream URL and an operator
 * panel preview URL for the same DJ become one link and no preview URL is
 * carried onto a public profile. What is dropped is counted rather than
 * swallowed — a publication path that silently discards data is how this became
 * a problem in the first place.
 */
export function sanitizeProfileLinksLeniently(
  value: unknown,
  source: ProfileLinkSource,
): LenientProfileLinkResult {
  const entries = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const links: LenientProfileLinkResult["links"] = [];
  let droppedCount = 0;
  let deduplicatedCount = 0;

  for (const entry of entries) {
    let normalized: LenientProfileLinkResult["links"];

    try {
      normalized = sanitizeProfileLinks([entry], source);
    } catch {
      droppedCount += 1;
      continue;
    }

    for (const link of normalized) {
      const key = profileLinkDestinationKey(link);

      if (seen.has(key)) {
        deduplicatedCount += 1;
        continue;
      }

      // Counted as dropped rather than silently truncated: the cap is enforced
      // per write everywhere else, and a caller reporting "all links carried"
      // while holding back the tail would be wrong.
      if (links.length >= PROFILE_LINK_MAX_COUNT) {
        droppedCount += 1;
        continue;
      }

      seen.add(key);
      links.push(link);
    }
  }

  return { links, droppedCount, deduplicatedCount };
}
