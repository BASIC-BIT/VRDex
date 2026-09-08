"use client";

import { X } from "lucide-react";
import { detectProfileLinkType } from "@/lib/profile-link-detection";
import { labelForEditedDestination } from "@/lib/profile-link-label";
import { parseVrcdnStreamLinks } from "../../../../../convex/_vrcdnLinks";
import { useId, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { CheckboxField, Field, FieldText, Input, Textarea } from "@/components/ui/field";
import {
  PROFILE_LINK_MAX_COUNT,
  PROFILE_LINK_TYPE_LABELS,
  profileLinkDestinationKey,
} from "../../../../../convex/_profileLinks";
import {
  FIELD_PRESENT_INPUT,
  isStreamingRole,
  partitionLinks,
  PERSON_ROLE_OPTIONS,
  PRESET_ROLES,
  type ProfileFieldsDefaults,
  type ProfileFieldsType,
  listFieldValue,
  type PositionedProfileLink,
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
  link?: PositionedProfileLink;
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
      <input name={`${name}Source`} type="hidden" value={link.source ?? ""} />
    </>
  );
}

/**
 * What a comma-joined list was rendered from, so an untouched control round-trips.
 *
 * The control cannot represent a value containing a comma, and the backend allows
 * one, so re-parsing the text split `["Foo, Jr."]` into two entries and wrote
 * that over a name somebody typed deliberately. With the original beside it, text
 * that still reads as rendered means nobody touched the field.
 */
function ListOriginal({ name, values }: { name: string; values: string[] }) {
  return <input name={`${name}Original`} type="hidden" value={JSON.stringify(values)} />;
}


function TimezoneField({ defaultValue }: { defaultValue: string }) {
  const listId = useId();
  const [value, setValue] = useState(defaultValue);
  const [options, setOptions] = useState<string[]>([]);
  return (
    <div className="grid gap-2">
      <Field>
        Timezone
        <Input name="timezone" list={listId} maxLength={80} value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => {
            const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
            setOptions([...new Set([local, "UTC", defaultValue, ...zones].filter(Boolean))]);
          }} />
      </Field>
      <datalist id={listId}>{options.map((zone) => <option key={zone} value={zone} />)}</datalist>
      <Button className="justify-self-start" type="button" variant="secondary"
        onClick={() => setValue(Intl.DateTimeFormat().resolvedOptions().timeZone)}>
        Use local
      </Button>
    </div>
  );
}

function AliasFields({ defaults }: { defaults: string[] }) {
  const nextId = useRef(defaults.length);
  const [rows, setRows] = useState(() => defaults.map((value, id) => ({ id, value })));
  return (
    <div className="grid content-start gap-2">
      <span className="text-sm">Aliases</span>
      <input name="aliasItems" type="hidden" value="true" />
      {rows.map((row) => (
        <div className="flex gap-2" key={row.id}>
          <Input aria-label="Alias" name="alias" defaultValue={row.value} />
          <Button aria-label="Remove alias" type="button" variant="ghost" className="size-11 shrink-0 p-0"
            onClick={() => setRows((current) => current.filter(({ id }) => id !== row.id))}>
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>
      ))}
      <Button className="justify-self-start" type="button" variant="secondary"
        onClick={() => { const id = nextId.current++; setRows((current) => [...current, { id, value: "" }]); }}>
        Add alias
      </Button>
    </div>
  );
}

