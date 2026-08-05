"use client";

import { X } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { CheckboxField, Field, FieldText, Input, Select, Textarea } from "@/components/ui/field";
import {
  PROFILE_LINK_MAX_COUNT,
  PROFILE_LINK_TYPE_LABELS,
  PROFILE_LINK_TYPES,
} from "../../../../../convex/_profileLinks";
import {
  isStreamingRole,
  partitionLinks,
  PERSON_ROLE_OPTIONS,
  PRESET_ROLES,
  type ProfileFieldsDefaults,
  type ProfileFieldsType,
  type ProfileLinkInput,
} from "./profile-fields-model";

/**
 * The fields a person or community profile carries, shared by the submit form
 * and the editor.
 *
 * One field set rather than two, because the community half of editing exists to
 * fix what submission collected: a role vocabulary or link shape that differed
 * between them would mean the same profile could be described one way when
 * created and another way when corrected.
 *
 * The form-to-payload half lives in `profile-fields-model.ts` so it is reachable
 * from a plain test.
 */

function PersonRoleFields({ defaults }: { defaults: ProfileFieldsDefaults }) {
  const initialRoles = defaults.roleTags ?? [];
  const [selectedRoles, setSelectedRoles] = useState<string[]>(() =>
    initialRoles.filter((role) => PRESET_ROLES.has(role)),
  );
  const otherRoles = initialRoles.filter((role) => !PRESET_ROLES.has(role));
  const { featured } = partitionLinks(defaults.links ?? [], true);
  // Revealed by a streaming role, and kept open whenever the profile already
  // holds one of these links. Otherwise a DJ whose role tags never made it into
  // the record would open the editor to a hidden field and save away the stream
  // link it was holding -- which is exactly the shape of the 405 seeded
  // profiles, where the links are present and the roles are not visible.
  const hasFeaturedLink = featured.vrcdn !== undefined || featured.twitch !== undefined;

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

      {isStreamingRole(selectedRoles) || hasFeaturedLink ? (
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
  showNarrativeFields = false,
}: {
  defaults?: ProfileFieldsDefaults;
  profileType: ProfileFieldsType;
  /**
   * Headline, bio, region and timezone. On for the editor and off for the submit
   * form: creating somebody else's profile is a factual act, and writing their
   * headline for them on the way in is not. Correcting one that already exists
   * is ordinary directory work.
   */
  showNarrativeFields?: boolean;
}) {
  const { rows } = partitionLinks(defaults.links ?? [], profileType === "person");
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

      {showNarrativeFields ? (
        <>
          <Field>
            Headline
            <Input defaultValue={defaults.headline ?? ""} maxLength={160} name="headline" />
          </Field>

          <Field>
            Bio
            <Textarea defaultValue={defaults.bio ?? ""} maxLength={600} name="bio" rows={4} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              Region
              <Input defaultValue={defaults.region ?? ""} maxLength={80} name="region" />
            </Field>

            <Field>
              Timezone
              <Input defaultValue={defaults.timezone ?? ""} maxLength={80} name="timezone" />
            </Field>
          </div>
        </>
      ) : null}

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
