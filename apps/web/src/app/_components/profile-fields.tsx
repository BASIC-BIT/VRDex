"use client";

import { X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { CheckboxField, Field, FieldText, Input, Select, Textarea } from "@/components/ui/field";
import {
  PROFILE_LINK_MAX_COUNT,
  PROFILE_LINK_TYPE_LABELS,
  PROFILE_LINK_TYPES,
} from "../../../../../convex/_profileLinks";
import {
  FIELD_PRESENT_INPUT,
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

/**
 * A field group, with the marker that tells the payload builder it was rendered.
 *
 * Without the marker, a field the form left out is indistinguishable from one
 * the user emptied, and the update path clears it.
 */
function FieldGroup({ children, field }: { children: ReactNode; field: string }) {
  return (
    <>
      <input name={FIELD_PRESENT_INPUT} type="hidden" value={field} />
      {children}
    </>
  );
}

function PersonRoleFields({
  defaults,
  showStreamInputs,
}: {
  defaults: ProfileFieldsDefaults;
  showStreamInputs: boolean;
}) {
  const initialRoles = defaults.roleTags ?? [];
  const [selectedRoles, setSelectedRoles] = useState<string[]>(() =>
    initialRoles.filter((role) => PRESET_ROLES.has(role)),
  );
  const otherRoles = initialRoles.filter((role) => !PRESET_ROLES.has(role));
  const { featured } = partitionLinks(defaults.links ?? [], showStreamInputs);
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

      {showStreamInputs && (isStreamingRole(selectedRoles) || hasFeaturedLink) ? (
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
  editableFields,
  profileType,
  showNarrativeFields = false,
}: {
  defaults?: ProfileFieldsDefaults;
  /**
   * The fields this writer may change, from `profiles:editableProfile`. Absent
   * means all of them, which is the submit form creating a new profile.
   *
   * Asked of the backend rather than decided here: `canEditProfileField` is what
   * the mutation enforces, and a second copy of that rule in the form would
   * drift from it.
   */
  editableFields?: readonly string[];
  profileType: ProfileFieldsType;
  /**
   * Headline, bio, region and timezone. On for the editor and off for the submit
   * form: creating somebody else's profile is a factual act, and writing their
   * headline for them on the way in is not. Correcting one that already exists
   * is ordinary directory work.
   */
  showNarrativeFields?: boolean;
}) {
  const canEdit = (field: string) => editableFields === undefined || editableFields.includes(field);
  // The stream inputs live inside the roles group and write into the link list,
  // so they only exist when both are editable. The partition has to agree with
  // that: a link promoted out of the rows and into a field that never renders is
  // a link deleted on the next save.
  const showStreamInputs =
    profileType === "person" && canEdit("person") && canEdit("outboundLinks");
  const { rows } = partitionLinks(defaults.links ?? [], showStreamInputs);
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
        {canEdit("aliases") ? (
          <FieldGroup field="aliases">
            <Field>
              Aliases
              <Input
                defaultValue={(defaults.aliases ?? []).join(", ")}
                name="aliases"
                placeholder="Comma-separated names"
              />
            </Field>
          </FieldGroup>
        ) : null}

        {canEdit("tags") ? (
          <FieldGroup field="tags">
            <Field>
              Tags
              <Input
                defaultValue={(defaults.tags ?? []).join(", ")}
                name="tags"
                placeholder="house, trance, vrchat"
              />
            </Field>
          </FieldGroup>
        ) : null}
      </div>

      {showNarrativeFields && canEdit("headline") ? (
        <FieldGroup field="headline">
          <Field>
            Headline
            <Input defaultValue={defaults.headline ?? ""} maxLength={160} name="headline" />
          </Field>
        </FieldGroup>
      ) : null}

      {showNarrativeFields && canEdit("bio") ? (
        <FieldGroup field="bio">
          <Field>
            Bio
            <Textarea defaultValue={defaults.bio ?? ""} maxLength={600} name="bio" rows={4} />
          </Field>
        </FieldGroup>
      ) : null}

      {showNarrativeFields ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {canEdit("region") ? (
            <FieldGroup field="region">
              <Field>
                Region
                <Input defaultValue={defaults.region ?? ""} maxLength={80} name="region" />
              </Field>
            </FieldGroup>
          ) : null}

          {canEdit("timezone") ? (
            <FieldGroup field="timezone">
              <Field>
                Timezone
                <Input defaultValue={defaults.timezone ?? ""} maxLength={80} name="timezone" />
              </Field>
            </FieldGroup>
          ) : null}
        </div>
      ) : null}

      {profileType === "person"
        ? canEdit("person") && (
            <FieldGroup field="person">
              <PersonRoleFields defaults={defaults} showStreamInputs={showStreamInputs} />
            </FieldGroup>
          )
        : canEdit("community") && (
            <FieldGroup field="community">
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
            </FieldGroup>
          )}

      {canEdit("outboundLinks") ? (
        <FieldGroup field="outboundLinks">
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
        </FieldGroup>
      ) : null}
    </>
  );
}