function LinkRow({ link, onRemove }: { link?: PositionedProfileLink; onRemove: () => void }) {
  const [url, setUrl] = useState(link?.url ?? "");
  const unchanged = link !== undefined && profileLinkDestinationKey({ type: link.type, url }) === profileLinkDestinationKey(link);
  const type = unchanged ? link.type : detectProfileLinkType(url);
  const [labelEdited, setLabelEdited] = useState(false);
  const [customLabel, setCustomLabel] = useState(link?.label ?? "");
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
      <div className="grid gap-2">
        <Field>
          <FieldText>{PROFILE_LINK_TYPE_LABELS[type]}</FieldText>
          <input name="linkLabelEdited" type="hidden" value={String(labelEdited)} />
          <input name="linkType" type="hidden" value={type} />
          <input name="linkOriginalUrl" type="hidden" value={link?.url ?? ""} />
          <input name="linkOriginalType" type="hidden" value={link?.type ?? ""} />
          <input name="linkOriginalIndex" type="hidden" value={link?.originalIndex ?? -1} />
          <input name="linkHandle" type="hidden" value={link?.handle ?? ""} />
          <input name="linkPresentation" type="hidden" value={link?.presentation ?? ""} />
          <input name="linkSource" type="hidden" value={link?.source ?? ""} />
          <Input name="linkUrl" type="url" value={url} maxLength={2048} placeholder="https://"
            onChange={(event) => {
              const next = event.target.value;
              setCustomLabel(labelForEditedDestination(link, next, customLabel, labelEdited));
              setUrl(next);
            }} />
        </Field>
        {type === "website" || type === "other" || type === "generic_store" || type === "commissions" || type === "woocommerce" ? (
          <Field>
            <FieldText>Label</FieldText>
            <Input name="linkLabel" value={customLabel} onChange={(event) => { setCustomLabel(event.target.value); setLabelEdited(true); }} />
          </Field>
        ) : <input name="linkLabel" type="hidden" value={unchanged ? link?.label ?? "" : ""} />}
      </div>
      <Button aria-label="Remove link" className="mt-6 size-11 shrink-0 p-0" type="button" variant="ghost" onClick={onRemove}>
        <X aria-hidden="true" className="size-4" />
      </Button>
    </div>
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
  featured: Partial<Record<string, PositionedProfileLink>>;
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
        {/* The whole stored array, so an untouched control round-trips its
            order. The form splits roles across checkboxes and this field and
            reassembles them checkboxes-first, which rewrites any profile whose
            roles did not originate here. */}
        <input name="roleTagsStored" type="hidden" value={JSON.stringify(initialRoles)} />
        <Field>
          <FieldText>Other roles</FieldText>
          <ListOriginal name="roleTagsOther" values={otherRoles} />
          <Input defaultValue={listFieldValue(otherRoles)} name="roleTagsOther" placeholder="Comma-separated" />
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
            VRCDN
            <LinkMetadata link={featured.vrcdn} name="vrcdn" />
            <Input
              disabled={streamValues.vrcdn === "" && atLinkCap}
              maxLength={2048}
              name="vrcdnUrl"
              placeholder="Username or URL"
              type="text"
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
    vrcdn: featured.vrcdn ? parseVrcdnStreamLinks(featured.vrcdn.url)?.streamId ?? featured.vrcdn.url : "",
    twitch: featured.twitch?.url ?? "",
  }));
  // Stable ids rather than indices: the row inputs are uncontrolled, so keying
  // by index would shift the surviving rows' DOM values when one is removed.
  const linkRowSeq = useRef(rows.length);
  const [linkRows, setLinkRows] = useState<Array<{ id: number; link?: PositionedProfileLink }>>(() =>
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
            <AliasFields defaults={defaults.aliases ?? []} />
          </FieldGroup>
        ) : null}

        {canEdit("tags") ? (
          <FieldGroup field="tags">
            <Field>
              Tags
              <ListOriginal name="tags" values={defaults.tags ?? []} />
              <Input
                defaultValue={listFieldValue(defaults.tags ?? [])}
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
              <TimezoneField defaultValue={defaults.timezone ?? ""} />
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
                  <ListOriginal name="categoryTags" values={defaults.categoryTags ?? []} />
                  <Input
                    defaultValue={listFieldValue(defaults.categoryTags ?? [])}
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
              <LinkRow key={row.id} link={row.link} onRemove={() => removeLinkRow(row.id)} />
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
