"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Upload } from "lucide-react";
import { EventIntakeDialog } from "./event-intake-dialog";
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
import { EventIntakeSource, EventIntakeSuggestions, type IntakeSourceAction } from "./event-intake-source";
import { candidatePatch, posterDeclaration, websiteIntakeCommand, EventIntakeCandidateSchema } from "@/lib/event-intake-source";
import { EventPosterUploadSchema } from "../../../../../packages/api-contracts/src/event-intake";
import { EventEditorSteps, type EventEditorStep } from "./event-editor-steps";
import { EventEditorPreview } from "./event-editor-preview";
import { eventLocalDate, formatIntakeDateTimeInput, parseIntakeDateTimeInput } from "@/lib/calendar/event-intake-date-time";
import { ProfileAvatarImage } from "../_components/profile-avatar-image";
import { BACKEND_ERROR_COPY } from "@/lib/error-copy";

function CommunityInput({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const results = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const selectedMatches = useQuery(api.search.searchUniversal, !disabled && value ? { query: value, entityType: "profile", profileType: "community", limit: 8 } : "skip");
  const matches = useQuery(api.search.searchUniversal, !disabled && open && query && query.trim().length >= 2 ? { query: query.trim(), entityType: "profile", profileType: "community", limit: 8 } : "skip");
  const expanded = open && (query?.trim().length ?? 0) >= 2;
  useEffect(() => {
    if (expanded && active >= 0) results.current?.children.item(active)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, expanded, matches]);
  const selected = selectedMatches?.find(match => match.slug === value);
  const title = selected?.title ?? value;
  function focus(selector: string) { requestAnimationFrame(() => container.current?.querySelector<HTMLElement>(selector)?.focus()); }
  function select(slug: string) { onChange(slug); setQuery(null); setOpen(false); setActive(-1); focus("[data-community-change]"); }
  return <div ref={container} className="grid min-w-0 gap-2">
    <span className="text-sm font-medium">Community</span>
    {value ? <div role="group" aria-label="Selected community" className="flex min-w-0 flex-wrap items-center gap-3 rounded-control border border-border p-3">
      <span className="relative flex size-10 shrink-0 overflow-hidden rounded-control bg-surface-strong"><ProfileAvatarImage alt={title} fallback={title.slice(0, 2).toUpperCase()} src={selected?.imageUrl} /></span>
      <div className="min-w-0 flex-1 break-words"><p className="text-sm font-medium">{title}</p>{selected ? <p className="text-xs text-muted">{value}</p> : null}</div>
      <div className="flex gap-2"><Button type="button" variant="secondary" disabled={disabled} data-community-change onClick={() => { setQuery(""); setOpen(true); setActive(-1); focus("input"); }}>Change</Button><Button type="button" variant="secondary" disabled={disabled} onClick={() => { onChange(""); setQuery(""); setOpen(true); setActive(-1); focus("input"); }}>Clear</Button></div>
    </div> : null}
    {!value || query !== null ? <div className="relative">
      <Input name="communitySlug" role="combobox" aria-label="Community" aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-results`} aria-activedescendant={expanded && matches?.[active] ? `${id}-${active}` : undefined} value={query ?? ""} disabled={disabled} maxLength={64} autoComplete="off" placeholder="Search communities"
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onChange={event => { setQuery(event.target.value); setOpen(true); setActive(-1); }}
        onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); setQuery(null); setOpen(false); setActive(-1); if (value) focus("[data-community-change]"); }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActive(index => Math.max(0, Math.min((matches?.length ?? 0) - 1, index + (event.key === "ArrowDown" ? 1 : -1)))); }
          if (event.key === "Enter") { event.preventDefault(); const match = open ? matches?.[active] : undefined; if (match) select(match.slug); }
        }} />
      {expanded ? <ul ref={results} id={`${id}-results`} role="listbox" aria-label="Communities" className="absolute top-full z-20 max-h-64 w-full overflow-auto rounded-control border border-border bg-surface-strong shadow-panel">
        {matches?.map((match, index) => <li id={`${id}-${index}`} key={match.slug} role="option" aria-selected={active === index} className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm ${active === index ? "bg-surface-elevated" : ""}`} onMouseDown={event => event.preventDefault()} onClick={() => select(match.slug)}>
          <span aria-hidden="true" className="relative flex size-10 shrink-0 overflow-hidden rounded-control bg-surface-strong"><ProfileAvatarImage alt={match.title} fallback={match.title.slice(0, 2).toUpperCase()} src={match.imageUrl} /></span><span className="min-w-0 break-words"><span className="block font-medium">{match.title}</span><span className="block text-xs text-muted">{match.slug}</span></span>
        </li>)}
        {query && query.trim().length >= 2 && matches?.length === 0 ? <li className="px-3 py-2 text-sm text-muted">No matches</li> : null}
      </ul> : null}
    </div> : null}
  </div>;
}

