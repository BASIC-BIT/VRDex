import type { Doc, Id } from "./_generated/dataModel";
import { normalizeSafePrivateSeedFieldValue } from "./_seedImports";

type PersonProfile = Extract<Doc<"profiles">, { profileType: "person" }>;

const HANDOFF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

export function requireSecureHandoffToken(token: string): string {
  const normalized = token.trim();

  if (!HANDOFF_TOKEN_PATTERN.test(normalized)) {
    throw new Error("Handoff invitation token is invalid.");
  }

  return normalized;
}

export async function hashHandoffToken(token: string): Promise<string> {
  const value = new TextEncoder().encode(requireSecureHandoffToken(token));
  const digest = await crypto.subtle.digest("SHA-256", value);

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const HANDOFF_FIELD_LABELS: Record<string, string> = {
  aliases: "Aliases",
  tags: "Tags",
  genres: "Genres",
  headline: "Headline",
  bio: "Bio",
  about: "About",
  outboundLinks: "Links",
  region: "Region",
  timezone: "Timezone",
  "person.pronouns": "Pronouns",
  "person.roleTags": "Roles",
};

export function projectHandoffPreviewField(
  field: Doc<"seedImportCandidateFields">,
) {
  try {
    const normalized = normalizeSafePrivateSeedFieldValue(field.fieldKey, field.value);

    if (field.fieldKey === "outboundLinks") {
      const links = normalized as Array<{ label: string; url: string }>;
      const singleLink = links.length === 1 ? links[0] : undefined;

      return {
        id: field._id,
        label: singleLink?.label ?? HANDOFF_FIELD_LABELS[field.fieldKey] ?? "Link",
        value: singleLink?.label ?? links.map((link) => link.label).join(", "),
        kind: singleLink === undefined ? ("list" as const) : ("link" as const),
        ...(singleLink !== undefined ? { url: singleLink.url } : {}),
        selectedByDefault: true,
      };
    }

    if (Array.isArray(normalized)) {
      return {
        id: field._id,
        label: HANDOFF_FIELD_LABELS[field.fieldKey] ?? "Profile field",
        value: normalized.join(", "),
        kind: "list" as const,
        selectedByDefault: true,
      };
    }

    return {
      id: field._id,
      label: HANDOFF_FIELD_LABELS[field.fieldKey] ?? "Profile field",
      value: String(normalized),
      kind: "text" as const,
      selectedByDefault: true,
    };
  } catch {
    return null;
  }
}

export function selectHandoffFields(
  offeredFields: Doc<"seedImportCandidateFields">[],
  selectedFieldIds: Id<"seedImportCandidateFields">[],
) {
  const selectedIds = new Set(selectedFieldIds);
  if (selectedIds.size !== selectedFieldIds.length) {
    throw new Error("Selected handoff field ids must be unique.");
  }

  const fieldsById = new Map(offeredFields.map((field) => [field._id, field]));
  const selectedFields = selectedFieldIds.map((fieldId) => {
    const field = fieldsById.get(fieldId);
    if (field === undefined) {
      throw new Error("A selected field is not offered by this invitation.");
    }
    return field;
  });

  for (const field of selectedFields) {
    normalizeSafePrivateSeedFieldValue(field.fieldKey, field.value);
  }

  return selectedFields;
}

function genreSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "genre";
}

function visibilityKeyForSeedField(fieldKey: string) {
  if (fieldKey === "person.pronouns") {
    return "personPronouns" as const;
  }
  if (fieldKey === "person.roleTags") {
    return "personRoleTags" as const;
  }
  return fieldKey as keyof NonNullable<PersonProfile["fieldVisibility"]>;
}

export function buildConciergeProfileFieldPatch(
  fields: Doc<"seedImportCandidateFields">[],
  profile?: PersonProfile,
): Partial<PersonProfile> {
  const patch: Partial<PersonProfile> = {};
  const fieldVisibility: NonNullable<PersonProfile["fieldVisibility"]> = {
    ...(profile?.fieldVisibility ?? {}),
  };
  let person = profile?.person ?? { roleTags: [] };
  let personChanged = false;

  for (const field of fields) {
    const value = normalizeSafePrivateSeedFieldValue(field.fieldKey, field.value);
    fieldVisibility[visibilityKeyForSeedField(field.fieldKey)] = "private";

    switch (field.fieldKey) {
      case "aliases":
        patch.aliases = value as string[];
        break;
      case "tags":
        patch.tags = value as string[];
        break;
      case "genres":
        patch.genres = (value as string[]).map((displayName) => ({
          slug: genreSlug(displayName),
          displayName,
          source: "owner_selected" as const,
          confidence: "high" as const,
          explicit: false,
        }));
        break;
      case "headline":
      case "bio":
      case "about":
      case "region":
      case "timezone":
        patch[field.fieldKey] = value as string;
        break;
      case "outboundLinks":
        patch.outboundLinks = (value as Array<Record<string, unknown>>).map((link) => ({
          ...(link as Omit<NonNullable<PersonProfile["outboundLinks"]>[number], "source">),
          source: "partner_provided" as const,
        }));
        break;
      case "person.pronouns":
        person = { ...person, pronouns: value as string };
        personChanged = true;
        break;
      case "person.roleTags":
        person = { ...person, roleTags: value as string[] };
        personChanged = true;
        break;
    }
  }

  if (personChanged) {
    patch.person = person;
  }
  patch.fieldVisibility = fieldVisibility;

  return patch;
}
