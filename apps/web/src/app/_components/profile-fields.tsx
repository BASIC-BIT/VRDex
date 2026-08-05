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

/**
 * The parts of a link the form has no control for.
 *
 * A custom label, a VRCDN handle, a copy-styled presentation: none of them are
 * editable here, and the editor posts the whole link array back, so without
 * these an untouched row returns with its label replaced by the provider default
 * and its handle gone. `<originalUrl>` lets the payload builder tell an
 * unchanged link from a newly pasted one, because the metadata describes the old
 * destination and would be wrong on a new one.
 */
function LinkMetadata({
  link,
  name,
}: {
  link?: ProfileLinkInput & { originalIndex: number };
  name: string;
}) {
  if (link === undefined) {
    return null;
  }

  return (
    <>
      <input name={`${name}OriginalUrl`} type="hidden" value={link.url} />
      <input name={`${name}OriginalIndex`} type="hidden" value={link.originalIndex} />
      <input name={`${name}Label`} type="hidden" value={link.label ?? ""} />
      <input name={`${name}Handle`} type="hidden" value={link.handle ?? ""} />
      <input name={`${name}Presentation`} type="hidden" value={link.presentation ?? ""} />
    </>
  );
}

function PersonRoleFields({
  defaults,
  atLinkCap,
  featured,
  selectedRoles,
  showPronouns,
  showStreamFields,
  streamValues,
  setStreamValues,
  onToggleRole,
}: {
  defaults: ProfileFieldsDefaults;
  /** Rows plus filled stream fields already reach `PROFILE_LINK_MAX_COUNT`. */
  atLinkCap: boolean;
  featured: Partial<Record<string, ProfileLinkInput & { originalIndex: number }>>;
  selectedRoles: string[];
  streamValues: { vrcdn: string; twitch: string };
  setStreamValues: (update: (values: { vrcdn: string; twitch: string }) => { vrcdn: string; twitch: string }) => void;
  /** Off on the submit form: creating a profile for someone else does not
   *  extend to declaring their pronouns. Correcting an existing one does. */
  showPronouns: boolean;
  showStreamFields: boolean;
  onToggleRole: (role: string, checked: boolean) => void;
}) {
  const initialRoles = defaults.roleTags ?? [];
  const otherRoles = initialRoles.filter((role) => !PRESET_ROLES.has(role));

  function toggleRole(role: string, checked: boolean) {
    onToggleRole(role, checked);
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

      {/* In the same group as roles because `person` is one editable field, and
          a policy that says pronouns are editable while the form offers no way
          to change them is a promise the UI does not keep. */}
      {showPronouns ? (
        <Field className="sm:max-w-xs">
          Pronouns
          <Input defaultValue={defaults.pronouns ?? ""} maxLength={80} name="pronouns" />
        </Field>
      ) : null}

      {showStreamFields ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Controlled, so the cap can count what is actually in them rather
              than reserving a slot per field. Reserving meant one free slot
              enabled Stream and disabled Twitch, with no way to spend that slot
              on Twitch and the Add-link button hidden by the same reservation.
              An input that already holds a link is never disabled -- a disabled
              input submits nothing, which would delete it. */}
          <Field>
            Stream
            <LinkMetadata link={featured.vrcdn} name="vrcdn" />
            <Input
              disabled={streamValues.vrcdn === "" && atLinkCap}
              maxLength={2048}
              name="vrcdnUrl"
              placeholder="https://vrcdn.live/name"
              type="url"
              value={streamValues.vrcdn}
              onChange={(event) =>
                setStreamValues((values) => ({ ...values, vrcdn: event.target.value }))
              }
            />
          </Field>

          <Field>
            Twitch
            <LinkMetadata link={featured.twitch} name="twitch" />
            <Input
              disabled={streamValues.twitch === "" && atLinkCap}
              maxLength={2048}
              name="twitchUrl"
              placeholder="https://twitch.tv/name"
              type="url"
              value={streamValues.twitch}
              onChange={(event) =>
                setStreamValues((values) => ({ ...values, twitch: event.target.value }))
              }
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
  const { featured, rows } = partitionLinks(defaults.links ?? [], showStreamInputs);
  // Role selection lives here rather than in the roles group, because the link
  // cap below depends on it: the stream fields serialize into the same array the
  // rows do, and counting only rows let a person fill both and add 20 more, then
  // have the whole save rejected for exceeding the cap.
  const [selectedRoles, setSelectedRoles] = useState<string[]>(() =>
    (defaults.roleTags ?? []).filter((role) => PRESET_ROLES.has(role)),
  );
  // Revealed by a streaming role, and kept open whenever the profile already
  // holds one of these links. Otherwise a DJ whose role tags never made it into
  // the record would open the editor to a hidden field and save away the stream
  // link it was holding -- exactly the shape of the 405 seeded profiles, where
  // the links are present and the roles are not visible.
  const showStreamFields =
    showStreamInputs &&
    (isStreamingRole(selectedRoles) ||
      featured.vrcdn !== undefined ||
      featured.twitch !== undefined);
  // Stream fields and rows feed one array, so the cap is shared. Existing
  // stream links are already counted; the reserve is for the empty ones, which
  // can still gain a link.
  //
  // Reserved rather than measured, because the inputs are uncontrolled and what
  // is typed in them is not React state. It can go negative when a hydrated
  // profile already holds more rows than the cap allows -- both consumers read
  // it as "no room", which is the honest answer.
  // Controlled, unlike the rows, because the link cap has to count them: the
  // stream fields and the rows serialize into one array, and reserving a slot
  // per rendered field made one free slot usable by Stream and by nothing else.
  const [streamValues, setStreamValues] = useState(() => ({
    vrcdn: featured.vrcdn?.url ?? "",
    twitch: featured.twitch?.url ?? "",
  }));
  // Stable ids rather than indices: the row inputs are uncontrolled, so keying
  // by index would shift the surviving rows' DOM values when one is removed.
  const linkRowSeq = useRef(rows.length);
  const [linkRows, setLinkRows] = useState<Array<{ id: number; link?: ProfileLinkInput }>>(() =>
    rows.map((link, index) => ({ id: index, link })),
  );
  const filledStreamFields = showStreamFields
    ? (streamValues.vrcdn.trim() === "" ? 0 : 1) + (streamValues.twitch.trim() === "" ? 0 : 1)
    : 0;
  const atLinkCap = linkRows.length + filledStreamFields >= PROFILE_LINK_MAX_COUNT;

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
              <PersonRoleFields
                defaults={defaults}
                featured={featured}
                atLinkCap={atLinkCap}
                selectedRoles={selectedRoles}
                showPronouns={showNarrativeFields}
                showStreamFields={showStreamFields}
                streamValues={streamValues}
                setStreamValues={setStreamValues}
                onToggleRole={(role, checked) =>
                  setSelectedRoles((roles) =>
                    checked ? [...roles, role] : roles.filter((item) => item !== role),
                  )
                }
              />
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
                  {/* Always emitted, blank for a new row, so every list stays
                      index-aligned with the URLs it describes. */}
                  <input name="linkOriginalUrl" type="hidden" value={row.link?.url ?? ""} />
                  <input name="linkOriginalType" type="hidden" value={row.link?.type ?? ""} />
                  <input name="linkLabel" type="hidden" value={row.link?.label ?? ""} />
                  <input name="linkHandle" type="hidden" value={row.link?.handle ?? ""} />
                  <input name="linkPresentation" type="hidden" value={row.link?.presentation ?? ""} />
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

            {!atLinkCap ? (
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
