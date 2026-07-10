import { validateSignInReturnTo } from "../../../lib/safe-return-to";

export type HandoffField = {
  id: string;
  label: string;
  value: string;
  kind: "link" | "link_list" | "text";
  url?: string;
  links?: Array<{ label: string; url: string }>;
  selectedByDefault: boolean;
};

export type HandoffPreview =
  | { state: "invalid" | "expired" | "revoked" }
  | { state: "accepted"; ownerDestination?: string }
  | {
      state: "ready";
      displayName: string;
      profileType?: "community" | "person";
      sourceName?: string;
      expiresAt?: number;
      fields: HandoffField[];
    };

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function stringValue(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function numberValue(...values: unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === "number" && Number.isFinite(value));
}

export function safeExternalHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function normalizeField(value: unknown): HandoffField | null {
  const field = record(value);

  if (!field) {
    return null;
  }

  const id = stringValue(field.id, field.fieldId, field._id);
  const label = stringValue(field.label, field.displayLabel, field.fieldType, field.key);
  const rawLinks = Array.isArray(field.links) ? field.links : [];
  const links = rawLinks.flatMap((value) => {
    const link = record(value);
    const label = link ? stringValue(link.label, link.type) : undefined;
    const url = link ? safeExternalHttpUrl(link.url) : undefined;

    return label && url ? [{ label, url }] : [];
  });
  const rawValue = stringValue(field.value, field.displayValue, field.handle) ?? (
    links.length > 0 ? `${links.length} prepared links` : undefined
  );

  if (!id || !label || !rawValue) {
    return null;
  }

  const url = safeExternalHttpUrl(field.url) ?? safeExternalHttpUrl(rawValue);
  const explicitKind = stringValue(field.kind, field.valueType);

  return {
    id,
    label,
    value: rawValue,
    kind: explicitKind === "link_list" && links.length > 0
      ? "link_list"
      : explicitKind === "link" || url
        ? "link"
        : "text",
    ...(url ? { url } : {}),
    ...(links.length > 0 ? { links } : {}),
    selectedByDefault: field.selectedByDefault !== false,
  };
}

function collectFields(source: UnknownRecord, identity: UnknownRecord): HandoffField[] {
  const rawFields = [identity.fields, identity.safeFields, source.fields, source.safeFields]
    .find((candidate): candidate is unknown[] => Array.isArray(candidate)) ?? [];
  const rawLinks = [identity.links, identity.safeLinks, source.links, source.safeLinks]
    .find((candidate): candidate is unknown[] => Array.isArray(candidate)) ?? [];

  return [...rawFields, ...rawLinks]
    .map(normalizeField)
    .filter((field): field is HandoffField => field !== null)
    .filter((field, index, fields) => fields.findIndex((candidate) => candidate.id === field.id) === index);
}

export function normalizeHandoffPreview(value: unknown, now = Date.now()): HandoffPreview {
  const source = record(value);

  if (!source) {
    return { state: "invalid" };
  }

  const rawState = stringValue(source.state, source.status)?.toLowerCase().replaceAll("-", "_");

  if (rawState === "expired" || rawState === "revoked") {
    return { state: rawState };
  }

  if (rawState === "invalid" || rawState === "not_found") {
    return { state: "invalid" };
  }

  if (rawState === "accepted" || rawState === "already_accepted" || rawState === "used") {
    return {
      state: "accepted",
      ...normalizeOwnerDestination(source),
    };
  }

  if (rawState !== "ready" && rawState !== "available" && rawState !== "active" && rawState !== "pending") {
    return { state: "invalid" };
  }

  const identity = record(source.preparedIdentity) ?? record(source.identity) ?? record(source.profile) ?? source;
  const invitation = record(source.invitation) ?? source;
  const displayName = stringValue(identity.displayName, identity.name, source.displayName);
  const expiresAt = numberValue(invitation.expiresAt, source.expiresAt);

  if (!displayName) {
    return { state: "invalid" };
  }

  if (expiresAt !== undefined && expiresAt <= now) {
    return { state: "expired" };
  }

  const profileTypeValue = stringValue(identity.profileType, identity.type);
  const profileType = profileTypeValue === "person" || profileTypeValue === "community"
    ? profileTypeValue
    : undefined;
  const sourceName = stringValue(identity.sourceName, source.sourceName, invitation.sourceName);

  return {
    state: "ready",
    displayName,
    ...(profileType ? { profileType } : {}),
    ...(sourceName ? { sourceName } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    fields: collectFields(source, identity),
  };
}

export function normalizeOwnerDestination(value: unknown): { ownerDestination?: string } {
  const source = record(value);
  const candidate = source
    ? stringValue(source.ownerDestination, source.destination, source.profilePath)
    : undefined;

  if (!candidate) {
    return {};
  }

  const ownerDestination = validateSignInReturnTo(candidate, "");
  return ownerDestination ? { ownerDestination } : {};
}
