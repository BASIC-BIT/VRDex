"use client";
import { formatLineupTimeRange } from "@/lib/calendar/event-lineup-display";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Upload } from "lucide-react";
import { EventIntakeDialog } from "./event-intake-dialog";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@convex-generated-api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { EventIntakePatchSchema, selectEventLocalTime, type EventIntakePatch as EventIntakeFields, type EventIntakeLocalTime } from "../../../../../packages/api-contracts/src/event-intake";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { resolveEventTimezoneDefault } from "@/lib/event-timezone-default";
import { EventTimezonePicker } from "../_components/event-timezone-picker";
import { EventIntakeSource, EventIntakeSuggestions, type IntakeSourceAction } from "./event-intake-source";
import { candidatePatch, posterDeclaration, websiteIntakeCommand, EventIntakeCandidateSchema } from "@/lib/event-intake-source";
import { EventPosterUploadSchema } from "../../../../../packages/api-contracts/src/event-intake";
import { EventEditorSteps, type EventEditorStep } from "./event-editor-steps";
import { EventIdentityPicker } from "./event-identity-picker";
import { EventLocationField } from "./event-location-field";
import type { EventIdentityOption } from "@/lib/event-editor-identity";
import { EventEditorPreview, EventCommunitySummary, useEventCommunity } from "./event-editor-preview";
import { eventLocalDate, formatIntakeDateTimeInput, parseIntakeDateTimeInput } from "@/lib/calendar/event-intake-date-time";
import { acceptIntakeSuggestion, rebaseIntakeTime as rebaseTime, rebaseIntakeTimes, rebaseIntakeSuggestions, restoreIntakeTiming, type IntakeSuggestionAcceptance } from "@/lib/calendar/event-intake-suggestions";
import { EventPerformerField, useEventPerformerEditor } from "./event-performer-field";
import { applyIntakeLineupTimings, intakeLocalFromInstant, readIntakeInstant, readIntakeLineupTimings } from "@/lib/calendar/event-lineup-adapters";
import { changeLineupDuration, generateLineupTimings, getLineupEndAt, getLineupEndConflict, insertLineupSlot, removeLineupSlot, shiftLineupStart, type LineupEditResult, type LineupTimingRow } from "@/lib/calendar/event-lineup-timing";
import { EventLineupSetup, EventLineupInsert, EventSlotDuration, EventLineupReset, EventLineupConflict } from "./event-lineup-controls";
import { projectEditorTime, readIntakeEditorClock, resolveEditorTime } from "@/lib/calendar/event-editor-time";
import { eventTimezoneLabel } from "@/lib/event-timezones";
import { BACKEND_ERROR_COPY } from "@/lib/error-copy";

