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
  /**
   * Carried through the form rather than rebuilt.
   *
   * The editor posts the whole link array back, and `sanitizeProfileLinks` fills
   * a provider default for whatever is absent — so a row the user never touched
   * would come back with its custom label replaced, its VRCDN handle dropped,
   * and a copy-styled link turned into a button. There are no controls for these
   * yet; they travel as hidden inputs so an unchanged row survives a save.
   */
  label?: string;
  handle?: string;
  presentation?: string;
};

export type ProfileFieldsDefaults = {
  displayName?: string;
  aliases?: string[];
  tags?: string[];
  headline?: string;
  bio?: string;
  region?: string;
  timezone?: string;
  roleTags?: string[];
  pronouns?: string;
  subtype?: string;
  categoryTags?: string[];
  links?: ProfileLinkInput[];
};

/**
 * Fields describing the person in prose rather than as a list.
 *
 * Rendered by the editor and not by the submit form: creating somebody else's
 * profile is a factual act, and writing their headline and bio for them on the
 * way in is not. Correcting one that already exists is ordinary directory work.
 */
const NARRATIVE_FIELDS = ["headline", "bio", "region", "timezone"] as const;

type NarrativeFields = Partial<Record<(typeof NARRATIVE_FIELDS)[number], string>>;

/**
 * The hidden marker each rendered field group emits.
 *
 * The update path reads every key it receives as an instruction, so a field the
 * form did not render must be absent from the payload rather than present and
 * empty -- otherwise opening the editor on a profile whose links you may not
 * edit, and saving a typo fix, deletes them.
 *
 * Emptiness cannot stand in for absence: no link rows means "I removed the last
 * link" just as often as it means "the section was not shown". A marker is the
 * only thing that tells those apart.
 */
export const FIELD_PRESENT_INPUT = "fieldPresent";

function presentFields(formData: FormData): Set<string> {
  return new Set(formData.getAll(FIELD_PRESENT_INPUT).map((value) => String(value)));
}

type SharedFields = {
  displayName: string;
  aliases?: string[];
  tags?: string[];
  outboundLinks?: ProfileLinkInput[];
} & NarrativeFields;

export type ProfileFieldsPayload =
  | (SharedFields & {
      profileType: "person";
      person?: { roleTags: string[]; pronouns?: string };
    })
  | (SharedFields & {
      profileType: "community";
      community?: { subtype: string; categoryTags: string[] };
    });

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
  // The whole link, not just its URL: the dedicated inputs carry its label,
  // handle and presentation through as hidden fields, same as the rows. The
  // index goes with it so an untouched link can be put back where it was rather
  // than surfacing at the front because the form chose to show it there.
  const featured: Partial<Record<ProfileLinkType, ProfileLinkInput & { originalIndex: number }>> = {};
  const rows: ProfileLinkInput[] = [];

  for (const link of links) {
    if (
      featureStreamLinks &&
      (link.type === "vrcdn" || link.type === "twitch") &&
      featured[link.type] === undefined
    ) {
      // Its index among the rows it is being lifted out of, which is where it
      // has to be reinserted for the list to come back unchanged.
      featured[link.type] = { ...link, originalIndex: rows.length };
      continue;
    }

    rows.push(link);
  }

  return { featured, rows };
}

/** Drops the keys the form left blank, so absent stays absent. */
function withLinkMetadata(link: ProfileLinkInput, meta: Partial<ProfileLinkInput>): ProfileLinkInput {
  return {
    ...link,
    ...(meta.label ? { label: meta.label } : {}),
    ...(meta.handle ? { handle: meta.handle } : {}),
    ...(meta.presentation ? { presentation: meta.presentation } : {}),
  };
}

