"use client";
import { useId, useRef, useState } from "react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@convex-generated-api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { resolveEventLocalTime, selectEventLocalTime, type EventIntakePatch as EventIntakeFields, type EventIntakeLocalTime } from "../../../../../packages/api-contracts/src/event-intake";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { EventTimezonePicker } from "../_components/event-timezone-picker";
import { BACKEND_ERROR_COPY } from "@/lib/error-copy";

function CommunityInput({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  const id = useId();
  const matches = useQuery(api.search.searchUniversal, !disabled && value.trim().length >= 2 ? { query: value.trim(), entityType: "profile", profileType: "community", limit: 8 } : "skip");
  return <><Input list={id} value={value} disabled={disabled} maxLength={64} onChange={event => onChange(event.target.value)} placeholder="Search communities" /><datalist id={id}>{matches?.map(match => <option key={match.slug} value={match.slug} label={match.title} />)}</datalist></>;
}

export function IntakeTime({ label, value, date, timezone, onChange }: { label: string; value?: EventIntakeLocalTime | null; date?: string | null; timezone?: string | null; onChange: (value: EventIntakeLocalTime | null) => void }) {
  let choices: number[] = [];
  try { if (date && timezone && value) choices = resolveEventLocalTime(date, value, timezone); } catch { /* Incomplete fields remain editable. */ }
  return <div className="grid gap-2"><div className="grid grid-cols-2 gap-3">
    <Field>{label}<Input type="time" value={value?.time ?? ""} onChange={event => onChange(event.target.value ? { ...value, time: event.target.value, occurrence: undefined } : null)} /></Field>
    <Field>Day offset<Input aria-label={`${label} day offset`} type="number" min={-1} max={7} value={value?.dayOffset ?? 0} onChange={event => { if (value) onChange({ ...value, dayOffset: Number(event.target.value), occurrence: undefined }); }} /></Field>
  </div>{value && date && timezone && choices.length === 0 ? <p className="text-sm text-danger">This local time does not exist.</p> : null}
    {choices.length > 1 ? <Field>Repeated time<Select aria-label={`${label} occurrence`} value={value?.occurrence ?? ""} onChange={event => { if (value) onChange({ ...value, occurrence: event.target.value as "earlier" | "later" }); }}><option value="">Choose occurrence</option>{choices.map((instant, index) => <option key={instant} value={index === 0 ? "earlier" : "later"}>{index === 0 ? "Earlier" : "Later"} ({new Date(instant).toISOString().slice(11, 16)} UTC)</option>)}</Select></Field> : null}
  </div>;
}

export function EventIntakeFieldsForm({ initialFields, initialRevision = 0, correction = false, onSave, onPublish }: { initialFields: EventIntakeFields; initialRevision?: number; correction?: boolean; onSave?: (fields: EventIntakeFields, revision: number) => Promise<void>; onPublish: (fields: EventIntakeFields, revision: number) => Promise<void> }) {
  const [fields, setFields] = useState(initialFields);
  // Keep the revision paired with the fields loaded when editing began.
  const [revision] = useState(initialRevision);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [duplicates, setDuplicates] = useState<Array<{ eventId: string; title: string; eventPath: string }>>([]);
  const set = <K extends keyof EventIntakeFields>(key: K, value: EventIntakeFields[K]) => setFields(current => ({ ...current, [key]: value }));
  async function submit(publish: boolean) {
    setBusy(true); setMessage("");
    try {
      if (publish) {
        if (!fields.communitySlug || !fields.title || !fields.eventDate) throw new Error("Add a community, title and date.");
        if (!fields.timeTba && (!fields.timezone || !fields.start)) throw new Error("Choose a time zone and start time, or Time TBA.");
        for (const local of [fields.start, fields.end, fields.doors, ...(fields.lineup ?? []).flatMap(row => [row.start, row.end])]) {
          if (local) { if (!fields.timezone) throw new Error("Choose a time zone."); selectEventLocalTime(fields.eventDate, local, fields.timezone); }
        }
        await onPublish(fields, revision);
      } else { await onSave?.(fields, revision); setMessage("Draft saved"); }
    } catch (error) {
      if (error instanceof ConvexError && typeof error.data === "object" && error.data && "code" in error.data) {
        if (error.data.code === "NEAR_DUPLICATE" && "choices" in error.data) { setDuplicates(error.data.choices as typeof duplicates); setMessage("Check similar events before publishing."); }
        else if (error.data.code === "VERSION_CONFLICT") setMessage("This draft changed elsewhere. Reload before saving.");
        else setMessage(BACKEND_ERROR_COPY);
      } else {
        const text = error instanceof Error ? error.message : "";
        setMessage(/^(Add a community|Choose a time zone|Ambiguous local time|Local time does not exist|Event date must be valid)/.test(text) ? text : BACKEND_ERROR_COPY);
      }
    }
    finally { setBusy(false); }
  }
  return <form className="grid gap-6" onSubmit={event => { event.preventDefault(); void submit(true); }}>
    <Field>Community<CommunityInput value={fields.communitySlug ?? ""} disabled={correction} onChange={value => set("communitySlug", value)} /></Field>
    <Field>Event title<Input value={fields.title ?? ""} maxLength={120} onChange={event => set("title", event.target.value)} /></Field>
    <Field>Date<Input type="date" value={fields.eventDate ?? ""} onChange={event => set("eventDate", event.target.value)} /></Field>
    <label className="flex items-center gap-2"><input type="checkbox" checked={fields.timeTba ?? false} onChange={event => setFields(current => ({ ...current, timeTba: event.target.checked, ...(event.target.checked ? { start: null, end: null, doors: null, lineup: current.lineup?.map(row => ({ ...row, start: null, end: null })) } : {}) }))} />Time TBA</label>
    <div className="grid gap-2"><span className="text-sm font-medium">Time zone</span><EventTimezonePicker value={fields.timezone ?? null} date={fields.eventDate ?? null} onChange={value => set("timezone", value)} /></div>
    {!fields.timeTba ? <><IntakeTime label="Start time" value={fields.start} date={fields.eventDate} timezone={fields.timezone} onChange={value => set("start", value)} /><IntakeTime label="End time" value={fields.end} date={fields.eventDate} timezone={fields.timezone} onChange={value => set("end", value)} /><IntakeTime label="Doors open" value={fields.doors} date={fields.eventDate} timezone={fields.timezone} onChange={value => set("doors", value)} /></> : null}
    <Field>Venue<Input value={fields.venueLabel ?? ""} maxLength={120} onChange={event => set("venueLabel", event.target.value)} /></Field>
    <Field>World profile<Input value={fields.worldSlug ?? ""} maxLength={64} onChange={event => set("worldSlug", event.target.value)} /></Field>
    <Field>Description<Textarea value={fields.summary ?? ""} maxLength={240} onChange={event => set("summary", event.target.value)} /></Field>
    <Field>Source URL<Input type="url" value={fields.sourceUrl ?? ""} onChange={event => set("sourceUrl", event.target.value)} /></Field>
    {!correction ? <details><summary className="cursor-pointer font-medium">Source text</summary><Textarea aria-label="Source text" className="mt-3" value={fields.sourceText ?? ""} maxLength={12000} onChange={event => set("sourceText", event.target.value)} /></details> : null}
    <section className="grid gap-4"><h2 className="text-xl font-semibold">Slots</h2>
      {(fields.lineup ?? []).map((row, index) => <fieldset key={row.clientKey} className="grid gap-3 rounded-control border border-border p-4"><legend className="px-1">Slot {index + 1}</legend>
        <Field>Performer<Input value={row.performerLabel ?? ""} onChange={event => set("lineup", fields.lineup!.map(item => item.clientKey === row.clientKey ? { ...item, performerLabel: event.target.value } : item))} /></Field>
        <Field>Person profile<Input value={row.personSlug ?? ""} onChange={event => set("lineup", fields.lineup!.map(item => item.clientKey === row.clientKey ? { ...item, personSlug: event.target.value } : item))} /></Field>
        <Field>Role<Input value={row.roleLabel ?? ""} onChange={event => set("lineup", fields.lineup!.map(item => item.clientKey === row.clientKey ? { ...item, roleLabel: event.target.value } : item))} /></Field>
        {!fields.timeTba ? <><IntakeTime label={`Slot ${index + 1} start`} value={row.start} date={fields.eventDate} timezone={fields.timezone} onChange={value => set("lineup", fields.lineup!.map(item => item.clientKey === row.clientKey ? { ...item, start: value } : item))} /><IntakeTime label={`Slot ${index + 1} end`} value={row.end} date={fields.eventDate} timezone={fields.timezone} onChange={value => set("lineup", fields.lineup!.map(item => item.clientKey === row.clientKey ? { ...item, end: value } : item))} /></> : null}
        <Button type="button" variant="secondary" onClick={() => set("lineup", fields.lineup!.filter(item => item.clientKey !== row.clientKey).map((item, position) => ({ ...item, position })))}>Remove slot</Button>
      </fieldset>)}
      <Button type="button" variant="secondary" disabled={(fields.lineup?.length ?? 0) >= 80} onClick={() => set("lineup", [...fields.lineup ?? [], { clientKey: crypto.randomUUID(), position: fields.lineup?.length ?? 0 }])}>Add performer</Button>
    </section>
    {duplicates.length ? <section className="grid gap-3"><h2 className="text-xl font-semibold">Similar events</h2>{duplicates.map(item => <div key={item.eventId}><Link className="underline" href={item.eventPath}>{item.title}</Link><label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={fields.duplicateAcknowledgements?.includes(item.eventId) ?? false} onChange={event => set("duplicateAcknowledgements", event.target.checked ? [...fields.duplicateAcknowledgements ?? [], item.eventId] : fields.duplicateAcknowledgements?.filter(id => id !== item.eventId))} />Different event</label></div>)}</section> : null}
    <div className="flex flex-wrap gap-3"><Button type="submit" variant="primary" disabled={busy}>{correction ? "Save changes" : "Publish event"}</Button>{onSave ? <Button type="button" disabled={busy} variant="secondary" onClick={() => void submit(false)}>Save draft</Button> : null}</div>
    {message ? <Notice><span role="status">{message}</span></Notice> : null}
  </form>;
}

function ConnectedIntake({ draftId, initialCommunitySlug }: { draftId?: string; initialCommunitySlug?: string }) {
  const router = useRouter();
  const loaded = useQuery(api.eventIntake.getEventIntakeDraft, draftId ? { draftId: draftId as Id<"eventIntakeDrafts"> } : "skip");
  const save = useMutation(api.eventIntake.saveEventIntakeDraft);
  const publish = useAction(api.eventIntake.publishEventIntake);
  const saved = useRef<{ draftId: Id<"eventIntakeDrafts">; version: number; fields: string } | null>(null);
  const request = useRef<{ key: string; version: number } | null>(null);
  async function saveFields(fields: EventIntakeFields, initialVersion: number) {
    const serialized = JSON.stringify(fields);
    if (saved.current?.fields === serialized) return saved.current;
    const current = saved.current ?? (loaded ? { draftId: loaded._id, version: initialVersion } : null);
    const result = await save({ ...(current ? { draftId: current.draftId, expectedVersion: current.version } : {}), patch: fields });
    saved.current = { ...result, fields: serialized };
    window.history.replaceState(null, "", `/events/new?draft=${result.draftId}`);
    return saved.current;
  }
  if (draftId && loaded === undefined) return <p aria-busy="true">Loading draft…</p>;
  return <EventIntakeFieldsForm initialFields={loaded?.fields ?? { communitySlug: initialCommunitySlug, timeTba: false }} initialRevision={loaded?.version} onSave={async (fields, revision) => { await saveFields(fields, revision); }} onPublish={async (fields, revision) => {
    const current = await saveFields(fields, revision);
    if (request.current?.version !== current.version) request.current = { version: current.version, key: crypto.randomUUID() };
    const result = await publish({ draftId: current.draftId, expectedVersion: current.version, idempotencyKey: request.current.key });
    router.replace(result.eventPath);
  }} />;
}
export function EventIntakeForm(props: { draftId?: string; initialCommunitySlug?: string }) {
  const auth = useConvexAuth();
  if (auth.isLoading) return <p aria-busy="true">Loading…</p>;
  if (!auth.isAuthenticated) return <Link href={`/sign-in?returnTo=${encodeURIComponent(`/events/new?${new URLSearchParams({ ...(props.draftId ? { draft: props.draftId } : {}), ...(props.initialCommunitySlug ? { community: props.initialCommunitySlug } : {}) })}`)}`}>Sign in</Link>;
  return <ConnectedIntake {...props} />;
}