function PerformerInput({ label, slug, onLabel, onSlug }: { label: string; slug: string; onLabel: (value: string) => void; onSlug: (value: string) => void }) {
  const id = useId();
  const query = slug || label;
  const matches = useQuery(api.search.searchUniversal, query.trim().length >= 2 ? { query: query.trim(), entityType: "profile", profileType: "person", limit: 8 } : "skip");
  const match = matches?.find(person => person.slug === slug);
  return <div className="flex items-start gap-3">
    <span className="relative mt-6 flex size-12 shrink-0 overflow-hidden rounded-control bg-surface-strong"><ProfileAvatarImage alt={label || slug || "Performer"} fallback={(label || slug || "?").slice(0, 2).toUpperCase()} src={match?.imageUrl} /></span>
    <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2"><Field>Performer<Input value={label} required pattern=".*\S.*" onChange={event => onLabel(event.target.value)} /></Field><Field>Person profile<Input list={id} value={slug} onChange={event => onSlug(event.target.value)} /><datalist id={id}>{matches?.map(person => <option key={person.slug} value={person.slug} label={person.title} />)}</datalist></Field></div>
  </div>;
}

export function IntakeTime({ label, value, date, timezone, eventStart = false, onChange }: { label: string; value?: EventIntakeLocalTime | null; date?: string | null; timezone?: string | null; eventStart?: boolean; onChange: (change: { eventDate: string | null; local: EventIntakeLocalTime | null }) => void }) {
  const control = useRef<HTMLDivElement>(null);
  const formatted = formatIntakeDateTimeInput({ eventDate: date, local: value });
  const [edit, setEdit] = useState<{ value: string; source: string } | null>(null);
  const raw = edit?.source === formatted ? edit.value : formatted;
  let invalid = Boolean(edit?.source === formatted);
  try { parseIntakeDateTimeInput({ value: raw, eventDate: date, eventStart }); } catch { invalid = true; }
  useEffect(() => { control.current?.querySelector("input")?.setCustomValidity(invalid ? "Event date must be valid." : ""); }, [invalid]);
  let choices: number[] = [];
  try { if (!invalid && date && timezone && value) choices = resolveEventLocalTime(date, value, timezone); } catch { /* Incomplete fields remain editable. */ }
  return <div ref={control} className="grid min-w-0 gap-2">
    <Field>{label}<Input data-intake-time name={label} type="datetime-local" value={raw} aria-invalid={invalid || undefined} onChange={event => {
      const next = event.target.value;
      try { const change = parseIntakeDateTimeInput({ value: next, eventDate: date, eventStart }); setEdit(null); onChange(change); }
      catch { setEdit({ value: next, source: formatted }); }
    }} /></Field>
    {!invalid && value && date && timezone && choices.length === 0 ? <p className="text-sm text-danger">This local time does not exist.</p> : null}
    {choices.length > 1 ? <Field>Repeated time<Select aria-label={`${label} occurrence`} value={value?.occurrence ?? ""} onChange={event => {
      const occurrence = event.target.value;
      if (value && (occurrence === "" || occurrence === "earlier" || occurrence === "later")) onChange({ eventDate: date ?? null, local: { ...value, occurrence: occurrence || undefined } });
    }}><option value="">Choose occurrence</option>{choices.map((instant, index) => <option key={instant} value={index === 0 ? "earlier" : "later"}>{index === 0 ? "Earlier" : "Later"} ({new Date(instant).toISOString().slice(11, 16)} UTC)</option>)}</Select></Field> : null}
  </div>;
}

