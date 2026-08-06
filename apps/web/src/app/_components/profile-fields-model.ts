import {
  profileLinkDestinationKey,
  type ProfileLinkType,
} from "../../../../../convex/_profileLinks";

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
  /**
   * The provenance this row arrived with, echoed back so the backend can tell an
   * untouched link from a new one. It is a claim, not an assertion: the mutation
   * honours it only against a stored link that actually carries it.
   */
  source?: string;
};

/** A stored link plus where it sat in `outboundLinks` before the form split it up. */
export type PositionedProfileLink = ProfileLinkInput & { originalIndex: number };

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

/**
 * The hidden input each comma-joined list carries: what it was rendered from.
 *
 * A comma-separated control cannot represent a value containing a comma, and the
 * backend allows one -- so hydrating `["Foo, Jr."]` and saving an unrelated field
 * split it into `["Foo", "Jr."]` and wrote that, quietly, over a name somebody
 * had presumably typed carefully.
 *
 * So the original array travels beside the text. If the text still reads exactly
 * as the form rendered it, nobody touched the control and the original goes back
 * unchanged; the moment it differs, the comma split is what the writer means. It
 * still cannot *create* a value containing a comma, which is a limitation of the
 * control rather than something to fix by guessing.
 */
const LIST_ORIGINAL_SUFFIX = "Original";

export function listFieldValue(values: string[]): string {
  return values.join(", ");
}

function parseList(formData: FormData, name: string): string[] {
  const text = stringField(formData.get(name));
  const original = formData.get(`${name}${LIST_ORIGINAL_SUFFIX}`);

  if (typeof original === "string") {
    try {
      const stored = JSON.parse(original) as unknown;

      if (Array.isArray(stored) && listFieldValue(stored as string[]) === text.trim()) {
        return stored as string[];
      }
    } catch {
      // Not parseable, so there is nothing to preserve. The split below stands.
    }
  }

  return splitList(text);
}

/**
 * The role list to submit: the stored one when the controls were not touched,
 * and the reconstructed one otherwise.
 *
 * Reconstruction cannot preserve order, because the form splits roles across
 * checkboxes and a freeform field and reassembles them checkboxes-first. Any
 * profile whose stored order differs from that -- which is every profile whose
 * roles were not entered through this form -- was rewritten on a save about
 * something else.
 *
 * Compared as a set, since that is what the controls can actually change: same
 * roles means nobody touched them, whatever order they came back in.
 */