export function IntakeTime({ label, name = label, occurrenceLabel = `${label} occurrence`, value, date, timezone, displayTimezone, eventStart = false, required, onChange, onPendingEditChange }: {
  label: string; name?: string; occurrenceLabel?: string; value?: EventIntakeLocalTime | null; date?: string | null; timezone?: string | null; displayTimezone: string; eventStart?: boolean; required?: boolean;
  onChange: (change: { eventDate: string | null; local: EventIntakeLocalTime | null }) => void | boolean;
  onPendingEditChange?: (pending: boolean) => void;
}) {
  const control = useRef<HTMLDivElement>(null);
  const clock = readIntakeEditorClock({ fields: { eventDate: date, timezone }, local: value });
  const unresolved = clock.kind === "unresolved";
  const zone = unresolved ? timezone : displayTimezone;
  const projected = clock.kind === "resolved" ? projectEditorTime({ instant: clock.instant, timezone: displayTimezone }) : { value: formatIntakeDateTimeInput({ eventDate: date, local: value }), occurrence: value?.occurrence };
  const source = JSON.stringify([date, timezone, value, displayTimezone]);
  const [edit, setEdit] = useState<{ source: string; value: string; occurrence?: EventIntakeLocalTime["occurrence"] } | null>(null);
  const pending = edit?.source === source ? edit : null;
  const raw = pending?.value ?? projected.value;
  const occurrence = pending ? pending.occurrence : projected.occurrence;
  const resolution = resolveEditorTime({ value: raw, timezone: zone ?? "", occurrence });
  const choices = zone && raw ? resolveEditorTime({ value: raw, timezone: zone }) : { kind: "empty" as const };
  const invalid = Boolean(pending);
  const validityMessage = !invalid ? "" : resolution.kind === "gap" ? "Local time does not exist in this timezone." : resolution.kind === "ambiguous" ? "Ambiguous local time requires an earlier or later occurrence." : "Event date must be valid.";
  useEffect(() => { control.current?.querySelector("input")?.setCustomValidity(validityMessage); onPendingEditChange?.(invalid); }, [invalid, validityMessage, onPendingEditChange]);
  function commit(next: string, nextOccurrence?: EventIntakeLocalTime["occurrence"]) {
    try {
      if (!next) { onChange({ eventDate: date ?? null, local: null }); setEdit(null); return; }
      if (!zone) { const change = parseIntakeDateTimeInput({ value: next, eventDate: date, eventStart }); onChange(change); setEdit(null); return; }
      const resolved = resolveEditorTime({ value: next, timezone: zone, occurrence: nextOccurrence });
      if (resolved.kind !== "resolved") { setEdit({ source, value: next, occurrence: nextOccurrence }); return; }
      const canonicalZone = timezone || zone;
      const canonical = projectEditorTime({ instant: resolved.instant, timezone: canonicalZone });
      const eventDate = eventStart ? canonical.value.slice(0, 10) : date ?? canonical.value.slice(0, 10);
      const local = intakeLocalFromInstant({ eventDate, timezone: canonicalZone }, resolved.instant);
      if (onChange({ eventDate, local }) === false) { setEdit({ source, value: next, occurrence: nextOccurrence }); return; }
      setEdit(null);
    } catch { setEdit({ source, value: next, occurrence: nextOccurrence }); }
  }
  return <div ref={control} className="grid min-w-0 gap-2" data-unresolved-time={unresolved || undefined}>
    {unresolved && !date ? <p className="text-sm">{value?.time}</p> : null}
    {unresolved ? <div className="text-xs text-muted">Unresolved time{timezone ? ` · ${eventTimezoneLabel(timezone)}` : ""}</div> : null}
    <Field>{label}<Input data-intake-time data-time-pending={invalid || undefined} name={name} required={required} type="datetime-local" value={raw} aria-invalid={invalid || undefined} onChange={event => commit(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setEdit(null); } }} /></Field>
    {pending ? <Button type="button" variant="ghost" className="justify-self-start" onClick={() => { setEdit(null); control.current?.querySelector("input")?.focus(); }}>Cancel</Button> : null}
    {pending && !unresolved ? <p className="text-xs text-muted">{eventTimezoneLabel(displayTimezone)}</p> : null}
    {resolution.kind === "gap" ? <p className="text-sm text-danger">This local time does not exist.</p> : null}
    {choices.kind === "ambiguous" ? <Field>Repeated time<Select aria-label={occurrenceLabel} value={occurrence ?? ""} onChange={event => { const selected = event.target.value; if (selected === "earlier" || selected === "later") commit(raw, selected); }}><option value="">Choose occurrence</option>{choices.instants.map((instant, index) => <option key={instant} value={index === 0 ? "earlier" : "later"}>{index === 0 ? "Earlier" : "Later"} ({new Date(instant).toISOString().slice(11, 16)} UTC)</option>)}</Select></Field> : null}
  </div>;
}