function untimed(fields: EventIntakeFields): EventIntakeFields {
  return { ...fields, start: fields.start === undefined ? undefined : null, end: fields.end === undefined ? undefined : null, doors: fields.doors === undefined ? undefined : null, lineup: fields.lineup?.map(row => ({ ...row, start: row.start === undefined ? undefined : null, end: row.end === undefined ? undefined : null })) };
}
function clearOccurrence(local?: EventIntakeLocalTime | null) {
  return local ? { ...local, occurrence: undefined } : local;
}
function resetTimeOccurrences(fields: EventIntakeFields, timezone: EventIntakeFields["timezone"]): EventIntakeFields {
  return { ...fields, timezone, start: clearOccurrence(fields.start), end: clearOccurrence(fields.end), doors: clearOccurrence(fields.doors), lineup: fields.lineup?.map(row => ({ ...row, start: clearOccurrence(row.start), end: clearOccurrence(row.end) })) };
}
function rebaseTime(local: EventIntakeLocalTime | null | undefined, previousDate: string | null | undefined, nextDate: string | null | undefined) {
  if (!local || !previousDate || !nextDate || previousDate === nextDate) return local;
  const date = eventLocalDate(previousDate, local);
  if (!date || !eventLocalDate(nextDate)) return local;
  // Keep the entered calendar date even when the new offset is invalid. The control blocks saving it.
  return { ...local, dayOffset: (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${nextDate}T00:00:00Z`)) / 86_400_000 };
}

export function EventIntakeFieldsForm({ initialFields, initialRevision = 0, correction = false, onSave, onPublish, onSource, initialArtworkSourceId, heading }: { heading?: ReactNode; initialFields: EventIntakeFields; initialRevision?: number; correction?: boolean; onSource?: IntakeSourceAction; initialArtworkSourceId?: string; onSave?: (fields: EventIntakeFields, revision: number) => Promise<void>; onPublish: (fields: EventIntakeFields, revision: number) => Promise<void> }) {
  const form = useRef<HTMLFormElement>(null);
  const [fields, setFields] = useState(() => initialFields.timeTba ? untimed(initialFields) : initialFields);
  const timedBackup = useRef<EventIntakeFields | null>(null);
  const [endOpen, setEndOpen] = useState(Boolean(!initialFields.timeTba && initialFields.end));
  useEffect(() => { if (fields.end) setEndOpen(true); }, [fields.end]);
  const steps: EventEditorStep[] = ["Details", "Lineup", "Review"];
  const [importOpen, setImportOpen] = useState(false);
  const focusExtractedDetails = useRef(false);
  const [activeStep, setActiveStep] = useState<EventEditorStep>(steps[0]);
  const [artwork, setArtwork] = useState<string>();
  // Keep the revision paired with the fields loaded when editing began.
  const [revision] = useState(initialRevision);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [duplicates, setDuplicates] = useState<Array<{ eventId: string; title: string; eventPath: string }>>([]);
  useEffect(() => {
    if (!busy && !importOpen && focusExtractedDetails.current) {
      focusExtractedDetails.current = false;
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[data-step="Details"] button, [name="title"]')?.focus());
    }
  }, [busy, importOpen]);
  const set = <K extends keyof EventIntakeFields>(key: K, value: EventIntakeFields[K]) => setFields(current => ({ ...current, [key]: value }));
  function reveal(step: EventEditorStep, selector: string) {
    setActiveStep(step);
    requestAnimationFrame(() => {
      const target = form.current?.querySelector<HTMLElement>(selector);
      const disclosure = target?.closest("details");
      if (disclosure) { disclosure.open = true; setEndOpen(true); }
      target?.focus();
    });
  }
  function receiveFields(next: EventIntakeFields) {
    if (next.timezone !== fields.timezone && timedBackup.current) timedBackup.current = resetTimeOccurrences(timedBackup.current, next.timezone);
    setFields(current => {
      const dateChanged = next.eventDate !== current.eventDate;
      let updated = dateChanged ? { ...next,
        start: next.start === current.start ? clearOccurrence(next.start) : next.start,
        end: next.end === current.end ? rebaseTime(next.end, current.eventDate, next.eventDate) : next.end,
        doors: next.doors === current.doors ? rebaseTime(next.doors, current.eventDate, next.eventDate) : next.doors,
        lineup: next.lineup?.map(row => { const previous = current.lineup?.find(item => item.clientKey === row.clientKey); return { ...row, start: row.start === previous?.start ? rebaseTime(row.start, current.eventDate, next.eventDate) : row.start, end: row.end === previous?.end ? rebaseTime(row.end, current.eventDate, next.eventDate) : row.end }; }),
      } : next;
      if (next.timezone !== current.timezone) updated = resetTimeOccurrences(updated, next.timezone);
      return updated.timeTba ? untimed(updated) : updated;
    });
  }
  function changeStart(change: { eventDate: string | null; local: EventIntakeLocalTime | null }) {
    setFields(current => ({ ...current, eventDate: change.eventDate, start: change.local,
      end: rebaseTime(current.end, current.eventDate, change.eventDate), doors: rebaseTime(current.doors, current.eventDate, change.eventDate),
      lineup: current.lineup?.map(row => ({ ...row, start: rebaseTime(row.start, current.eventDate, change.eventDate), end: rebaseTime(row.end, current.eventDate, change.eventDate) })),
    }));
  }
  function toggleTba(checked: boolean) {
    const invalid = form.current?.querySelector<HTMLInputElement>('[data-intake-time][aria-invalid="true"]');
    if (checked && invalid) { reveal(invalid.closest('[data-step="Lineup"]') ? "Lineup" : "Details", `[name="${invalid.name}"]`); return; }
    if (checked) { timedBackup.current = fields; setFields({ ...untimed(fields), timeTba: true }); }
    else {
      const backup = timedBackup.current;
      setFields(current => ({ ...current, timeTba: false,
        start: (backup?.eventDate === current.eventDate ? backup?.start : clearOccurrence(backup?.start)) ?? null, end: rebaseTime(backup?.end, backup?.eventDate, current.eventDate) ?? null, doors: rebaseTime(backup?.doors, backup?.eventDate, current.eventDate) ?? null,
        lineup: current.lineup?.map(row => { const remembered = backup?.lineup?.find(item => item.clientKey === row.clientKey); return { ...row, start: rebaseTime(remembered?.start, backup?.eventDate, current.eventDate) ?? null, end: rebaseTime(remembered?.end, backup?.eventDate, current.eventDate) ?? null }; }),
      }));
    }
  }
  function changeTimezone(timezone: string | null) {
    setFields(current => resetTimeOccurrences(current, timezone));
    if (timedBackup.current) timedBackup.current = resetTimeOccurrences(timedBackup.current, timezone);
  }
  async function submit(publish: boolean) {
    setBusy(true); setMessage("");
    try {
      const invalidTime = Array.from(form.current?.querySelectorAll<HTMLInputElement>("[data-intake-time]") ?? []).find(input => input.validity.customError);
      if (invalidTime) {
        reveal(invalidTime.closest('[data-step="Lineup"]') ? "Lineup" : "Details", `[name="${invalidTime.name}"]`);
        throw new Error("Event date must be valid.");
      }
      if (publish) {
        if (!fields.communitySlug || !fields.title || !fields.eventDate) { reveal("Details", `[name="${!fields.communitySlug ? "communitySlug" : !fields.title ? "title" : "Starts"}"]`); throw new Error("Add a community, title and date."); }
        if (!fields.timeTba && (!fields.timezone || !fields.start)) { reveal("Details", !fields.timezone ? '[aria-label="Time zone"]' : '[name="Starts"]'); throw new Error("Choose a time zone and start time, or Time TBA."); }
        const times: Array<{ local?: EventIntakeLocalTime | null; label: string; step: EventEditorStep }> = [
          { local: fields.start, label: "Starts", step: "Details" satisfies EventEditorStep },
          { local: fields.end, label: "Ends (optional)", step: "Details" satisfies EventEditorStep },
          { local: fields.doors, label: "Doors open", step: "Details" satisfies EventEditorStep },
          ...(fields.lineup ?? []).flatMap<(typeof times)[number]>((row, index) => [
            { local: row.start, label: `Slot ${index + 1} start`, step: "Lineup" satisfies EventEditorStep },
            { local: row.end, label: `Slot ${index + 1} end`, step: "Lineup" satisfies EventEditorStep },
          ]),
        ];
        for (const { local, label, step } of times) {
          if (local) {
            try { if (!fields.timezone) throw new Error("Choose a time zone."); selectEventLocalTime(fields.eventDate, local, fields.timezone); }
            catch (error) {
              if (!fields.timezone) reveal("Details", '[aria-label="Time zone"]');
              else reveal(step, error instanceof Error && error.message.startsWith("Ambiguous local time") ? `[aria-label="${label} occurrence"]` : `[name="${label}"]`);
              throw error;
            }
          }
        }
        if (!fields.timeTba && fields.start && fields.end && fields.timezone && selectEventLocalTime(fields.eventDate, fields.end, fields.timezone) <= selectEventLocalTime(fields.eventDate, fields.start, fields.timezone)) {
          reveal("Details", '[name="Ends (optional)"]');
          throw new Error("End time must follow start; choose the next day explicitly when crossing midnight.");
        }
        await onPublish(fields.timeTba ? untimed(fields) : fields, revision);
      } else { await onSave?.(fields.timeTba ? untimed(fields) : fields, revision); setMessage("Draft saved"); }
    } catch (error) {
      if (error instanceof ConvexError && typeof error.data === "object" && error.data && "code" in error.data) {
        if (error.data.code === "NEAR_DUPLICATE" && "choices" in error.data) { setActiveStep("Review"); setDuplicates(error.data.choices as typeof duplicates); setMessage("Check similar events before publishing."); }
        else if (error.data.code === "VERSION_CONFLICT") setMessage("This draft changed elsewhere. Reload before saving.");
        else setMessage(BACKEND_ERROR_COPY);
      } else {
        const text = error instanceof Error ? error.message : "";
        setMessage(/^(Add a community|Choose a time zone|Ambiguous local time|Local time does not exist|Event date must be valid|End time must follow start)/.test(text) ? text : BACKEND_ERROR_COPY);
      }
    }
    finally { setBusy(false); }
  }
  return <><form ref={form} className="grid gap-6" onInvalidCapture={event => { const target = event.target as HTMLElement; const panel = target.closest<HTMLElement>("[data-step]"); if (panel) { event.preventDefault(); setActiveStep(panel.dataset.step as EventEditorStep); requestAnimationFrame(() => { const disclosure = target.closest("details"); if (disclosure) { disclosure.open = true; setEndOpen(true); } target.focus(); }); } }} onSubmit={event => { event.preventDefault(); if (activeStep === "Review") void submit(true); else setActiveStep(steps[steps.indexOf(activeStep) + 1]); }}>
    <EventEditorSteps heading={heading} actions={onSource ? <Button type="button" variant="primary" className="min-h-11 gap-2" onClick={() => {
      const invalid = form.current?.querySelector<HTMLInputElement>('[data-intake-time][aria-invalid="true"]');
      if (invalid) reveal(invalid.closest('[data-step="Lineup"]') ? "Lineup" : "Details", `[name="${invalid.name}"]`);
      else setImportOpen(true);
    }}><Upload aria-hidden="true" className="size-4" />Import poster or text</Button> : undefined} steps={steps} activeStep={activeStep} onSelect={setActiveStep} preview={<EventEditorPreview fields={fields} artwork={artwork} />}>
    <fieldset disabled={busy} className="grid min-w-0 gap-6">
    <div hidden={activeStep !== "Details"} data-step="Details"><section className="grid gap-4"><h2 className="text-xl font-semibold">Details</h2>{onSource ? <EventIntakeSuggestions fields={fields} onChange={receiveFields} /> : null}
    {!correction ? <CommunityInput value={fields.communitySlug ?? ""} disabled={false} onChange={value => set("communitySlug", value || null)} /> : null}
    <Field>Event title<Input name="title" value={fields.title ?? ""} maxLength={120} onChange={event => set("title", event.target.value)} /></Field>
    <label className="flex items-center gap-2"><input type="checkbox" checked={fields.timeTba ?? false} onChange={event => toggleTba(event.target.checked)} />Time TBA</label>
    {fields.timeTba ? <Field>Starts<Input name="Starts" type="date" value={fields.eventDate ?? ""} onChange={event => set("eventDate", event.target.value || null)} /></Field> : null}
    <div className="grid gap-2"><span className="text-sm font-medium">Time zone</span><EventTimezonePicker value={fields.timezone ?? null} date={fields.eventDate ?? null} onChange={changeTimezone} /></div>
    {!fields.timeTba ? <><div className="grid items-start gap-3 sm:grid-cols-2"><IntakeTime label="Starts" eventStart value={fields.start} date={fields.eventDate} timezone={fields.timezone} onChange={changeStart} /><details className="relative" open={endOpen} onToggle={event => setEndOpen(event.currentTarget.open)}><summary className={`cursor-pointer font-medium ${endOpen ? "absolute right-0 top-0 text-xs" : "text-sm"}`}>Add end time</summary><div><IntakeTime label="Ends (optional)" value={fields.end} date={fields.eventDate} timezone={fields.timezone} onChange={change => set("end", change.local)} /></div></details></div><IntakeTime label="Doors open" value={fields.doors} date={fields.eventDate} timezone={fields.timezone} onChange={change => set("doors", change.local)} /></> : null}
    <Field>Where (optional)<Input value={fields.venueLabel ?? ""} maxLength={120} onChange={event => set("venueLabel", event.target.value)} /></Field>
    <Field>World profile<Input value={fields.worldSlug ?? ""} maxLength={64} onChange={event => set("worldSlug", event.target.value)} /></Field>
    <Field>Description<Textarea value={fields.summary ?? ""} maxLength={240} onChange={event => set("summary", event.target.value)} /></Field>
    <Field>Source URL<Input type="url" value={fields.sourceUrl ?? ""} onChange={event => set("sourceUrl", event.target.value)} /></Field>
    {!correction && !onSource ? <details><summary className="cursor-pointer font-medium">Source text</summary><Textarea aria-label="Source text" className="mt-3" value={fields.sourceText ?? ""} maxLength={12000} onChange={event => set("sourceText", event.target.value)} /></details> : null}
    </section></div>
    <div hidden={activeStep !== "Lineup"} data-step="Lineup"><section className="grid gap-4"><h2 className="text-xl font-semibold">Lineup</h2>{onSource ? <EventIntakeSuggestions fields={fields} onChange={receiveFields} lineup /> : null}
      {(fields.lineup ?? []).map((row, index) => <fieldset key={row.clientKey} className="grid gap-3 rounded-control border border-border p-4"><legend className="px-1">Slot {index + 1}</legend>
        <PerformerInput label={row.performerLabel ?? ""} slug={row.personSlug ?? ""} onLabel={value => set("lineup", fields.lineup!.map(item => item.clientKey === row.clientKey ? { ...item, performerLabel: value } : item))} onSlug={value => set("lineup", fields.lineup!.map(item => item.clientKey === row.clientKey ? { ...item, personSlug: value } : item))} />
        <Field>Role<Input value={row.roleLabel ?? ""} onChange={event => set("lineup", fields.lineup!.map(item => item.clientKey === row.clientKey ? { ...item, roleLabel: event.target.value } : item))} /></Field>
        {!fields.timeTba ? <><IntakeTime label={`Slot ${index + 1} start`} value={row.start} date={fields.eventDate} timezone={fields.timezone} onChange={change => set("lineup", fields.lineup!.map(item => item.clientKey === row.clientKey ? { ...item, start: change.local } : item))} /><IntakeTime label={`Slot ${index + 1} end`} value={row.end} date={fields.eventDate} timezone={fields.timezone} onChange={change => set("lineup", fields.lineup!.map(item => item.clientKey === row.clientKey ? { ...item, end: change.local } : item))} /></> : null}
        <Button type="button" variant="secondary" onClick={() => set("lineup", fields.lineup!.filter(item => item.clientKey !== row.clientKey).map((item, position) => ({ ...item, position })))}>Remove slot</Button>
      </fieldset>)}
      <Button type="button" variant="secondary" disabled={(fields.lineup?.length ?? 0) >= 80} onClick={() => set("lineup", [...fields.lineup ?? [], { clientKey: crypto.randomUUID(), position: fields.lineup?.length ?? 0 }])}>Add performer</Button>
    </section>
    </div>
    <div hidden={activeStep !== "Review"} data-step="Review" className="space-y-5">
    <section className="grid gap-4"><h2 className="text-xl font-semibold">Review</h2><div className="grid gap-4 rounded-control border border-border p-4">
      <div className="flex items-start justify-between gap-4"><div><h3 className="font-semibold">{fields.title || "Event title"}</h3><p className="text-sm text-muted">{[fields.communitySlug, eventLocalDate(fields.eventDate, fields.timeTba ? null : fields.start), fields.timeTba ? "Time TBA" : fields.start?.time, fields.timezone, fields.venueLabel].filter(Boolean).join(" · ")}</p></div><Button type="button" variant="secondary" onClick={() => setActiveStep("Details")}>Edit details</Button></div>
      {fields.summary ? <p className="text-sm">{fields.summary}</p> : null}
      <div className="flex items-start justify-between gap-4 border-t border-border pt-4"><div><h3 className="font-semibold">Lineup</h3>{fields.lineup?.map(row => <p key={row.clientKey} className="text-sm">{row.performerLabel || row.personSlug}</p>)}</div><Button type="button" variant="secondary" onClick={() => setActiveStep("Lineup")}>Edit lineup</Button></div>
    </div></section>
    {duplicates.length ? <section className="grid gap-3"><h2 className="text-xl font-semibold">Similar events</h2>{duplicates.map(item => <div key={item.eventId}><Link className="underline" href={item.eventPath}>{item.title}</Link><label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={fields.duplicateAcknowledgements?.includes(item.eventId) ?? false} onChange={event => set("duplicateAcknowledgements", event.target.checked ? [...fields.duplicateAcknowledgements ?? [], item.eventId] : fields.duplicateAcknowledgements?.filter(id => id !== item.eventId))} />Different event</label></div>)}</section> : null}
    </div>
    </fieldset>
    </EventEditorSteps>
    <fieldset disabled={busy} className="flex flex-wrap items-center gap-3 border-t border-border pt-5"><span className="mr-auto text-sm text-muted">{steps.indexOf(activeStep) + 1} / {steps.length}</span>{activeStep !== steps[0] ? <Button type="button" variant="secondary" onClick={() => setActiveStep(steps[steps.indexOf(activeStep) - 1])}>Back</Button> : null}{activeStep === "Review" ? <Button type="submit" variant="primary" disabled={busy}>{correction ? "Save changes" : "Publish event"}</Button> : <Button type="submit" variant="primary">Continue</Button>}{onSave ? <Button type="button" disabled={busy} variant="secondary" onClick={() => void submit(false)}>Save draft</Button> : null}</fieldset>
    {message && !importOpen ? <Notice><span role="status">{message}</span></Notice> : null}
  </form>
  {onSource ? <EventIntakeDialog open={importOpen} onClose={() => setImportOpen(false)}><fieldset disabled={busy}><EventIntakeSource fields={fields} revision={revision} onChange={receiveFields} action={onSource} busy={busy} setBusy={setBusy} setMessage={setMessage} initialArtworkSourceId={initialArtworkSourceId} onPreview={setArtwork} onExtract={() => { focusExtractedDetails.current = true; setActiveStep("Details"); setImportOpen(false); }} /></fieldset>{message ? <Notice><span role="status">{message}</span></Notice> : null}</EventIntakeDialog> : null}
  </>;
}

function ConnectedIntake({ draftId, initialCommunitySlug, heading }: { draftId?: string; initialCommunitySlug?: string; heading?: ReactNode }) {
  const router = useRouter();
  const loaded = useQuery(api.eventIntake.getEventIntakeDraft, draftId ? { draftId } : "skip");
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
  const sourceAction: IntakeSourceAction = async (action, fields, revision, file, onStaged) => {
    if (action === "read") return websiteIntakeCommand("poster_read", { posterAssetId: fields.posterSourceId }).then(result => ({ preview: result.dataUrl }));
    const targetSourceId = fields.posterSourceId;
    let next: EventIntakeFields = { ...fields };
    if (action === "upload") {
      if (!file) throw new Error("INVALID_POSTER");
      const declaration = await posterDeclaration(file);
      next = { ...next, posterDeclaration: declaration };
      const current = await saveFields(next, revision);
      const upload = EventPosterUploadSchema.parse(await websiteIntakeCommand("poster_upload_begin", { draftId: current.draftId, ...declaration }));
      next = { ...next, posterSourceId: upload.posterAssetId, posterDeclaration: declaration, tentative: null, questions: null, evidence: null };
      const staged = await saveFields(next, revision);
      onStaged?.(next);
      const body = new FormData();
      Object.entries(upload.transfer.fields).forEach(([key, value]) => body.append(key, value));
      body.append(upload.transfer.fileField, file);
      const response = await fetch(upload.transfer.url, { method: "POST", body, credentials: "omit", redirect: "error" });
      if (!response.ok) throw new Error("UPLOAD_FAILED");
      const completed = await websiteIntakeCommand("poster_upload_complete", { draftId: staged.draftId, posterAssetId: upload.posterAssetId, expectedVersion: staged.version });
      saved.current = { ...staged, version: completed.version };
      return { fields: next, ...(completed.artworkAssetId ? { artworkSourceId: upload.posterAssetId } : {}) };
    }
    if (action === "remove") {
      next = { ...next, posterSourceId: null, posterDeclaration: null, tentative: null, questions: null, evidence: null };
    }
    // Replay completion against its saved version before persisting later local edits.
    const current = action === "retry" && saved.current ? saved.current : await saveFields(next, revision);
    if (action === "retry") {
      const result = await websiteIntakeCommand("poster_upload_complete", { draftId: current.draftId, posterAssetId: targetSourceId, expectedVersion: current.version });
      saved.current = { ...current, version: result.version };
      return { fields: next, ...(result.artworkAssetId ? { artworkSourceId: targetSourceId } : {}) };
    }
    if (action === "remove") { onStaged?.(next); return { fields: next, artworkSourceId: null }; }
    const candidate = EventIntakeCandidateSchema.parse(await websiteIntakeCommand("extract", { draftId: current.draftId, ...(next.sourceText ? { sourceText: next.sourceText } : {}), ...(next.posterSourceId ? { posterAssetId: next.posterSourceId } : {}) }));
    next = { ...next, ...candidatePatch(candidate) };
    // Save against the version that supplied the source, never a refreshed query revision.
    await saveFields(next, revision);
    return { fields: next, candidate };
  };
  if (draftId && loaded === undefined) return <>{heading}<p aria-busy="true">Loading draft…</p></>;
  if (draftId && loaded === null) return <>{heading}<Notice>Unavailable</Notice></>;
  return <EventIntakeFieldsForm heading={heading} initialFields={loaded?.fields ?? { communitySlug: initialCommunitySlug, timeTba: false }} initialRevision={loaded?.version} onSource={sourceAction} initialArtworkSourceId={loaded?.artworkSourceId} onSave={async (fields, revision) => { await saveFields(fields, revision); }} onPublish={async (fields, revision) => {
    const current = await saveFields(fields, revision);
    if (request.current?.version !== current.version) request.current = { version: current.version, key: crypto.randomUUID() };
    const result = await publish({ draftId: current.draftId, expectedVersion: current.version, idempotencyKey: request.current.key });
    router.replace(result.eventPath);
  }} />;
}
export function EventIntakeForm(props: { draftId?: string; initialCommunitySlug?: string; heading?: ReactNode }) {
  const auth = useConvexAuth();
  if (auth.isLoading) return <>{props.heading}<p aria-busy="true">Loading…</p></>;
  if (!auth.isAuthenticated) return <>{props.heading}<Link href={`/sign-in?returnTo=${encodeURIComponent(`/events/new?${new URLSearchParams({ ...(props.draftId ? { draft: props.draftId } : {}), ...(props.initialCommunitySlug ? { community: props.initialCommunitySlug } : {}) })}`)}`}>Sign in</Link></>;
  return <ConnectedIntake {...props} />;
}