function linksFromFormData(formData: FormData): ProfileLinkInput[] {
  const types = formData.getAll("linkType");
  const urls = formData.getAll("linkUrl");
  const originals = formData.getAll("linkOriginalUrl");
  const originalTypes = formData.getAll("linkOriginalType");
  const labels = formData.getAll("linkLabel");
  const handles = formData.getAll("linkHandle");
  const presentations = formData.getAll("linkPresentation");
  // Rows are uncontrolled, so the lists come back in DOM order and pair by
  // index. Every row emits all five, so they stay aligned even when one is
  // blank. Rows with no URL are dropped rather than rejected.
  const rows = types.flatMap((type, index) => {
    const url = stringField(urls[index] ?? null).trim();

    if (!url) {
      return [];
    }

    const link = { type: stringField(type) as ProfileLinkType, url };
    // Metadata describes the link it came with, so a row that was edited starts
    // clean rather than inheriting the old one's handle. Type counts as much as
    // the URL: switching a twitch.tv row from Website to Twitch keeps the same
    // destination while changing what the label and presentation mean.
    const unchanged =
      stringField(originals[index] ?? null).trim() === url &&
      stringField(originalTypes[index] ?? null) === link.type;

    return [
      withLinkMetadata(link, unchanged
        ? {
            label: stringField(labels[index] ?? null),
            handle: stringField(handles[index] ?? null),
            presentation: stringField(presentations[index] ?? null),
          }
        : {}),
    ];
  });
  const featured = (["vrcdn", "twitch"] as const).flatMap((type) => {
    const url = stringField(formData.get(`${type}Url`)).trim();

    if (!url) {
      return [];
    }

    // Only when the URL is unchanged. Pasting a different stream is a new link,
    // and keeping the old handle or label on it would describe the wrong one.
    const unchanged = stringField(formData.get(`${type}OriginalUrl`)).trim() === url;
    const originalIndex = Number.parseInt(stringField(formData.get(`${type}OriginalIndex`)), 10);

    return [
      {
        // Where it sat before the form pulled it out into its own input. A
        // stream link stored after the generic ones would otherwise come back
        // at the front, rewriting `outboundLinks` on a save that changed
        // nothing and recording "outboundLinks updated" for a reordering the
        // editor did to itself.
        originalIndex: unchanged && Number.isInteger(originalIndex) ? originalIndex : -1,
        link: withLinkMetadata({ type, url }, unchanged
          ? {
              label: stringField(formData.get(`${type}Label`)),
              handle: stringField(formData.get(`${type}Handle`)),
              presentation: stringField(formData.get(`${type}Presentation`)),
            }
          : {}),
      },
    ];
  });

  // A newly entered stream link has no original position, so it goes to the
  // front in the order the form shows it. Ones that were already stored are
  // spliced back where they came from, ascending so each insertion lands before
  // the next index is used and the positions stay meaningful.
  const ordered = [
    ...featured.filter((entry) => entry.originalIndex < 0).map((entry) => entry.link),
    ...rows,
  ];

  for (const { originalIndex, link } of featured
    .filter((entry) => entry.originalIndex >= 0)
    .sort((a, b) => a.originalIndex - b.originalIndex)) {
    ordered.splice(Math.min(originalIndex, ordered.length), 0, link);
  }

  return ordered;
}

export function profileFieldsPayload(
  formData: FormData,
  profileType: ProfileFieldsType,
): ProfileFieldsPayload {
  const present = presentFields(formData);
  const when = <T>(field: string, value: T) => (present.has(field) ? { [field]: value } : {});
  const shared = {
    // Always rendered, and a profile cannot be nameless.
    displayName: stringField(formData.get("displayName")),
    ...when("aliases", splitList(formData.get("aliases"))),
    ...when("tags", splitList(formData.get("tags"))),
    ...when("outboundLinks", linksFromFormData(formData)),
    ...Object.fromEntries(
      NARRATIVE_FIELDS.filter((name) => present.has(name)).map((name) => [
        name,
        stringField(formData.get(name)),
      ]),
    ),
  } as SharedFields;

  if (profileType === "community") {
    return {
      ...shared,
      profileType: "community",
      ...when("community", {
        subtype: stringField(formData.get("subtype")),
        categoryTags: splitList(formData.get("categoryTags")),
      }),
    } as ProfileFieldsPayload;
  }

  return {
    ...shared,
    profileType: "person",
    ...when("person", {
      // Checked boxes first so the common roles keep a stable order, then
      // whatever the freeform field adds. Deduplicated because someone will type
      // "DJ" next to the box they already ticked.
      roleTags: dedupe([
        ...formData.getAll("roleTag").map((value) => stringField(value)),
        ...splitList(formData.get("roleTagsOther")),
      ]),
      // Only when the control was rendered, which is the editor and not the
      // submit form. `submitCommunityProfile` validates `person` as role tags
      // alone, so an always-present `pronouns: ""` is not a harmless empty
      // string there -- Convex rejects the whole argument as an unknown field.
      ...(formData.has("pronouns")
        ? { pronouns: stringField(formData.get("pronouns")) }
        : {}),
    }),
  } as ProfileFieldsPayload;
}
