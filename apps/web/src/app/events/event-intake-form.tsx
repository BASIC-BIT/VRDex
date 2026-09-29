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
import { EventIntakeSource, EventIntakeSuggestions, sourceIds, type IntakeSourceAction } from "./event-intake-source";
import { candidatePatch, posterDeclaration, websiteIntakeCommand, EventIntakeCandidateSchema } from "@/lib/event-intake-source";
import { EventPosterUploadSchema } from "../../../../../packages/api-contracts/src/event-intake";
import { EventEditorSteps, type EventEditorStep } from "./event-editor-steps";
import { EventEditorPreview } from "./event-editor-preview";
import { ProfileAvatarImage } from "../_components/profile-avatar-image";
import { BACKEND_ERROR_COPY } from "@/lib/error-copy";

function CommunityInput({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  const id = useId();
  const matches = useQuery(api.search.searchUniversal, !disabled && value.trim().length >= 2 ? { query: value.trim(), entityType: "profile", profileType: "community", limit: 8 } : "skip");
  return <><Input list={id} value={value} disabled={disabled} maxLength={64} onChange={event => onChange(event.target.value)} placeholder="Search communities" /><datalist id={id}>{matches?.map(match => <option key={match.slug} value={match.slug} label={match.title} />)}</datalist></>;
}

function PerformerInput({ label, slug, onLabel, onSlug }: { label: string; slug: string; onLabel: (value: string) => void; onSlug: (value: string) => void }) {
  const id = useId();
  const query = slug || label;
  const matches = useQuery(api.search.searchUniversal, query.trim().length >= 2 ? { query: query.trim(), entityType: "profile", profileType: "person", limit: 8 } : "skip");
  const match = matches?.find(person => person.slug === slug);
  return <div className="flex items-start gap-3">
    <span className="relative mt-6 flex size-12 shrink-0 overflow-hidden rounded-control bg-surface-strong"><ProfileAvatarImage alt={label || slug || "Performer"} fallback={(label || slug || "?").slice(0, 2).toUpperCase()} src={match?.imageUrl} /></span>
    <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2"><Field>Performer<Input value={label} onChange={event => onLabel(event.target.value)} /></Field><Field>Person profile<Input list={id} value={slug} onChange={event => onSlug(event.target.value)} /><datalist id={id}>{matches?.map(person => <option key={person.slug} value={person.slug} label={person.title} />)}</datalist></Field></div>
  </div>;
}

export function IntakeTime({ label, value, date, timezone, onChange }: { label: string; value?: EventIntakeLocalTime | null; date?: string | null; timezone?: string | null; onChange: (value: EventIntakeLocalTime | null) => void }) {
  let choices: number[] = [];
  try { if (date && timezone && value) choices = resolveEventLocalTime(date, value, timezone); } catch { /* Incomplete fields remain editable. */ }
  const base = date ? Date.parse(`${date}T00:00:00Z`) : NaN;
  const selectedDate = Number.isFinite(base) ? new Date(base + (value?.dayOffset ?? 0) * 86_400_000).toISOString().slice(0, 10) : "";
  return <div className="grid gap-2"><div className="grid grid-cols-2 gap-3">
    <Field>{label}<Input type="time" value={value?.time ?? ""} onChange={event => onChange(event.target.value ? { ...value, time: event.target.value, occurrence: undefined } : null)} /></Field>
    <Field>Date<Input aria-label={`${label} date`} type="date" value={selectedDate} disabled={!value || !Number.isFinite(base)} min={Number.isFinite(base) ? new Date(base - 86_400_000).toISOString().slice(0, 10) : undefined} max={Number.isFinite(base) ? new Date(base + 7 * 86_400_000).toISOString().slice(0, 10) : undefined} onChange={event => { if (value && event.target.value) onChange({ ...value, dayOffset: (Date.parse(`${event.target.value}T00:00:00Z`) - base) / 86_400_000, occurrence: undefined }); }} /></Field>
  </div>{value && date && timezone && choices.length === 0 ? <p className="text-sm text-danger">This local time does not exist.</p> : null}
    {choices.length > 1 ? <Field>Repeated time<Select aria-label={`${label} occurrence`} value={value?.occurrence ?? ""} onChange={event => { if (value) onChange({ ...value, occurrence: event.target.value as "earlier" | "later" }); }}><option value="">Choose occurrence</option>{choices.map((instant, index) => <option key={instant} value={index === 0 ? "earlier" : "later"}>{index === 0 ? "Earlier" : "Later"} ({new Date(instant).toISOString().slice(11, 16)} UTC)</option>)}</Select></Field> : null}
  </div>;
}

export function EventIntakeFieldsForm({ initialFields, initialRevision = 0, correction = false, onSave, onPublish, onSource, initialArtworkSourceId }: { initialFields: EventIntakeFields; initialRevision?: number; correction?: boolean; onSource?: IntakeSourceAction; initialArtworkSourceId?: string; onSave?: (fields: EventIntakeFields, revision: number) => Promise<void>; onPublish: (fields: EventIntakeFields, revision: number) => Promise<void> }) {
  const [fields, setFields] = useState(initialFields);
  const steps: EventEditorStep[] = onSource ? ["Source", "Details", "Lineup", "Review"] : ["Details", "Lineup", "Review"];
  const [activeStep, setActiveStep] = useState<EventEditorStep>(steps[0]);
  const [artwork, setArtwork] = useState<string>();
  const stepped = !correction;
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
        if (!fields.communitySlug || !fields.title || !fields.eventDate) { setActiveStep("Details"); throw new Error("Add a community, title and date."); }
        if (!fields.timeTba && (!fields.timezone || !fields.start)) { setActiveStep("Details"); throw new Error("Choose a time zone and start time, or Time TBA."); }
        for (const local of [fields.start, fields.end, fields.doors, ...(fields.lineup ?? []).flatMap(row => [row.start, row.end])]) {
          if (local) {
            try { if (!fields.timezone) throw new Error("Choose a time zone."); selectEventLocalTime(fields.eventDate, local, fields.timezone); }
            catch (error) { setActiveStep((fields.lineup ?? []).some(row => row.start === local || row.end === local) ? "Lineup" : "Details"); throw error; }
          }
        }
        await onPublish(fields, revision);
      } else { await onSave?.(fields, revision); setMessage("Draft saved"); }
    } catch (error) {
      if (error instanceof ConvexError && typeof error.data === "object" && error.data && "code" in error.data) {
        if (error.data.code === "NEAR_DUPLICATE" && "choices" in error.data) { setActiveStep("Review"); setDuplicates(error.data.choices as typeof duplicates); setMessage("Check similar events before publishing."); }
        else if (error.data.code === "VERSION_CONFLICT") setMessage("This draft changed elsewhere. Reload before saving.");
        else setMessage(BACKEND_ERROR_COPY);
      } else {
        const text = error instanceof Error ? error.message : "";
        setMessage(/^(Add a community|Choose a time zone|Ambiguous local time|Local time does not exist|Event date must be valid)/.test(text) ? text : BACKEND_ERROR_COPY);
      }
    }
    finally { setBusy(false); }
  }
  return <form className="grid gap-6" onInvalidCapture={event => { const panel = (event.target as HTMLElement).closest<HTMLElement>("[data-step]"); if (panel) setActiveStep(panel.dataset.step as EventEditorStep); }} onSubmit={event => { event.preventDefault(); if (!stepped || activeStep === "Review") void submit(true); else setActiveStep(steps[steps.indexOf(activeStep) + 1]); }}>
    <fieldset disabled={busy} className="grid min-w-0 gap-6">
    <EventEditorSteps steps={stepped ? steps : []} activeStep={activeStep} onSelect={setActiveStep} preview={stepped ? <EventEditorPreview fields={fields} artwork={artwork} /> : undefined}>
    <div className="grid gap-6">
    <div hidden={stepped && activeStep !== "Source"}>{onSource ? <EventIntakeSource fields={fields} revision={revision} onChange={setFields} action={onSource} busy={busy} setBusy={setBusy} setMessage={setMessage} initialArtworkSourceId={initialArtworkSourceId} onPreview={setArtwork} onExtract={() => setActiveStep("Details")} /> : null}</div>
    <div hidden={stepped && activeStep !== "Details"} data-step="Details"><section className="grid gap-4"><h2 className="text-xl font-semibold">Details</h2>{onSource ? <EventIntakeSuggestions fields={fields} onChange={setFields} /> : null}
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
    {!correction && !onSource ? <details><summary className="cursor-pointer font-medium">Source text</summary><Textarea aria-label="Source text" className="mt-3" value={fields.sourceText ?? ""} maxLength={12000} onChange={event => set("sourceText", event.target.value)} /></details> : null}
    </section></div>
    <div hidden={stepped && activeStep !== "Lineup"} data-step="Lineup"><section className="grid gap-4"><h2 className="text-xl font-semibold">Lineup</h2>{onSource ? <EventIntakeSuggestions fields={fields} onChange={setFields} lineup /> : null}
      {(fields.lineup ?? []).map((row, index) => <fieldset key={row.clientKey} className="grid gap-3 rounded-control border border-border p-4"><legend className="px-1">Slot {index + 1}</legend>
        <PerformerInput label={row.performerLabel ?? ""} slug={row.personSlug ?? ""} onLabel={value => set("lineup", fields.lineup!.map(item => item.clientKey === row.clientKey ? { ...item, performerLabel: value } : item))} onSlug={value => set("lineup", fields.lineup!.map(item => item.clientKey === row.clientKey ? { ...item, personSlug: value } : item))} />
        <Field>Role<Input value={row.roleLabel ?? ""} onChange={event => set("lineup", fields.lineup!.map(item => item.clientKey === row.clientKey ? { ...item, roleLabel: event.target.value } : item))} /></Field>
        {!fields.timeTba ? <><IntakeTime label={`Slot ${index + 1} start`} value={row.start} date={fields.eventDate} timezone={fields.timezone} onChange={value => set("lineup", fields.lineup!.map(item => item.clientKey === row.clientKey ? { ...item, start: value } : item))} /><IntakeTime label={`Slot ${index + 1} end`} value={row.end} date={fields.eventDate} timezone={fields.timezone} onChange={value => set("lineup", fields.lineup!.map(item => item.clientKey === row.clientKey ? { ...item, end: value } : item))} /></> : null}
        <Button type="button" variant="secondary" onClick={() => set("lineup", fields.lineup!.filter(item => item.clientKey !== row.clientKey).map((item, position) => ({ ...item, position })))}>Remove slot</Button>
      </fieldset>)}
      <Button type="button" variant="secondary" disabled={(fields.lineup?.length ?? 0) >= 80} onClick={() => set("lineup", [...fields.lineup ?? [], { clientKey: crypto.randomUUID(), position: fields.lineup?.length ?? 0 }])}>Add performer</Button>
    </section>
    </div>
    <div hidden={stepped && activeStep !== "Review"} data-step="Review" className="space-y-5">
    {stepped ? <section className="grid gap-4"><h2 className="text-xl font-semibold">Review</h2><div className="grid gap-4 rounded-control border border-border p-4">
      <div className="flex items-start justify-between gap-4"><div><h3 className="font-semibold">{fields.title || "Event title"}</h3><p className="text-sm text-muted">{[fields.communitySlug, fields.eventDate, fields.timeTba ? "Time TBA" : fields.start?.time, fields.timezone, fields.venueLabel].filter(Boolean).join(" · ")}</p></div><Button type="button" variant="secondary" onClick={() => setActiveStep("Details")}>Edit details</Button></div>
      {fields.summary ? <p className="text-sm">{fields.summary}</p> : null}
      <div className="flex items-start justify-between gap-4 border-t border-border pt-4"><div><h3 className="font-semibold">Lineup</h3>{fields.lineup?.map(row => <p key={row.clientKey} className="text-sm">{row.performerLabel || row.personSlug}</p>)}</div><Button type="button" variant="secondary" onClick={() => setActiveStep("Lineup")}>Edit lineup</Button></div>
    </div></section> : null}
    {duplicates.length ? <section className="grid gap-3"><h2 className="text-xl font-semibold">Similar events</h2>{duplicates.map(item => <div key={item.eventId}><Link className="underline" href={item.eventPath}>{item.title}</Link><label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={fields.duplicateAcknowledgements?.includes(item.eventId) ?? false} onChange={event => set("duplicateAcknowledgements", event.target.checked ? [...fields.duplicateAcknowledgements ?? [], item.eventId] : fields.duplicateAcknowledgements?.filter(id => id !== item.eventId))} />Different event</label></div>)}</section> : null}
    </div>
    </div>
    </EventEditorSteps>
    <div className="flex flex-wrap gap-3 border-t border-border pt-5">{stepped && activeStep !== steps[0] ? <Button type="button" variant="secondary" onClick={() => setActiveStep(steps[steps.indexOf(activeStep) - 1])}>Back</Button> : null}{!stepped || activeStep === "Review" ? <Button type="submit" variant="primary" disabled={busy}>{correction ? "Save changes" : "Publish event"}</Button> : <Button type="button" variant="primary" onClick={() => setActiveStep(steps[steps.indexOf(activeStep) + 1])}>Continue</Button>}{onSave ? <Button type="button" disabled={busy} variant="secondary" onClick={() => void submit(false)}>Save draft</Button> : null}</div>
    </fieldset>
    {message ? <Notice><span role="status">{message}</span></Notice> : null}
  </form>;
}

