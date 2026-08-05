import type { ProfileLinkType } from "../../../../../convex/_profileLinks";

/**
 * The shape of the profile field set, without the rendering.
 *
 * Separate from `profile-fields.tsx` so the form-to-payload logic is reachable
 * from a plain test. It is where a profile's links and roles are decided, and
 * getting it wrong loses data silently rather than failing.
 */

export type ProfileFieldsType = "person" | "community";

export type ProfileLinkInput = {
  type: ProfileLinkType;
  url: string;
};

export type ProfileFieldsDefaults = {
  displayName?: string;
  aliases?: string[];
  tags?: string[];
  roleTags?: string[];
  subtype?: string;
  categoryTags?: string[];
  links?: ProfileLinkInput[];
};

export type ProfileFieldsPayload =
  | {
      profileType: "person";
      displayName: string;
      aliases: string[];
      tags: string[];
      outboundLinks: ProfileLinkInput[];
      person: { roleTags: string[] };
    }
  | {
      profileType: "community";
      displayName: string;
      aliases: string[];
      tags: string[];
      outboundLinks: ProfileLinkInput[];
      community: { subtype: string; categoryTags: string[] };
    };

/**
 * Roles offered as checkboxes.
 *
 * A shortcut, not a restriction: anything outside the list still goes in the
 * freeform field beside it. Ordered by how common they are in the directory
 * rather than alphabetically, so the two that unlock stream links come first.
 */
export const PERSON_ROLE_OPTIONS = [
  "DJ",
  "VJ",
  "Producer",
  "Host",
  "Dancer",
  "Photographer",
  "Organizer",
] as const;

/**
 * Roles that stream, and therefore have a VRCDN or Twitch destination worth
 * asking for directly rather than leaving buried in a generic link list.
 */
const STREAMING_ROLES = new Set<string>(["DJ", "VJ"]);

export const PRESET_ROLES = new Set<string>(PERSON_ROLE_OPTIONS);

export function isStreamingRole(roles: Iterable<string>): boolean {
  return [...roles].some((role) => STREAMING_ROLES.has(role));
}

function stringField(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function splitList(value: FormDataEntryValue | null): string[] {
  return stringField(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();

  return values.filter((value) => {
    const key = value.toLowerCase();

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
}

/**
 * Split the dedicated stream inputs out of the generic link rows.
 *
 * The first VRCDN and first Twitch link go to the dedicated inputs; further
 * links of those types stay in the rows, so someone with two Twitch links does
 * not lose one by opening the form.
 *
 * `featureStreamLinks` is false for a community profile, which has no roles and
 * so never renders those inputs. Promoting a link into a field that is not on
 * the page would drop it on the next save.
 */
export function partitionLinks(links: ProfileLinkInput[], featureStreamLinks: boolean) {
  const featured: Partial<Record<ProfileLinkType, string>> = {};
  const rows: ProfileLinkInput[] = [];

  for (const link of links) {
    if (
      featureStreamLinks &&
      (link.type === "vrcdn" || link.type === "twitch") &&
      featured[link.type] === undefined
    ) {
      featured[link.type] = link.url;
      continue;
    }

    rows.push(link);
  }

  return { featured, rows };
}

function linksFromFormData(formData: FormData): ProfileLinkInput[] {
  const types = formData.getAll("linkType");
  const urls = formData.getAll("linkUrl");
  // Rows are uncontrolled, so both lists come back in DOM order and pair by
  // index. Rows left blank are dropped rather than rejected.
  const rows = types.flatMap((type, index) => {
    const url = stringField(urls[index] ?? null).trim();

    return url ? [{ type: stringField(type) as ProfileLinkType, url }] : [];
  });
  const featured = (["vrcdn", "twitch"] as const).flatMap((type) => {
    const url = stringField(formData.get(`${type}Url`)).trim();

    return url ? [{ type, url }] : [];
  });

  return [...featured, ...rows];
}

export function profileFieldsPayload(
  formData: FormData,
  profileType: ProfileFieldsType,
): ProfileFieldsPayload {
  const shared = {
    displayName: stringField(formData.get("displayName")),
    aliases: splitList(formData.get("aliases")),
    tags: splitList(formData.get("tags")),
    outboundLinks: linksFromFormData(formData),
  };

  if (profileType === "community") {
    return {
      ...shared,
      profileType: "community",
      community: {
        subtype: stringField(formData.get("subtype")),
        categoryTags: splitList(formData.get("categoryTags")),
      },
    };
  }

  return {
    ...shared,
    profileType: "person",
    person: {
      // Checked boxes first so the common roles keep a stable order, then
      // whatever the freeform field adds. Deduplicated because someone will type
      // "DJ" next to the box they already ticked.
      roleTags: dedupe([
        ...formData.getAll("roleTag").map((value) => stringField(value)),
        ...splitList(formData.get("roleTagsOther")),
      ]),
    },
  };
}