function untimed(fields: EventIntakeFields): EventIntakeFields {
  return { ...fields, start: fields.start === undefined ? undefined : null, end: fields.end === undefined ? undefined : null, doors: fields.doors === undefined ? undefined : null, lineup: fields.lineup?.map(row => ({ ...row, start: row.start === undefined ? undefined : null, end: row.end === undefined ? undefined : null })) };
}
function clearOccurrence(local?: EventIntakeLocalTime | null) {
  return local ? { ...local, occurrence: undefined } : local;
}
export function EventIntakeFieldsForm({ initialFields, initialRevision = 0, correction = false, onSave, onPublish, onSource, initialArtworkSourceId, heading, savedTimezonePreference, newDraft = false }: { savedTimezonePreference?: string | null; newDraft?: boolean; heading?: ReactNode; initialFields: EventIntakeFields; initialRevision?: number; correction?: boolean; onSource?: IntakeSourceAction; initialArtworkSourceId?: string; onSave?: (fields: EventIntakeFields, revision: number) => Promise<void>; onPublish: (fields: EventIntakeFields, revision: number) => Promise<void> }) {
  const form = useRef<HTMLFormElement>(null);
  const performers = useEventPerformerEditor();
  const [fields, setFields] = useState(() => initialFields.timeTba ? untimed(initialFields) : initialFields);
  const { isAuthenticated } = useConvexAuth();
  const managed = useQuery(api.events.listManagedCommunities, isAuthenticated ? {} : "skip");
  const shortcuts: EventIdentityOption[] = (managed ?? []).map(item => ({ kind: "community", slug: item.slug, title: item.displayName, href: `/${item.slug}`, imageUrl: item.imageUrl, imageKind: "logo", context: item.roleLabel }));
  const [selectedCommunity, setSelectedCommunity] = useState<EventIdentityOption>();
  const community = useEventCommunity(fields.communitySlug, selectedCommunity);
  const [selectedWorld, setSelectedWorld] = useState<EventIdentityOption>();
  const world = selectedWorld?.slug === fields.worldSlug ? selectedWorld : undefined;
  const timezoneAuthored = useRef(Boolean(initialFields.timezone || initialFields.eventDate || initialFields.start) || !newDraft);
  const editingTimezoneAuthored = useRef(false);
  const editingTimezoneInitialized = useRef(false);
  const [editingTimezone, setEditingTimezone] = useState(() => resolveEventTimezoneDefault({ savedPreference: savedTimezonePreference }));
  useEffect(() => {
    if (editingTimezoneInitialized.current && (editingTimezoneAuthored.current || (newDraft && timezoneAuthored.current))) return;
    if (form.current?.querySelector('[data-time-pending="true"]')) return;
    editingTimezoneInitialized.current = true;
    const timezone = resolveEventTimezoneDefault({ savedPreference: savedTimezonePreference, browserTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    setEditingTimezone(timezone);
    if (!timezoneAuthored.current) setFields(current => ({ ...current, timezone }));
  }, [savedTimezonePreference, newDraft]);
  const timedBackup = useRef<EventIntakeFields | null>(null);
  const tbaDateEdited = useRef(false);
  const tbaDisplayDate = useRef<string | null>(null);
  const startAnchor = useRef(readIntakeInstant(initialFields, initialFields.start));
  const [endOpen, setEndOpen] = useState(Boolean(!initialFields.timeTba && initialFields.end));
  useEffect(() => { if (fields.end) setEndOpen(true); }, [fields.end]);
  const [doorsOpen, setDoorsOpen] = useState(Boolean(initialFields.doors));
  useEffect(() => { if (fields.doors) setDoorsOpen(true); }, [fields.doors]);
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
    if (next.timezone !== fields.timezone || next.eventDate !== fields.eventDate || next.start !== fields.start || next.end !== fields.end || next.doors !== fields.doors) timezoneAuthored.current = true;

    setFields(current => {
      const dateChanged = next.eventDate !== current.eventDate;
      const updated = dateChanged ? { ...next,
        start: next.start === current.start ? clearOccurrence(next.start) : next.start,
        end: next.end === current.end ? rebaseTime(next.end, current.eventDate, next.eventDate) : next.end,
        doors: next.doors === current.doors ? rebaseTime(next.doors, current.eventDate, next.eventDate) : next.doors,
        lineup: next.lineup?.map(row => { const previous = current.lineup?.find(item => item.clientKey === row.clientKey); return { ...row, start: row.start === previous?.start ? rebaseTime(row.start, current.eventDate, next.eventDate) : row.start, end: row.end === previous?.end ? rebaseTime(row.end, current.eventDate, next.eventDate) : row.end }; }),
      } : next;

      startAnchor.current = readIntakeInstant(updated, updated.start);
      return updated.timeTba ? untimed(updated) : updated;
    });
  }
  function acceptSuggestion(acceptance: IntakeSuggestionAcceptance) {
    const acceptanceFields = fields.timeTba && acceptance.key === "eventDate" && !fields.eventDate
      ? { ...fields, eventDate: timedBackup.current?.eventDate } : fields;
    const effective = fields.timeTba ? { ...restoreIntakeTiming({ ...acceptanceFields, eventDate: timedBackup.current?.eventDate ?? acceptanceFields.eventDate }, timedBackup.current), timeTba: false } : fields;
    const updated = acceptIntakeSuggestion({ fields: effective, acceptance });
    if (!updated) return;
    if (["timezone", "eventDate", "start", "end", "doors", "lineup"].includes(acceptance.key)) timezoneAuthored.current = true;
    const next = updated;
    if (fields.timeTba) timedBackup.current = { ...next, eventDate: next.eventDate ?? timedBackup.current?.eventDate };
    startAnchor.current = readIntakeInstant(next, next.start);
    setFields(fields.timeTba ? { ...untimed(next), timeTba: true, eventDate: acceptance.key === "eventDate" ? next.eventDate : fields.eventDate } : next);
  }
  function changeDate(eventDate: string | null) {
    timezoneAuthored.current = true;
    if (fields.timeTba) tbaDateEdited.current = true;
    setFields(current => current.timeTba ? { ...current, eventDate } : rebaseIntakeSuggestions(rebaseIntakeTimes(current, current.eventDate, eventDate), current.eventDate));
  }
  function changeStart(change: { eventDate: string | null; local: EventIntakeLocalTime | null }) {
    timezoneAuthored.current = true;
    const next = rebaseIntakeSuggestions({ ...fields, timezone: fields.timezone ?? (!fields.start && change.local ? editingTimezone : fields.timezone), eventDate: change.eventDate, start: change.local,
      end: rebaseTime(fields.end, fields.eventDate, change.eventDate), doors: rebaseTime(fields.doors, fields.eventDate, change.eventDate),
      lineup: fields.lineup?.map(row => ({ ...row, start: rebaseTime(row.start, fields.eventDate, change.eventDate), end: rebaseTime(row.end, fields.eventDate, change.eventDate) })),
    }, fields.eventDate);
    const nextStart = readIntakeInstant(next, next.start);
    try {
      const updated = nextStart !== undefined && startAnchor.current !== undefined
        ? applyIntakeLineupTimings(next, shiftLineupStart(readIntakeLineupTimings(fields), nextStart - startAnchor.current)) : next;
      if (!EventIntakePatchSchema.safeParse(updated).success) throw new RangeError("Event date must be valid.");
      setFields(updated);
      if (nextStart !== undefined) startAnchor.current = nextStart;
      return true;
    } catch { reveal("Lineup", '[data-lineup-row] [data-intake-time]'); return false; }
  }
  function toggleTba(checked: boolean) {
    timezoneAuthored.current = true;
    const invalid = form.current?.querySelector<HTMLInputElement>('[data-intake-time][aria-invalid="true"]');
    if (checked && invalid) { reveal(invalid.closest('[data-step="Lineup"]') ? "Lineup" : "Details", `[name="${invalid.name}"]`); return; }
    if (checked) {
      timedBackup.current = fields;
      tbaDateEdited.current = false;
      const instant = readIntakeInstant(fields, fields.start);
      const date = instant === undefined ? fields.eventDate ?? null : projectEditorTime({ instant, timezone: editingTimezone }).value.slice(0, 10);
      tbaDisplayDate.current = date;
      setFields({ ...untimed(fields), eventDate: date, timeTba: true });
    } else {
      const backup = timedBackup.current;
      const next = { ...restoreIntakeTiming({ ...fields, eventDate: backup?.eventDate ?? fields.eventDate, timezone: backup?.timezone ?? fields.timezone }, backup), timeTba: false };
      if (backup && tbaDateEdited.current && fields.eventDate !== tbaDisplayDate.current && fields.eventDate) {
        const originalStart = readIntakeInstant(backup, backup.start);
        if (originalStart !== undefined) {
          const original = projectEditorTime({ instant: originalStart, timezone: editingTimezone });
          const resolved = resolveEditorTime({ value: `${fields.eventDate}T${original.value.slice(11)}`, timezone: editingTimezone, occurrence: original.occurrence });
          if (resolved.kind !== "resolved") { reveal("Details", '[name="Starts"]'); return; }
          try {
            const canonicalDate = projectEditorTime({ instant: resolved.instant, timezone: next.timezone ?? editingTimezone }).value.slice(0, 10);
            const rebased = rebaseIntakeTimes(next, next.eventDate, canonicalDate);
            const updated = applyIntakeLineupTimings({ ...rebased, start: intakeLocalFromInstant(rebased, resolved.instant) }, shiftLineupStart(readIntakeLineupTimings(next), resolved.instant - originalStart));
            if (!EventIntakePatchSchema.safeParse(updated).success) throw new RangeError();
            setFields(updated); startAnchor.current = resolved.instant; return;
          } catch { reveal("Details", '[name="Starts"]'); return; }
        }
      }
      startAnchor.current = readIntakeInstant(next, next.start);
      setFields(next);
    }
  }
  function changeTimezone(timezone: string | null) {
    const invalid = form.current?.querySelector<HTMLInputElement>('[data-time-pending="true"]');
    if (invalid) { reveal(invalid.closest('[data-step="Lineup"]') ? "Lineup" : "Details", `[name="${invalid.name}"]`); return false; }
    if (!timezone) return false;
    editingTimezoneAuthored.current = true;
    setEditingTimezone(timezone);
    if (newDraft && !timezoneAuthored.current) setFields(current => ({ ...current, timezone }));
    return true;
  }
  const timings = readIntakeLineupTimings(fields);
  const eventStartAt = readIntakeInstant(fields, fields.start);
  const eventEndAt = readIntakeInstant(fields, fields.end);
  const conflict = getLineupEndConflict(eventEndAt, timings);
  function applyTimingEdit(result: LineupEditResult<LineupTimingRow>, focusKey?: string) {
    if (!result.ok) { reveal("Lineup", '[data-lineup-row] [data-intake-time]'); return; }
    try {
      const next = applyIntakeLineupTimings(fields, result.rows);
      setFields(next);
      if (eventStartAt !== undefined) startAnchor.current = eventStartAt;
      if (timedBackup.current) timedBackup.current = { ...timedBackup.current, lineup: timedBackup.current.lineup?.filter(row => result.rows.some(timing => timing.key === row.clientKey)) };
      if (focusKey) requestAnimationFrame(() => form.current?.querySelector<HTMLElement>(`[data-lineup-row="${focusKey}"] input`)?.focus());
    } catch { reveal("Lineup", '[data-lineup-row] [data-intake-time]'); }
  }
  function addUntimed(index: number) {
    if (timings.length >= 80) return;
    const key = crypto.randomUUID();
    applyTimingEdit({ ok: true, rows: [...timings.slice(0, index), { key }, ...timings.slice(index)] }, key);
  }
  const insertion = (index: number) => <EventLineupInsert index={index} atLimit={timings.length >= 80} disabled={fields.timeTba || (index === 0 ? eventStartAt : timings[index - 1]?.endAt) === undefined} onAddUntimed={addUntimed} onInsert={(index, durationMinutes) => {
    const key = crypto.randomUUID();
    applyTimingEdit(insertLineupSlot({ rows: timings, index, row: { key }, durationMinutes, eventStartAt }), key);
  }} />;
  const endConflict = conflict && eventEndAt !== undefined ? <EventLineupConflict {...conflict} eventEndAt={eventEndAt} timezone={editingTimezone} onExtend={endAt => { try { set("end", intakeLocalFromInstant(fields, endAt)); } catch { reveal("Details", '[name="Ends (optional)"]'); } }} /> : null;
  async function submit(publish: boolean) {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const invalidTime = Array.from(form.current?.querySelectorAll<HTMLInputElement>("[data-intake-time]") ?? []).find(input => input.validity.customError);
      if (invalidTime) {
        reveal(invalidTime.closest('[data-step="Lineup"]') ? "Lineup" : "Details", invalidTime.validationMessage.startsWith("Ambiguous") ? `[aria-label="${invalidTime.name} occurrence"]` : `[name="${invalidTime.name}"]`);
        throw new Error(invalidTime.validationMessage);
      }
      if (publish) {
        if (!fields.communitySlug || !fields.title || !fields.eventDate) { reveal("Details", !fields.communitySlug ? '[role="combobox"][aria-label="Community"]' : `[name="${!fields.title ? "title" : "Starts"}"]`); throw new Error("Add a community, title and date."); }
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
        if (conflict) { reveal("Lineup", '[data-lineup-conflict] button, [data-lineup-row] [data-intake-time]'); setBusy(false); return; }
        const derivedEnd = fields.end ? undefined : getLineupEndAt(timings);
        const published = derivedEnd === undefined ? fields : { ...fields, end: intakeLocalFromInstant(fields, derivedEnd) };
        await onPublish(fields.timeTba ? untimed(published) : published, revision);
      } else { await onSave?.(fields.timeTba ? untimed(fields) : fields, revision); timezoneAuthored.current = true; setMessage("Draft saved"); }
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
  let timezoneInstant: number | undefined;
  try { if (!fields.timeTba && fields.eventDate && fields.start && fields.timezone) timezoneInstant = selectEventLocalTime(fields.eventDate, fields.start, fields.timezone); } catch { /* Ambiguous or incomplete time has no offset yet. */ }
  return <><form ref={form} className="grid gap-6" onChangeCapture={event => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("[data-intake-time]")) timezoneAuthored.current = true;
  }} onInvalidCapture={event => { event.preventDefault(); const target = event.target as HTMLElement; if (target !== form.current?.querySelector("input:invalid, select:invalid, textarea:invalid")) return; const panel = target.closest<HTMLElement>("[data-step]"); if (panel) { event.preventDefault(); setActiveStep(panel.dataset.step as EventEditorStep); requestAnimationFrame(() => { const disclosure = target.closest("details"); if (disclosure) { disclosure.open = true; setEndOpen(true); } if (target instanceof HTMLInputElement && target.validationMessage.startsWith("Ambiguous")) {
      setMessage(target.validationMessage); form.current?.querySelector<HTMLElement>(`[aria-label="${target.name} occurrence"]`)?.focus();
    } else target.focus(); }); } }} onSubmit={event => { event.preventDefault(); if (activeStep === "Review") void submit(true); else setActiveStep(steps[steps.indexOf(activeStep) + 1]); }}>
    <EventEditorSteps heading={heading} actions={onSource ? <Button type="button" variant="primary" className="min-h-11 gap-2" onClick={() => {
      const invalid = form.current?.querySelector<HTMLInputElement>('[data-intake-time][aria-invalid="true"]');
      if (invalid) reveal(invalid.closest('[data-step="Lineup"]') ? "Lineup" : "Details", `[name="${invalid.name}"]`);
      else setImportOpen(true);
    }}><Upload aria-hidden="true" className="size-4" />Import poster or text</Button> : undefined} steps={steps} activeStep={activeStep} onSelect={setActiveStep} preview={<EventEditorPreview editingTimezone={editingTimezone} fields={{ ...fields, lineup: fields.lineup?.map(row => ({ ...row, performerLabel: row.performerLabel || performers.person(row.personSlug)?.title })) }} artwork={artwork} community={community} world={world} />}>
    <fieldset disabled={busy} className="grid min-w-0 gap-6">
    <div hidden={activeStep !== "Details"} data-step="Details"><section className="grid gap-4"><h2 className="text-xl font-semibold">Details</h2>{onSource ? <EventIntakeSuggestions fields={fields} onAccept={acceptSuggestion} /> : null}
    {!correction ? <div className="grid gap-2"><span className="text-sm font-medium">Community</span><EventIdentityPicker kind="community" selectedSlug={fields.communitySlug} selectedOption={community} shortcuts={shortcuts} onSelect={option => { setSelectedCommunity(option); set("communitySlug", option.slug); }} onClear={() => { setSelectedCommunity(undefined); set("communitySlug", null); }} /></div> : null}
    <Field>Event title<Input name="title" value={fields.title ?? ""} maxLength={120} onChange={event => set("title", event.target.value)} /></Field>
    <label className="flex items-center gap-2"><input type="checkbox" checked={fields.timeTba ?? false} onChange={event => toggleTba(event.target.checked)} />Time TBA</label>
    {fields.timeTba ? <div className="grid gap-2"><Field>Starts<Input name="Starts" type="date" value={fields.eventDate ?? ""} onChange={event => changeDate(event.target.value || null)} /></Field><EventTimezonePicker name="editingTimezone" value={editingTimezone} date={null} preferredValue={savedTimezonePreference} onChange={changeTimezone} /></div> : null}
    <input type="hidden" name="timezone" value={fields.timezone ?? ""} />
    {!fields.timezone && [fields.start, fields.end, fields.doors, ...(fields.lineup ?? []).flatMap(row => [row.start, row.end])].some(Boolean) ? <section className="grid gap-2"><h3>Unresolved time</h3><EventTimezonePicker name="sourceTimezone" value={null} date={fields.eventDate ?? null} onChange={zone => { timezoneAuthored.current = true; const next = { ...fields, timezone: zone }; startAnchor.current = readIntakeInstant(next, next.start); setFields(next); }} /></section> : null}
    {!fields.timeTba ? <><div className="grid items-start gap-3 sm:grid-cols-2"><div className="grid gap-2"><IntakeTime label="Starts" eventStart value={fields.start} date={fields.eventDate} timezone={fields.timezone} displayTimezone={editingTimezone} onChange={changeStart} /><div className="grid gap-2"><EventTimezonePicker name="editingTimezone" value={editingTimezone} date={fields.eventDate ?? null} instant={timezoneInstant} preferredValue={savedTimezonePreference} onChange={changeTimezone} /></div></div><details className="relative" open={endOpen} onToggle={event => setEndOpen(event.currentTarget.open)}><summary className={`cursor-pointer font-medium ${endOpen ? "absolute right-0 top-0 text-xs" : "text-sm"}`}>Add end time</summary><div><IntakeTime label="Ends (optional)" value={fields.end} date={fields.eventDate} timezone={fields.timezone} displayTimezone={editingTimezone} onChange={change => set("end", change.local)} /></div></details></div><details className="relative" open={doorsOpen} onToggle={event => setDoorsOpen(event.currentTarget.open)}><summary className={`cursor-pointer font-medium ${doorsOpen ? "absolute right-0 top-0 text-xs" : "text-sm"}`}>Add doors-open time</summary><IntakeTime label="Doors open" value={fields.doors} date={fields.eventDate} timezone={fields.timezone} displayTimezone={editingTimezone} onChange={change => set("doors", change.local)} /></details></> : null}
    <EventLocationField selectedWorld={world} onWorldPresentation={setSelectedWorld} worldSlug={fields.worldSlug ?? ""} venueLabel={fields.venueLabel ?? ""} onChange={next => setFields(current => ({ ...current, worldSlug: next.worldSlug || null, venueLabel: next.venueLabel || null }))} />
    <Field>Description<Textarea value={fields.summary ?? ""} maxLength={240} onChange={event => set("summary", event.target.value)} /></Field>
    <details><summary className="cursor-pointer text-sm font-medium">Original event post</summary><Field className="mt-3">Original event post<Input type="url" value={fields.sourceUrl ?? ""} onChange={event => set("sourceUrl", event.target.value)} /></Field></details>
    {!correction && !onSource ? <details><summary className="cursor-pointer font-medium">Source text</summary><Textarea aria-label="Source text" className="mt-3" value={fields.sourceText ?? ""} maxLength={12000} onChange={event => set("sourceText", event.target.value)} /></details> : null}
    </section></div>
    <div hidden={activeStep !== "Lineup"} data-step="Lineup"><section className="grid gap-4"><h2 className="text-xl font-semibold">Lineup</h2>{onSource ? <EventIntakeSuggestions fields={fields} onAccept={acceptSuggestion} lineup /> : null}
      {!timings.length ? <EventLineupSetup disabled={eventStartAt === undefined} onAddPerformer={() => addUntimed(0)} onGenerate={(count, durationMinutes) => applyTimingEdit(generateLineupTimings({ startAt: eventStartAt ?? NaN, count, durationMinutes, keys: Array.from({ length: count }, () => crypto.randomUUID()) }))} /> : insertion(0)}
      {(fields.lineup ?? []).map((row, index) => {
        const timing = timings[index];
        const previousEnd = timings[index - 1]?.endAt;
        const gap = timing?.startAt !== undefined && previousEnd !== undefined ? (timing.startAt - previousEnd) / 60_000 : 0;
        const duration = timing?.startAt !== undefined && timing.endAt !== undefined && timing.endAt > timing.startAt ? (timing.endAt - timing.startAt) / 60_000 : undefined;
        return <Fragment key={row.clientKey}>{gap !== 0 ? <p className={gap < 0 ? "text-sm text-danger" : "text-sm text-muted"}>{gap < 0 ? "Overlap" : "Break"}: {Math.abs(gap)} min</p> : null}<fieldset data-lineup-row={row.clientKey} className="grid gap-3 rounded-control border border-border p-4"><legend className="px-1">Slot {index + 1}</legend>
        <EventPerformerField required value={performers.value({ key: row.clientKey, label: row.performerLabel ?? "", personSlug: row.personSlug })} selectedPerson={performers.person(row.personSlug)} onResolve={performers.resolve} disabled={busy} onChange={value => {
          const next = performers.change({ key: row.clientKey, label: row.performerLabel ?? "", personSlug: row.personSlug }, value);
          set("lineup", fields.lineup!.map(item => item.clientKey === row.clientKey ? { ...item, performerLabel: next.label, personSlug: next.personSlug || undefined } : item));
        }} />
        {!fields.timeTba ? <div className="flex flex-wrap items-end justify-between gap-3"><p className="text-sm text-muted">{formatLineupTimeRange({ ...timing, timezone: editingTimezone, eventDate: eventStartAt === undefined ? fields.eventDate : projectEditorTime({ instant: eventStartAt, timezone: editingTimezone }).value.slice(0, 10) })}</p><EventSlotDuration value={duration} onCommit={minutes => applyTimingEdit(changeLineupDuration(timings, row.clientKey, minutes))} /></div> : null}
        <details><summary className="cursor-pointer text-sm font-medium">Details</summary><div className="mt-3 grid gap-3">
        <Field>Role<Input value={row.roleLabel ?? ""} onChange={event => set("lineup", fields.lineup!.map(item => item.clientKey === row.clientKey ? { ...item, roleLabel: event.target.value } : item))} /></Field>
        {!fields.timeTba ? <><IntakeTime label={`Slot ${index + 1} start`} value={row.start} date={fields.eventDate} timezone={fields.timezone} displayTimezone={editingTimezone} onChange={change => set("lineup", fields.lineup!.map(item => item.clientKey === row.clientKey ? { ...item, start: change.local } : item))} /><IntakeTime label={`Slot ${index + 1} end`} value={row.end} date={fields.eventDate} timezone={fields.timezone} displayTimezone={editingTimezone} onChange={change => set("lineup", fields.lineup!.map(item => item.clientKey === row.clientKey ? { ...item, end: change.local } : item))} /></> : null}
        </div></details><Button type="button" variant="ghost" className="justify-self-start" onClick={() => applyTimingEdit(removeLineupSlot(timings, row.clientKey))}>Remove slot</Button>
      </fieldset>{insertion(index + 1)}</Fragment>; })}
      {timings.length ? <EventLineupReset onConfirm={() => { set("lineup", []); if (timedBackup.current) timedBackup.current = { ...timedBackup.current, lineup: [] }; }} /> : null}
      {endConflict}
    </section>
    </div>
    <div hidden={activeStep !== "Review"} data-step="Review" className="space-y-5">
    <section className="grid gap-4"><h2 className="text-xl font-semibold">Review</h2>{activeStep === "Review" ? <Button type="submit" variant="primary" className="justify-self-start" disabled={busy}>{correction ? "Save changes" : "Publish event"}</Button> : null}{endConflict}<div className="grid gap-4 rounded-control border border-border p-4">
      <div className="flex items-start justify-between gap-4"><div><h3 className="font-semibold">{fields.title || "Event title"}</h3>{fields.communitySlug ? <EventCommunitySummary community={community} /> : null}<p className="text-sm text-muted">{[fields.timeTba ? fields.eventDate : eventStartAt === undefined ? eventLocalDate(fields.eventDate, fields.start) : projectEditorTime({ instant: eventStartAt, timezone: editingTimezone }).value.replace("T", " "), fields.timeTba ? "Time TBA" : eventTimezoneLabel(editingTimezone, eventStartAt), fields.venueLabel || world?.title].filter(Boolean).join(" · ")}</p></div><Button type="button" variant="secondary" onClick={() => setActiveStep("Details")}>Edit details</Button></div>
      {fields.summary ? <p className="text-sm">{fields.summary}</p> : null}
      <div className="flex items-start justify-between gap-4 border-t border-border pt-4"><div><h3 className="font-semibold">Lineup</h3>{fields.lineup?.map(row => <p key={row.clientKey} className="text-sm">{row.performerLabel || performers.person(row.personSlug)?.title}</p>)}</div><Button type="button" variant="secondary" onClick={() => setActiveStep("Lineup")}>Edit lineup</Button></div>
    </div></section>
    {duplicates.length ? <section className="grid gap-3"><h2 className="text-xl font-semibold">Similar events</h2>{duplicates.map(item => <div key={item.eventId}><Link className="underline" href={item.eventPath}>{item.title}</Link><label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={fields.duplicateAcknowledgements?.includes(item.eventId) ?? false} onChange={event => set("duplicateAcknowledgements", event.target.checked ? [...fields.duplicateAcknowledgements ?? [], item.eventId] : fields.duplicateAcknowledgements?.filter(id => id !== item.eventId))} />Different event</label></div>)}</section> : null}
    </div>
    </fieldset>
    </EventEditorSteps>
    <fieldset disabled={busy} className="flex flex-wrap items-center gap-3 border-t border-border pt-5"><span className="mr-auto text-sm text-muted">{steps.indexOf(activeStep) + 1} / {steps.length}</span>{activeStep !== steps[0] ? <Button type="button" variant="secondary" onClick={() => setActiveStep(steps[steps.indexOf(activeStep) - 1])}>Back</Button> : null}{activeStep !== "Review" ? <Button type="submit" formNoValidate variant="primary">Continue</Button> : null}{onSave ? <Button type="button" disabled={busy} variant="secondary" onClick={() => void submit(false)}>Save draft</Button> : null}</fieldset>
    {message && !importOpen ? <Notice><span role="status">{message}</span></Notice> : null}
  </form>
  {onSource ? <EventIntakeDialog open={importOpen} onClose={() => setImportOpen(false)}><fieldset disabled={busy}><EventIntakeSource fields={fields} revision={revision} onChange={receiveFields} action={onSource} busy={busy} setBusy={setBusy} setMessage={setMessage} initialArtworkSourceId={initialArtworkSourceId} onPreview={setArtwork} onExtract={() => { focusExtractedDetails.current = true; setActiveStep("Details"); setImportOpen(false); }} /></fieldset>{message ? <Notice><span role="status">{message}</span></Notice> : null}</EventIntakeDialog> : null}
  </>;
}

function ConnectedIntake({ draftId, initialCommunitySlug, heading }: { draftId?: string; initialCommunitySlug?: string; heading?: ReactNode }) {
  const router = useRouter();
  const viewer = useQuery(api.accounts.viewer);
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
  return <EventIntakeFieldsForm heading={heading} savedTimezonePreference={viewer?.user.defaultEventTimezone} newDraft={!draftId} initialFields={loaded?.fields ?? { communitySlug: initialCommunitySlug, timeTba: false }} initialRevision={loaded?.version} onSource={sourceAction} initialArtworkSourceId={loaded?.artworkSourceId} onSave={async (fields, revision) => { await saveFields(fields, revision); }} onPublish={async (fields, revision) => {
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