function sameRoleSet(formData: FormData): string[] {
  const rebuilt = dedupe([
    ...formData.getAll("roleTag").map((value) => stringField(value)),
    ...parseList(formData, "roleTagsOther"),
  ]);
  const original = formData.get("roleTagsStored");

  if (typeof original === "string") {
    try {
      const stored = JSON.parse(original) as unknown;

      if (Array.isArray(stored)) {
        const storedRoles = stored as string[];
        // Order ignored, spelling not. Case-folding here declared `resident` and
        // `Resident` one set, so a save whose whole purpose was fixing the
        // capitalization of a custom role returned the stored spelling and
        // reported success -- and replacing a lowercase custom value with the
        // canonical preset checkbox did the same. Only a genuinely untouched
        // set keeps the stored order.
        const key = (values: string[]) => [...values].sort().join("\u0000");

        if (key(storedRoles) === key(rebuilt)) {
          return storedRoles;
        }
      }
    } catch {
      // Not parseable, so there is no stored order to keep.
    }
  }

  return rebuilt;
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
  const featured: Partial<Record<ProfileLinkType, PositionedProfileLink>> = {};
  const rows: PositionedProfileLink[] = [];

  for (const [index, link] of links.entries()) {
    if (
      featureStreamLinks &&
      (link.type === "vrcdn" || link.type === "twitch") &&
      featured[link.type] === undefined
    ) {
      // Its index in the whole list, not among the rows it is leaving. Two
      // adjacent stream links both saw the same row count, so reinserting them
      // at that shared position swapped their order and rewrote the array on a
      // save that changed nothing.
      featured[link.type] = { ...link, originalIndex: index };
      continue;
    }

    // Rows carry it too, so the two can be merged back by original position.
    // Placing a stream link at its absolute index inside a row array that had
    // shrunk put it after rows it used to precede: deleting the first of
    // [SoundCloud, Twitch, Bandcamp] moved Twitch behind Bandcamp, turning one
    // removal into a reorder of links nobody touched.
    rows.push({ ...link, originalIndex: index });
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
    ...(meta.source ? { source: meta.source } : {}),
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
  const sources = formData.getAll("linkSource");
  const rowIndexes = formData.getAll("linkOriginalIndex");
  // Rows are uncontrolled, so the lists come back in DOM order and pair by
  // index. Every row emits all of them, so they stay aligned even when one is
  // blank. Rows with no URL are dropped rather than rejected.
  const rows = types.flatMap((type, index) => {
    const url = stringField(urls[index] ?? null).trim();

    if (!url) {
      return [];
    }

    const link = { type: stringField(type) as ProfileLinkType, url };
    const originalUrl = stringField(originals[index] ?? null).trim();
    const originalType = stringField(originalTypes[index] ?? null);
    // Metadata describes the link it came with, so a row that was edited starts
    // clean rather than inheriting the old one's handle. Type counts as much as
    // the URL: switching a twitch.tv row from Website to Twitch keeps the same
    // destination while changing what the label and presentation mean.
    //
    // Compared by canonical destination rather than by string, using the key the
    // mutation matches provenance with. Retyping `www.twitch.tv/Snek` as
    // `twitch.tv/snek`, or dropping a trailing slash, is the same destination and
    // the metadata still describes it -- but an exact comparison called the row
    // edited and dropped its label, handle and presentation, replacing an
    // operator's wording with provider defaults for a cosmetic correction the
    // backend does not even treat as a change.
    const unchanged =
      originalType === link.type &&
      profileLinkDestinationKey({ type: originalType, url: originalUrl }) ===
        profileLinkDestinationKey(link);

    // Position is a separate question from content, and tying them together made
    // editing a row move it: correcting the first URL of [SoundCloud, Bandcamp]
    // sent that row to the end, because a changed row was treated as a newly
    // added one. A row the editor is still showing first is still first.
    const rowIndex = Number.parseInt(stringField(rowIndexes[index] ?? null), 10);

    return [
      {
        originalIndex: Number.isInteger(rowIndex) ? rowIndex : -1,
        link: withLinkMetadata(link, {
          // Metadata describes the old destination, so an edited row starts
          // clean. `source` is the exception: it is a claim the mutation checks
          // against the *canonical* destination, so it survives a URL edit and
          // lets the backend decide. Dropping it here meant retyping
          // `www.twitch.tv/Snek` as `twitch.tv/snek` -- the same channel, and now
          // the same key -- arrived with no claim at all, and the link was
          // restamped despite the matching this form cannot do.
          //
          // Safe to carry, because a claim is only ever honoured against a stored
          // link that genuinely has it. Sending one that nothing matches gets the
          // writer their own stamp, which is what would have happened anyway.
          ...(unchanged
            ? {
                label: stringField(labels[index] ?? null),
                handle: stringField(handles[index] ?? null),
                presentation: stringField(presentations[index] ?? null),
              }
            : {}),
          source: stringField(sources[index] ?? null),
        }),
      },
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
        //
        // Kept even when the URL changed, same as the rows: pasting a different
        // stream into this field is editing the link that was in it, not adding
        // one somewhere else. Only the metadata below is dropped, because that
        // described the old destination.
        originalIndex: Number.isInteger(originalIndex) ? originalIndex : -1,
        link: withLinkMetadata({ type, url }, {
          // `source` survives a URL edit here for the same reason as the rows:
          // it is a claim the mutation checks against the canonical destination,
          // and the form cannot do that matching itself.
          ...(unchanged
            ? {
                label: stringField(formData.get(`${type}Label`)),
                handle: stringField(formData.get(`${type}Handle`)),
                presentation: stringField(formData.get(`${type}Presentation`)),
              }
            : {}),
          source: stringField(formData.get(`${type}Source`)),
        }),
      },
    ];
  });

  // Everything that was already stored goes back in the order it was stored in,
  // rows and stream links together, ranked by where each one sat in the original
  // array. Splicing stream links into the row array by absolute index only held
  // while no row had been removed: deleting the first of
  // [SoundCloud, Twitch, Bandcamp] left Twitch claiming index 1 of a
  // single-element array, which put it behind Bandcamp -- so removing one link
  // silently reordered another and reported `outboundLinks` changed for it.
  //
  // A newly entered stream link has no original position and goes to the front,
  // where the form shows it. New rows have none either and stay at the end,
  // which is where the form appends them.
  const stored = [...featured, ...rows]
    .filter((entry) => entry.originalIndex >= 0)
    .sort((a, b) => a.originalIndex - b.originalIndex)
    .map((entry) => entry.link);

  return [
    ...featured.filter((entry) => entry.originalIndex < 0).map((entry) => entry.link),
    ...stored,
    ...rows.filter((entry) => entry.originalIndex < 0).map((entry) => entry.link),
  ];
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
    ...when("aliases", parseList(formData, "aliases")),
    ...when("tags", parseList(formData, "tags")),
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
        categoryTags: parseList(formData, "categoryTags"),
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
      //
      // Unless nothing changed, in which case the stored array goes back exactly
      // as it was. The form has no way to express order -- checkboxes then
      // freeform is the order it reconstructs in -- so a profile holding
      // ["Host", "Resident", "DJ"] came back as ["DJ", "Host", "Resident"] on a
      // save about something else. That is a rewrite, an audit entry, and, since
      // the page shows only the first four focus values, a possible change to
      // what it displays.
      roleTags: sameRoleSet(formData),
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