function ConnectedIntake({ draftId, initialCommunitySlug }: { draftId?: string; initialCommunitySlug?: string }) {
  const router = useRouter();
  const loaded = useQuery(api.eventIntake.getEventIntakeDraft, draftId ? { draftId } : "skip");
  const save = useMutation(api.eventIntake.saveEventIntakeDraft);
  const publish = useAction(api.eventIntake.publishEventIntake);
  const saved = useRef<{ draftId: Id<"eventIntakeDrafts">; version: number; fields: string } | null>(null);
  const selectedArtwork = useRef<string | null | undefined>(undefined);
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
  const sourceAction: IntakeSourceAction = async (action, fields, revision, file, onStaged) => {
    if (action === "read") return websiteIntakeCommand("poster_read", { posterAssetId: fields.posterSourceId }).then(result => ({ preview: result.dataUrl }));
    const targetSourceId = fields.posterSourceId;
    // Artwork/remove commands use the singular ID as their target, never as a changed source order.
    let next: EventIntakeFields = { ...fields, posterSourceId: sourceIds(fields)[0] ?? null };
    if (action === "upload") {
      if (!file) throw new Error("INVALID_POSTER");
      const declaration = await posterDeclaration(file);
      next = { ...next, posterDeclaration: declaration };
      const current = await saveFields(next, revision);
      const upload = EventPosterUploadSchema.parse(await websiteIntakeCommand("poster_upload_begin", { draftId: current.draftId, ...declaration }));
      next = { ...next, posterSourceIds: [...sourceIds(next), upload.posterAssetId], posterDeclaration: declaration, tentative: null, questions: null, evidence: null };
      next.posterSourceId = next.posterSourceIds![0];
      const staged = await saveFields(next, revision);
      onStaged?.(next);
      const body = new FormData();
      Object.entries(upload.transfer.fields).forEach(([key, value]) => body.append(key, value));
      body.append(upload.transfer.fileField, file);
      const response = await fetch(upload.transfer.url, { method: "POST", body, credentials: "omit", redirect: "error" });
      if (!response.ok) throw new Error("UPLOAD_FAILED");
      const completed = await websiteIntakeCommand("poster_upload_complete", { draftId: staged.draftId, posterAssetId: upload.posterAssetId, expectedVersion: staged.version });
      saved.current = { ...staged, version: completed.version };
      if (completed.artworkAssetId) selectedArtwork.current = upload.posterAssetId;
      return { fields: next, ...(completed.artworkAssetId ? { artworkSourceId: upload.posterAssetId } : {}) };
    }
    if (action === "remove") {
      const ids = sourceIds(next).filter(id => id !== targetSourceId);
      next = { ...next, posterSourceIds: ids, posterSourceId: ids[0] ?? null, tentative: null, questions: null, evidence: null };
    }
    const current = await saveFields(next, revision);
    if (action === "retry") {
      const result = await websiteIntakeCommand("poster_upload_complete", { draftId: current.draftId, posterAssetId: targetSourceId, expectedVersion: current.version });
      saved.current = { ...current, version: result.version };
      if (result.artworkAssetId) selectedArtwork.current = targetSourceId;
      return { fields: next, ...(result.artworkAssetId ? { artworkSourceId: targetSourceId } : {}) };
    }
    if (action === "artwork" || action === "remove") {
      if (action === "remove") {
        onStaged?.(next);
        if (targetSourceId !== (selectedArtwork.current === undefined ? loaded?.artworkSourceId : selectedArtwork.current)) return { fields: next };
      }
      const result = await websiteIntakeCommand("artwork_select", { draftId: current.draftId, posterAssetId: action === "remove" ? sourceIds(next)[0] ?? null : targetSourceId, expectedVersion: current.version });
      saved.current = { ...current, version: result.version };
      selectedArtwork.current = action === "remove" ? sourceIds(next)[0] ?? null : targetSourceId;
      return { fields: next, artworkSourceId: selectedArtwork.current };
    }
    const candidate = EventIntakeCandidateSchema.parse(await websiteIntakeCommand("extract", { draftId: current.draftId, ...(next.sourceText ? { sourceText: next.sourceText } : {}), ...(sourceIds(next).length ? { posterAssetIds: sourceIds(next) } : {}) }));
    next = { ...next, ...candidatePatch(candidate) };
    // Save against the version that supplied the source, never a refreshed query revision.
    await saveFields(next, revision);
    return { fields: next, candidate };
  };
  if (draftId && loaded === undefined) return <p aria-busy="true">Loading draft…</p>;
  if (draftId && loaded === null) return <Notice>Unavailable</Notice>;
  return <EventIntakeFieldsForm initialFields={loaded?.fields ?? { communitySlug: initialCommunitySlug, timeTba: false }} initialRevision={loaded?.version} onSource={sourceAction} initialArtworkSourceId={loaded?.artworkSourceId} onSave={async (fields, revision) => { await saveFields(fields, revision); }} onPublish={async (fields, revision) => {
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
