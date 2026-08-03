import { v } from "convex/values";

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
});

export const PROFILE_LINK_MAX_COUNT = 20;
export const PROFILE_LINK_LABEL_MAX_LENGTH = 120;
export const PROFILE_LINK_HANDLE_MAX_LENGTH = 160;

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
    const url = requireHttpsUrl(
      requireStringValue(link.url, "Outbound link URL"),
      "Outbound link URL",
    );

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
  const link = requireRecord(entry, `Outbound link ${index + 1}`);
  const type = requireStringValue(link.type, "Outbound link type");

  if (!isProfileLinkType(type)) {
    throw new Error(`Unsupported outbound link type "${type}".`);
  }

  const rawUrl = requireStringValue(link.url, "Outbound link URL").trim();
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
    url: stream.pageUrl,
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
  const links = requireArrayValue(value, "Outbound links");

  // Checked before the per-entry pass so an oversized array is rejected without
  // parsing every entry in it first.
  if (links.length > PROFILE_LINK_MAX_COUNT) {
    throw new Error(`Outbound links can include at most ${PROFILE_LINK_MAX_COUNT} values.`);
  }

  return normalizeOutboundLinks(links.map(prepareProfileLink)).map((link) => ({ ...link, source }));
}
