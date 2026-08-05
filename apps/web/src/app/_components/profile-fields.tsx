"use client";

import { X } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { CheckboxField, Field, FieldText, Input, Select } from "@/components/ui/field";
import {
  PROFILE_LINK_MAX_COUNT,
  PROFILE_LINK_TYPE_LABELS,
  PROFILE_LINK_TYPES,
  type ProfileLinkType,
} from "../../../../../convex/_profileLinks";

/**
 * The fields a person or community profile carries, shared by the submit form
 * and the editor.
 *
 * One field set rather than two, because the community half of editing exists to
 * fix what submission collected: a role vocabulary or link shape that differed
 * between them would mean the same profile could be described one way when
 * created and another way when corrected.
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
 * asking for directly instead of leaving buried in a generic link list.
 */
const STREAMING_ROLES = new Set<string>(["DJ", "VJ"]);

const PRESET_ROLES = new Set<string>(PERSON_ROLE_OPTIONS);

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
 * The first link of a given type, which is what the dedicated input holds.
 *
 * Any further links of that type stay in the generic rows, so an editor with two
 * Twitch links does not lose one by opening the form.
 */
function partitionLinks(links: ProfileLinkInput[]) {
  const featured: Partial<Record<ProfileLinkType, string>> = {};
  const rows: ProfileLinkInput[] = [];

  for (const link of links) {
    if ((link.type === "vrcdn" || link.type === "twitch") && featured[link.type] === undefined) {
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
      // whatever the freeform field adds. Deduplicated because someone will
      // type "DJ" next to the box they already ticked.
      roleTags: dedupe([
        ...formData.getAll("roleTag").map((value) => stringField(value)),
        ...splitList(formData.get("roleTagsOther")),
      ]),
    },
  };
}

function PersonRoleFields({ defaults }: { defaults: ProfileFieldsDefaults }) {
  const initialRoles = defaults.roleTags ?? [];
  const [selectedRoles, setSelectedRoles] = useState<string[]>(() =>
    initialRoles.filter((role) => PRESET_ROLES.has(role)),
  );
  const otherRoles = initialRoles.filter((role) => !PRESET_ROLES.has(role));
  const { featured } = partitionLinks(defaults.links ?? []);

  function toggleRole(role: string, checked: boolean) {
    setSelectedRoles((roles) => (checked ? [...roles, role] : roles.filter((item) => item !== role)));
  }

  return (
    <>
      <div className="grid gap-3">
        <span className="text-sm font-medium">Roles</span>
        <div className="flex flex-wrap gap-2">
          {PERSON_ROLE_OPTIONS.map((role) => (
            <CheckboxField
              checked={selectedRoles.includes(role)}
              key={role}
              name="roleTag"
              value={role}
              onChange={(event) => toggleRole(role, event.target.checked)}
            >
              {role}
            </CheckboxField>
          ))}
        </div>
        <Field>
          <FieldText>Other roles</FieldText>
          <Input defaultValue={otherRoles.join(", ")} name="roleTagsOther" placeholder="Comma-separated" />
        </Field>
      </div>

      {isStreamingRole(selectedRoles) ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            Stream
            <Input
              defaultValue={featured.vrcdn ?? ""}
              maxLength={2048}
              name="vrcdnUrl"
              placeholder="https://vrcdn.live/name"
              type="url"
            />
          </Field>

          <Field>
            Twitch
            <Input
              defaultValue={featured.twitch ?? ""}
              maxLength={2048}
              name="twitchUrl"
              placeholder="https://twitch.tv/name"
              type="url"
            />
          </Field>
        </div>
      ) : null}
    </>
  );
}

export function ProfileFields({
  defaults = {},
  profileType,
}: {
  defaults?: ProfileFieldsDefaults;
  profileType: ProfileFieldsType;
}) {
  const { rows } = partitionLinks(defaults.links ?? []);
  // Stable ids rather than indices: the inputs are uncontrolled, so keying by
  // index would shift the surviving rows' DOM values when one is removed.
  const linkRowSeq = useRef(rows.length);
  const [linkRows, setLinkRows] = useState<Array<{ id: number; link?: ProfileLinkInput }>>(() =>
    rows.map((link, index) => ({ id: index, link })),
  );

  function addLinkRow() {
    linkRowSeq.current += 1;
    setLinkRows((current) => [...current, { id: linkRowSeq.current }]);
  }

  function removeLinkRow(rowId: number) {
    setLinkRows((current) => current.filter((row) => row.id !== rowId));
  }

  return (
    <>
      <Field>
        Display name
        <Input defaultValue={defaults.displayName ?? ""} name="displayName" placeholder="DJ Celine" required />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          Aliases
          <Input
            defaultValue={(defaults.aliases ?? []).join(", ")}
            name="aliases"
            placeholder="Comma-separated names"
          />
        </Field>

        <Field>
          Tags
          <Input
            defaultValue={(defaults.tags ?? []).join(", ")}
            name="tags"
            placeholder="house, trance, vrchat"
          />
        </Field>
      </div>

      {profileType === "person" ? (
        <PersonRoleFields defaults={defaults} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            Community subtype
            <Input defaultValue={defaults.subtype ?? ""} name="subtype" placeholder="Club, collective, venue" />
          </Field>

          <Field>
            Community categories
            <Input
              defaultValue={(defaults.categoryTags ?? []).join(", ")}
              name="categoryTags"
              placeholder="events, music, hangout"
            />
          </Field>
        </div>
      )}

      <div className="grid gap-3">
        <span className="text-sm font-medium">Links</span>

        {linkRows.map((row) => (
          <div className="flex items-end gap-3" key={row.id}>
            <Field className="w-44 shrink-0">
              <FieldText>Type</FieldText>
              <Select defaultValue={row.link?.type ?? "website"} name="linkType">
                {PROFILE_LINK_TYPES.map((linkType) => (
                  <option key={linkType} value={linkType}>
                    {PROFILE_LINK_TYPE_LABELS[linkType]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field className="flex-1">
              <FieldText>URL</FieldText>
              <Input
                defaultValue={row.link?.url ?? ""}
                maxLength={2048}
                name="linkUrl"
                placeholder="https://soundcloud.com/name"
                type="url"
              />
            </Field>

            <Button
              aria-label="Remove link"
              className="size-11 shrink-0 p-0"
              type="button"
              variant="ghost"
              onClick={() => removeLinkRow(row.id)}
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          </div>
        ))}

        {linkRows.length < PROFILE_LINK_MAX_COUNT ? (
          <div>
            <Button size="sm" type="button" variant="secondary" onClick={addLinkRow}>
              Add link
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}
