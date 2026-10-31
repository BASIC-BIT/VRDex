"use client";
import { authoredSnapshot, hasUnsavedEventChanges, mergeSavedEventFields } from "@/lib/event-editor-persistence";
import { EventEditorPendingContext, useEventEditorPending, useEventEditorLeaveGuard, usePendingEventInput } from "./use-event-editor-leave-guard";
import { formatLineupTimeRange } from "@/lib/calendar/event-lineup-display";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Upload } from "lucide-react";
import { EventIntakeDialog } from "./event-intake-dialog";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useConvex, useConvexAuth, useMutation, useQuery } from "convex/react";
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
import { acceptIntakeSuggestion, rebaseIntakeTime as rebaseTime, rebaseIntakeTimes, rebaseIntakeSuggestions, type IntakeSuggestionAcceptance } from "@/lib/calendar/event-intake-suggestions";
import { EventPerformerField, useEventPerformerEditor } from "./event-performer-field";
import { applyIntakeLineupTimings, intakeLocalFromInstant, readIntakeInstant, readIntakeLineupTimings } from "@/lib/calendar/event-lineup-adapters";
import { changeLineupDuration, generateLineupTimings, getLineupEndAt, getLineupEndConflict, insertLineupSlot, removeLineupSlot, shiftLineupStart, type LineupEditResult, type LineupTimingRow } from "@/lib/calendar/event-lineup-timing";
import { EventSlotRemove, EventLineupSetup, EventLineupInsert, EventSlotDuration, EventLineupReset, EventLineupConflict } from "./event-lineup-controls";
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
  const pending = edit;
  usePendingEventInput(pending !== null);
  const raw = pending?.value ?? projected.value;
  const occurrence = pending ? pending.occurrence : projected.occurrence;
  const resolution = resolveEditorTime({ value: raw, timezone: zone ?? "", occurrence });
  const choices = zone && raw ? resolveEditorTime({ value: raw, timezone: zone }) : { kind: "empty" as const };
  const invalid = Boolean(pending);
  const validityMessage = !invalid ? "" : resolution.kind === "gap" ? "Local time does not exist in this timezone." : resolution.kind === "ambiguous" ? "Ambiguous local time requires an earlier or later occurrence." : "Event date must be valid.";
  useEffect(() => { control.current?.querySelector("input")?.setCustomValidity(validityMessage); onPendingEditChange?.(invalid); }, [invalid, validityMessage, onPendingEditChange]);
  function commit(next: string, nextOccurrence?: EventIntakeLocalTime["occurrence"]) {
    try {
      if (!next) { if (onChange({ eventDate: date ?? null, local: null }) === false) { setEdit({ source, value: next, occurrence: nextOccurrence }); return; } setEdit(null); return; }
      if (!zone) { const change = parseIntakeDateTimeInput({ value: next, eventDate: date, eventStart }); if (onChange(change) === false) { setEdit({ source, value: next, occurrence: nextOccurrence }); return; } setEdit(null); return; }
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
export type EventSubmitCompletion = { kind: "saved" } | { kind: "published"; eventId: Id<"events">; eventPath: string };

export function EventIntakeFieldsForm({ initialFields, initialRevision = 0, correction = false, connectorDraft = false, onSave, onPublish, onSource, initialArtworkSourceId, heading, savedTimezonePreference, newDraft = false, onDone, onGuardChange }: { onDone?: () => void; onGuardChange?: (requestLeave: (navigate: () => void) => boolean) => void; savedTimezonePreference?: string | null; newDraft?: boolean; heading?: ReactNode; initialFields: EventIntakeFields; initialRevision?: number; correction?: boolean; connectorDraft?: boolean; onSource?: IntakeSourceAction; initialArtworkSourceId?: string; onSave?: (fields: EventIntakeFields, revision: number) => Promise<void>; onPublish: (fields: EventIntakeFields, revision: number) => Promise<EventSubmitCompletion> }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const performers = useEventPerformerEditor();
  const [fields, setFields] = useState(() => initialFields.timeTba ? untimed(initialFields) : initialFields);
  const requiresStart = !(correction || connectorDraft) || fields.timeTba !== true || Boolean(fields.lineup?.some(row => row.relativeTiming));
  const pendingInputs = useEventEditorPending();
  const [persisted, setPersisted] = useState(() => authoredSnapshot(initialFields.timeTba ? untimed(initialFields) : initialFields));
  const pendingRef = useRef(pendingInputs.pending);
  useLayoutEffect(() => { pendingRef.current = pendingInputs.pending; }, [pendingInputs.pending]);
  const dirty = hasUnsavedEventChanges({ current: authoredSnapshot(fields), persisted, pendingInput: pendingInputs.pending });
  const { requestLeave } = useEventEditorLeaveGuard({ dirty });
  const [completion, setCompletion] = useState<EventSubmitCompletion>();
  useEffect(() => { if (completion) { setCompletion(undefined); if (completion.kind === "saved" && !onDone) return; requestLeave(() => { if (completion.kind === "published") router.replace(completion.eventPath); else onDone?.(); }); } }, [completion, requestLeave, router, onDone]);
  useEffect(() => { onGuardChange?.(requestLeave); }, [onGuardChange, requestLeave]);
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
    if (!timezoneAuthored.current) {
      setFields(current => {
        const next = { ...current, timezone };
        setPersisted(previous => previous === authoredSnapshot(current) ? authoredSnapshot(next) : previous);
        return next;
      });
    }
  }, [savedTimezonePreference, newDraft]);
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

      startAnchor.current = readIntakeInstant(updated, updated.start) ?? startAnchor.current;
      return updated.timeTba ? untimed(updated) : updated;
    });
  }
  function acceptSuggestion(acceptance: IntakeSuggestionAcceptance) {
    const updated = acceptIntakeSuggestion({ fields, acceptance });
    if (!updated) return;
    if (["timezone", "eventDate", "start", "end", "doors", "lineup"].includes(acceptance.key)) timezoneAuthored.current = true;
    const next = { ...updated, timeTba: updated.start ? false : updated.timeTba };
    startAnchor.current = readIntakeInstant(next, next.start) ?? startAnchor.current;
    setFields(next);
  }
  function changeStart(change: { eventDate: string | null; local: EventIntakeLocalTime | null }) {
    timezoneAuthored.current = true;
    const hasSourceClocks = [fields.start, fields.end, fields.doors, ...(fields.lineup ?? []).flatMap(row => [row.start, row.end])].some(Boolean);
    const next = rebaseIntakeSuggestions({ ...fields, timeTba: change.local ? false : fields.timeTba, timezone: fields.timezone ?? (!hasSourceClocks && change.local ? editingTimezone : fields.timezone), eventDate: change.eventDate, start: change.local,
      end: rebaseTime(fields.end, fields.eventDate, change.eventDate), doors: rebaseTime(fields.doors, fields.eventDate, change.eventDate),
      lineup: fields.lineup?.map(row => ({ ...row, start: rebaseTime(row.start, fields.eventDate, change.eventDate), end: rebaseTime(row.end, fields.eventDate, change.eventDate) })),
    }, fields.eventDate);
    const nextStart = readIntakeInstant(next, next.start);
    try {
      let updated = next;
      if (nextStart !== undefined && startAnchor.current !== undefined) {
        const resolved = readIntakeLineupTimings(next);
        const shifted = shiftLineupStart(readIntakeLineupTimings(fields), nextStart - startAnchor.current);
        updated = applyIntakeLineupTimings(next, shifted.map((timing, index) => next.lineup?.[index]?.relativeTiming ? resolved[index]! : timing));
      }
      const previousStart = readIntakeInstant(fields, fields.start);
      if (!change.local && previousStart !== undefined) {
        const previousTimings = readIntakeLineupTimings(fields);
        updated = { ...updated, lineup: updated.lineup?.map((row, index) => {
          const timing = previousTimings[index];
          return timing?.startAt !== undefined && timing.endAt !== undefined
            ? { ...row, start: null, end: null, relativeTiming: { offsetMinutes: (timing.startAt - previousStart) / 60_000, durationMinutes: (timing.endAt - timing.startAt) / 60_000 } } : row;
        }) };
      }
      if (!EventIntakePatchSchema.safeParse(updated).success) throw new RangeError("Event date must be valid.");
      setFields(updated);
      if (nextStart !== undefined) startAnchor.current = nextStart;
      return true;
    } catch { reveal("Details", '[name="Starts"]'); return false; }
  }
  function revealPendingTime() {
    const invalid = form.current?.querySelector<HTMLInputElement>('[data-time-pending="true"]');
    if (!invalid) return false;
    setActiveStep(invalid.closest('[data-step="Lineup"]') ? "Lineup" : "Details");
    requestAnimationFrame(() => {
      const disclosure = invalid.closest("details");
      if (disclosure) { disclosure.open = true; setEndOpen(true); }
      invalid.focus();
    });
    return true;
  }
  function changeTimezone(timezone: string | null) {
    if (revealPendingTime()) return false;
    if (!timezone) return false;
    editingTimezoneAuthored.current = true;
    setEditingTimezone(timezone);
    if (newDraft && !timezoneAuthored.current) setFields(current => ({ ...current, timezone }));
    return true;
  }
  const timings = readIntakeLineupTimings(fields);
  const eventStartAt = readIntakeInstant(fields, fields.start);
  const eventEndAt = readIntakeInstant(fields, fields.end);
  const conflict = eventStartAt === undefined ? undefined : getLineupEndConflict(eventEndAt, timings);
  function applyTimingEdit(result: LineupEditResult<LineupTimingRow>, focusKey?: string) {
    if (!result.ok) { reveal("Lineup", '[data-lineup-row] [data-intake-time]'); return; }
    try {
      const next = applyIntakeLineupTimings(fields, result.rows);
      setFields(next);
      if (eventStartAt !== undefined) startAnchor.current = eventStartAt;
      if (focusKey) requestAnimationFrame(() => form.current?.querySelector<HTMLElement>(`[data-lineup-row="${focusKey}"] input`)?.focus());
    } catch { reveal("Lineup", '[data-lineup-row] [data-intake-time]'); }
  }
  function addUntimed(index: number) {
    if (timings.length >= 80) return;
    const key = crypto.randomUUID();
    applyTimingEdit({ ok: true, rows: [...timings.slice(0, index), { key }, ...timings.slice(index)] }, key);
  }
  const insertion = (index: number) => <EventLineupInsert index={index} atLimit={timings.length >= 80} disabled={(index === 0 ? eventStartAt ?? 0 : timings[index - 1]?.endAt) === undefined} onAddUntimed={addUntimed} onInsert={(index, durationMinutes) => {
    const key = crypto.randomUUID();
    applyTimingEdit(insertLineupSlot({ rows: timings, index, row: { key }, durationMinutes, eventStartAt: eventStartAt ?? 0 }), key);
  }} />;
  const endConflict = conflict && eventEndAt !== undefined ? <EventLineupConflict {...conflict} eventEndAt={eventEndAt} timezone={editingTimezone} onExtend={endAt => { try { set("end", intakeLocalFromInstant(fields, endAt)); } catch { reveal("Details", '[name="Ends (optional)"]'); } }} /> : null;
  async function submit(publish: boolean) {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const pendingInput = form.current?.querySelector<HTMLInputElement>('[data-pending-event-input="true"]');
      if (pendingInput) { setActiveStep(pendingInput.closest('[data-step="Lineup"]') ? "Lineup" : "Details"); requestAnimationFrame(() => { const detail = pendingInput.closest("details"); if (detail) detail.open = true; pendingInput.focus(); pendingInput.reportValidity(); }); return; }
      const invalidTime = Array.from(form.current?.querySelectorAll<HTMLInputElement>("[data-intake-time]") ?? []).find(input => input.validity.customError);
      if (invalidTime) {
        reveal(invalidTime.closest('[data-step="Lineup"]') ? "Lineup" : "Details", invalidTime.validationMessage.startsWith("Ambiguous") ? `[aria-label="${invalidTime.name} occurrence"]` : `[name="${invalidTime.name}"]`);
        throw new Error(invalidTime.validationMessage);
      }
      if (publish) {
        if (!fields.communitySlug || !fields.title || !fields.eventDate) { reveal("Details", !fields.communitySlug ? '[role="combobox"][aria-label="Community"]' : `[name="${!fields.title ? "title" : "Starts"}"]`); throw new Error("Add a community, title and date."); }
        if (requiresStart && (fields.timeTba || !fields.start)) { reveal("Details", '[name="Starts"]'); return; }
        if (requiresStart && !fields.timezone) { reveal("Details", '[aria-label="Time zone"]'); throw new Error("Choose a time zone."); }
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
        const submitted = fields;
        const result = await onPublish(fields.timeTba ? untimed(published) : published, revision);
        setPersisted(authoredSnapshot(submitted));
        setCompletion(result);
      } else { await onSave?.(fields.timeTba ? untimed(fields) : fields, revision); setPersisted(authoredSnapshot(fields)); timezoneAuthored.current = true; setMessage("Draft saved"); }
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
  const startControl = <div className="grid gap-2"><IntakeTime label="Starts" required={requiresStart} eventStart value={fields.start} date={fields.eventDate} timezone={fields.timezone} displayTimezone={editingTimezone} onChange={changeStart} /><EventTimezonePicker name="editingTimezone" value={editingTimezone} date={fields.eventDate ?? null} instant={timezoneInstant} preferredValue={savedTimezonePreference} onChange={changeTimezone} /></div>;
  return <EventEditorPendingContext.Provider value={pendingInputs.register}><form ref={form} data-event-dirty={dirty} className="grid gap-6" onChangeCapture={event => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("[data-intake-time]")) timezoneAuthored.current = true;
  }} onInvalidCapture={event => { event.preventDefault(); const target = event.target as HTMLElement; if (target !== form.current?.querySelector("input:invalid, select:invalid, textarea:invalid")) return; const panel = target.closest<HTMLElement>("[data-step]"); if (panel) { event.preventDefault(); setActiveStep(panel.dataset.step as EventEditorStep); requestAnimationFrame(() => { const disclosure = target.closest("details"); if (disclosure) { disclosure.open = true; setEndOpen(true); } if (target instanceof HTMLInputElement && target.validity.customError) setMessage(target.validationMessage);
    if (target instanceof HTMLInputElement && target.validationMessage.startsWith("Ambiguous")) { form.current?.querySelector<HTMLElement>(`[aria-label="${target.name} occurrence"]`)?.focus();
    } else target.focus(); }); } }} onSubmit={event => { event.preventDefault(); if (activeStep === "Review") void submit(true); else setActiveStep(steps[steps.indexOf(activeStep) + 1]); }}>
    <EventEditorSteps heading={heading} actions={onSource ? <Button type="button" variant="primary" className="min-h-11 gap-2" onClick={() => {
      const invalid = form.current?.querySelector<HTMLInputElement>('[data-intake-time][aria-invalid="true"]');
      if (invalid) reveal(invalid.closest('[data-step="Lineup"]') ? "Lineup" : "Details", `[name="${invalid.name}"]`);
      else setImportOpen(true);
    }}><Upload aria-hidden="true" className="size-4" />Import poster or text</Button> : undefined} steps={steps} activeStep={activeStep} onSelect={setActiveStep} preview={<EventEditorPreview editingTimezone={editingTimezone} fields={{ ...fields, lineup: fields.lineup?.map(row => ({ ...row, performerLabel: row.performerLabel || performers.person(row.personSlug)?.title })) }} artwork={artwork} community={community} world={world} />}>
    <fieldset className="grid min-w-0 gap-6">
    <div hidden={activeStep !== "Details"} data-step="Details"><section className="grid gap-4"><h2 className="text-xl font-semibold">Details</h2>{onSource ? <EventIntakeSuggestions fields={fields} onAccept={acceptSuggestion} /> : null}
    {!correction ? <div className="grid gap-2"><span className="text-sm font-medium">Community</span><EventIdentityPicker kind="community" selectedSlug={fields.communitySlug} selectedOption={community} shortcuts={shortcuts} onSelect={option => { setSelectedCommunity(option); set("communitySlug", option.slug); }} onClear={() => { setSelectedCommunity(undefined); set("communitySlug", null); }} /></div> : null}
    <Field>Event title<Input name="title" value={fields.title ?? ""} maxLength={120} onChange={event => set("title", event.target.value)} /></Field>
    <input type="hidden" name="timezone" value={fields.timezone ?? ""} />
    {!fields.timezone && [fields.start, fields.end, fields.doors, ...(fields.lineup ?? []).flatMap(row => [row.start, row.end])].some(Boolean) ? <section className="grid gap-2"><h3>Unresolved time</h3><EventTimezonePicker name="sourceTimezone" value={null} date={fields.eventDate ?? null} onChange={zone => { if (revealPendingTime()) return false; timezoneAuthored.current = true; const next = { ...fields, timezone: zone }; startAnchor.current = readIntakeInstant(next, next.start) ?? startAnchor.current; setFields(next); }} /></section> : null}
    <div className="grid items-start gap-3 sm:grid-cols-2">
      {fields.timeTba ? <div className="grid gap-3"><Field>Date<Input type="date" required value={fields.eventDate ?? ""} onChange={event => { timezoneAuthored.current = true; const date = event.target.value || null; setFields(current => rebaseIntakeSuggestions(rebaseIntakeTimes(current, current.eventDate, date), current.eventDate)); }} /></Field><details open={fields.lineup?.some(row => row.relativeTiming) || undefined}><summary className="cursor-pointer text-sm font-medium">Add start time</summary><div className="mt-3">{startControl}</div></details></div> : startControl}
      {!fields.timeTba ? <div className={`flex flex-wrap items-start gap-x-5 gap-y-3 ${endOpen || doorsOpen ? "" : "pt-1 sm:pt-7"}`}>
        <details className={`relative min-w-0 ${endOpen ? "w-full" : "w-fit"}`} open={endOpen} onToggle={event => setEndOpen(event.currentTarget.open)}><summary className={`cursor-pointer font-medium ${endOpen ? "absolute right-0 top-0 text-xs" : "text-sm"}`}>Add end time</summary><IntakeTime label="Ends (optional)" value={fields.end} date={fields.eventDate} timezone={fields.timezone} displayTimezone={editingTimezone} onChange={change => set("end", change.local)} /></details>
        <details className={`relative min-w-0 ${doorsOpen ? "w-full" : "w-fit"}`} open={doorsOpen} onToggle={event => setDoorsOpen(event.currentTarget.open)}><summary className={`cursor-pointer font-medium ${doorsOpen ? "absolute right-0 top-0 text-xs" : "text-sm"}`}>Add doors-open time</summary><IntakeTime label="Doors open" value={fields.doors} date={fields.eventDate} timezone={fields.timezone} displayTimezone={editingTimezone} onChange={change => set("doors", change.local)} /></details>
      </div> : null}
    </div>
    <EventLocationField selectedWorld={world} onWorldPresentation={setSelectedWorld} worldSlug={fields.worldSlug ?? ""} venueLabel={fields.venueLabel ?? ""} onChange={next => setFields(current => ({ ...current, worldSlug: next.worldSlug || null, venueLabel: next.venueLabel || null }))} />
    <Field>Description<Textarea rows={5} className="min-h-36" value={fields.summary ?? ""} maxLength={240} onChange={event => set("summary", event.target.value)} /></Field>
    <details><summary className="cursor-pointer text-sm font-medium">Announcement link</summary><Field className="mt-3">Announcement link<Input type="url" value={fields.sourceUrl ?? ""} onChange={event => set("sourceUrl", event.target.value)} /></Field></details>
    {!correction && !onSource ? <details><summary className="cursor-pointer font-medium">Source text</summary><Textarea aria-label="Source text" className="mt-3" value={fields.sourceText ?? ""} maxLength={12000} onChange={event => set("sourceText", event.target.value)} /></details> : null}
    </section></div>
    <div hidden={activeStep !== "Lineup"} data-step="Lineup"><section className="grid gap-4"><h2 className="text-xl font-semibold">Lineup</h2>{onSource ? <EventIntakeSuggestions fields={fields} onAccept={acceptSuggestion} lineup /> : null}
      {!timings.length ? <EventLineupSetup onAddPerformer={() => addUntimed(0)} onGenerate={(count, durationMinutes) => applyTimingEdit(generateLineupTimings({ startAt: eventStartAt ?? 0, count, durationMinutes, keys: Array.from({ length: count }, () => crypto.randomUUID()) }))} /> : insertion(0)}
      {(fields.lineup ?? []).map((row, index) => {
        const timing = timings[index];
        const previousEnd = timings[index - 1]?.endAt;
        let startClock = row.start;
        let endClock = row.end;
        let editableClocks = !row.relativeTiming;
        if (row.relativeTiming && eventStartAt !== undefined && timing?.startAt !== undefined && timing.endAt !== undefined) {
          try { startClock = intakeLocalFromInstant(fields, timing.startAt); endClock = intakeLocalFromInstant(fields, timing.endAt); editableClocks = true; }
          catch { /* Relative drafts may exceed the source clock's date range. */ }
        }
        const gap = timing?.startAt !== undefined && previousEnd !== undefined ? (timing.startAt - previousEnd) / 60_000 : 0;
        const duration = timing?.startAt !== undefined && timing.endAt !== undefined && timing.endAt > timing.startAt ? (timing.endAt - timing.startAt) / 60_000 : undefined;
        return <Fragment key={row.clientKey}>{gap !== 0 ? <p className={gap < 0 ? "text-sm text-danger" : "text-sm text-muted"}>{gap < 0 ? "Overlap" : "Break"}: {Math.abs(gap)} min</p> : null}<fieldset data-lineup-row={row.clientKey} className="grid gap-3 rounded-control border border-border p-4"><legend className="px-1">Slot {index + 1}</legend>
        <EventPerformerField required value={performers.value({ key: row.clientKey, label: row.performerLabel ?? "", personSlug: row.personSlug })} selectedPerson={performers.person(row.personSlug)} onResolve={performers.resolve} onChange={value => {
          const next = performers.change({ key: row.clientKey, label: row.performerLabel ?? "", personSlug: row.personSlug }, value);
          set("lineup", fields.lineup!.map(item => item.clientKey === row.clientKey ? { ...item, performerLabel: next.label, personSlug: next.personSlug || undefined } : item));
        }} />
        {!fields.timeTba || row.relativeTiming ? <div className="flex flex-wrap items-end justify-between gap-3"><p className="text-sm text-muted">{formatLineupTimeRange({ ...timing, relative: Boolean(row.relativeTiming && eventStartAt === undefined), timezone: editingTimezone, eventDate: eventStartAt === undefined ? fields.eventDate : projectEditorTime({ instant: eventStartAt, timezone: editingTimezone }).value.slice(0, 10) })}</p><EventSlotDuration value={duration} onCommit={minutes => applyTimingEdit(changeLineupDuration(timings, row.clientKey, minutes))} /></div> : null}
        <details><summary className="cursor-pointer text-sm font-medium">Details</summary><div className="mt-3 grid gap-3">
        <Field>Role<Input value={row.roleLabel ?? ""} onChange={event => set("lineup", fields.lineup!.map(item => item.clientKey === row.clientKey ? { ...item, roleLabel: event.target.value } : item))} /></Field>
        {!fields.timeTba && editableClocks ? <><IntakeTime label={`Slot ${index + 1} start`} value={startClock} date={fields.eventDate} timezone={fields.timezone} displayTimezone={editingTimezone} onChange={change => set("lineup", fields.lineup!.map(item => item.clientKey === row.clientKey ? { ...item, relativeTiming: undefined, start: change.local, end: endClock } : item))} /><IntakeTime label={`Slot ${index + 1} end`} value={endClock} date={fields.eventDate} timezone={fields.timezone} displayTimezone={editingTimezone} onChange={change => set("lineup", fields.lineup!.map(item => item.clientKey === row.clientKey ? { ...item, relativeTiming: undefined, start: startClock, end: change.local } : item))} /></> : null}
        </div></details><EventSlotRemove label={row.performerLabel || performers.person(row.personSlug)?.title} range={formatLineupTimeRange({ ...timing, relative: Boolean(row.relativeTiming && eventStartAt === undefined), timezone: editingTimezone })} onConfirm={() => applyTimingEdit(removeLineupSlot(timings, row.clientKey))} />
      </fieldset>{insertion(index + 1)}</Fragment>; })}
      {timings.length ? <EventLineupReset onConfirm={() => set("lineup", [])} /> : null}
      {endConflict}
    </section>
    </div>
    <div hidden={activeStep !== "Review"} data-step="Review" className="space-y-5">
    <section className="grid gap-4"><h2 className="text-xl font-semibold">Review</h2>{activeStep === "Review" ? <Button type="submit" variant="primary" size="lg" className="min-h-14 gap-4 justify-self-start px-7 text-base shadow-lg shadow-accent/20 hover:shadow-accent/30" disabled={busy}>{correction ? "Save changes" : "Publish event"}<ArrowUpRight aria-hidden="true" className="size-5" /></Button> : null}{endConflict}<div className="grid gap-4 rounded-control border border-border p-4">
      <div className="flex items-start justify-between gap-4"><div><h3 className="font-semibold">{fields.title || "Event title"}</h3>{fields.communitySlug ? <EventCommunitySummary community={community} /> : null}<p className="text-sm text-muted">{[fields.timeTba ? fields.eventDate : eventStartAt === undefined ? eventLocalDate(fields.eventDate, fields.start) : projectEditorTime({ instant: eventStartAt, timezone: editingTimezone }).value.replace("T", " "), fields.timeTba ? null : eventTimezoneLabel(editingTimezone, eventStartAt), fields.venueLabel || world?.title].filter(Boolean).join(" · ")}</p></div><Button type="button" variant="secondary" onClick={() => setActiveStep("Details")}>Edit details</Button></div>
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
  {onSource ? <EventIntakeDialog open={importOpen} onClose={() => setImportOpen(false)}><fieldset><EventIntakeSource keepImport={connectorDraft} fields={fields} revision={revision} onChange={receiveFields} onSaved={(submitted, saved) => { if (saved.timezone || saved.eventDate || saved.start) timezoneAuthored.current = true; setPersisted(authoredSnapshot(saved)); setFields(current => mergeSavedEventFields(current, submitted, pendingRef.current ? { ...saved, timezone: current.timezone, eventDate: current.eventDate, start: current.start, end: current.end, doors: current.doors, lineup: current.lineup } : saved)); }} action={onSource} busy={busy} setBusy={setBusy} setMessage={setMessage} initialArtworkSourceId={initialArtworkSourceId} onPreview={setArtwork} onExtract={() => { focusExtractedDetails.current = true; setActiveStep("Details"); setImportOpen(false); }} /></fieldset>{message ? <Notice><span role="status">{message}</span></Notice> : null}</EventIntakeDialog> : null}
  </EventEditorPendingContext.Provider>;
}

function ConnectedIntake({ draftId, initialCommunitySlug, heading }: { draftId?: string; initialCommunitySlug?: string; heading?: ReactNode }) {
  const convex = useConvex();
  const updateContribution = useMutation(api.eventCorrections.updateOwnContributedEvent);
  const published = useRef<{ completion: Extract<EventSubmitCompletion, { kind: "published" }>; fields: EventIntakeFields; revision?: number } | undefined>(undefined);
  async function correctPublished(fields: EventIntakeFields) {
    const current = published.current;
    if (!current) throw new Error("CONTRIBUTOR_REQUIRED");
    if (current.revision === undefined) current.revision = (await convex.query(api.eventCorrections.getOwnContributedEvent, { eventId: current.completion.eventId })).updatedAt;
    const patch = Object.fromEntries(Object.entries(fields).filter(([key, value]) => key !== "duplicateAcknowledgements" && authoredSnapshot(value) !== authoredSnapshot(current.fields[key as keyof EventIntakeFields])));
    if (Object.keys(patch).length) {
      const result = await updateContribution({ eventId: current.completion.eventId, expectedUpdatedAt: current.revision, patch, duplicateAcknowledgements: fields.duplicateAcknowledgements?.map(id => id as Id<"events">) });
      current.revision = result.updatedAt;
      current.fields = fields;
    }
    return current.completion;
  }
  const viewer = useQuery(api.accounts.viewer);
  const loaded = useQuery(api.eventIntake.getEventIntakeDraft, draftId ? { draftId } : "skip");
  const save = useMutation(api.eventIntake.saveEventIntakeDraft);
  const publish = useAction(api.eventIntake.publishEventIntake);
  const publishHeld = useMutation(api.eventIntakeHeld.publish);
  const saved = useRef<{ draftId: Id<"eventIntakeDrafts">; version: number; fields: string } | null>(null);
  const request = useRef<{ key: string; version: number } | null>(null);
  async function saveFields(fields: EventIntakeFields, initialVersion: number) {
    const serialized = JSON.stringify(fields);
    if (saved.current?.fields === serialized) return saved.current;
    const current = saved.current ?? (loaded ? { draftId: loaded._id, version: initialVersion } : null);
    const result = await save({ ...(current ? { draftId: current.draftId, expectedVersion: current.version } : {}), patch: fields });
    saved.current = { ...result, fields: serialized };
    window.history.replaceState(window.history.state, "", `/events/new?draft=${result.draftId}`);
    return saved.current;
  }
  const sourceAction: IntakeSourceAction = async (action, fields, revision, file, onStaged) => {
    if (action === "read") return websiteIntakeCommand("poster_read", { posterAssetId: fields.posterSourceId }).then(result => ({ preview: result.dataUrl }));
    if (published.current) throw new ConvexError({ code: "PATCH_FIELD" });
    // On a connector draft the import is the only copy of the source, so it outlives a poster change.
    const sourceReset = loaded?.connectorId ? {} : { tentative: null, questions: null, evidence: null };
    const targetSourceId = fields.posterSourceId;
    let next: EventIntakeFields = { ...fields };
    if (action === "upload") {
      if (!file) throw new Error("INVALID_POSTER");
      const declaration = await posterDeclaration(file);
      next = { ...next, posterDeclaration: declaration };
      const current = await saveFields(next, revision);
      onStaged?.(next);
      const upload = EventPosterUploadSchema.parse(await websiteIntakeCommand("poster_upload_begin", { draftId: current.draftId, ...declaration }));
      next = { ...next, posterSourceId: upload.posterAssetId, posterDeclaration: declaration, ...sourceReset };
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
      next = { ...next, posterSourceId: null, posterDeclaration: null, ...sourceReset };
    }
    // Replay completion against its saved version before persisting later local edits.
    const current = action === "retry" && saved.current ? saved.current : await saveFields(next, revision);
    if (action !== "retry") onStaged?.(next);
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
  // A connector import with no clock is date-only, the same reading row Publish takes.
  const connectorFields = loaded?.connectorId ? { ...loaded.fields, timeTba: loaded.fields.timeTba ?? !(loaded.fields.start ?? loaded.fields.tentative?.start) } : undefined;
  return <EventIntakeFieldsForm heading={heading} savedTimezonePreference={viewer?.user.defaultEventTimezone} newDraft={!draftId} connectorDraft={Boolean(loaded?.connectorId)} initialFields={connectorFields ?? loaded?.fields ?? { communitySlug: initialCommunitySlug, timeTba: false }} initialRevision={loaded?.version} onSource={sourceAction} initialArtworkSourceId={loaded?.artworkSourceId} onSave={async (fields, revision) => { if (published.current) await correctPublished(fields); else await saveFields(fields, revision); }} onPublish={async (fields, revision) => {
    if (published.current) return correctPublished(fields);
    const current = await saveFields(fields, revision);
    if (loaded?.connectorId) {
      // The community's listing, not the viewer's contribution: nothing to correct afterwards.
      const { eventId, eventPath } = await publishHeld({ draftId: current.draftId, expectedVersion: current.version });
      return { kind: "published", eventId, eventPath };
    }
    if (request.current?.version !== current.version) request.current = { version: current.version, key: crypto.randomUUID() };
    const result = await publish({ draftId: current.draftId, expectedVersion: current.version, idempotencyKey: request.current.key });
    const completion = { kind: "published" as const, eventId: result.eventId, eventPath: result.eventPath };
    published.current = { completion, fields };
    // Capture the authorized revision now; subsequent submits never adopt a refreshed revision.
    published.current.revision = (await convex.query(api.eventCorrections.getOwnContributedEvent, { eventId: result.eventId })).updatedAt;
    return completion;
  }} />;
}
export function EventIntakeForm(props: { draftId?: string; initialCommunitySlug?: string; heading?: ReactNode }) {
  const auth = useConvexAuth();
  if (auth.isLoading) return <>{props.heading}<p aria-busy="true">Loading…</p></>;
  if (!auth.isAuthenticated) return <>{props.heading}<Link href={`/sign-in?returnTo=${encodeURIComponent(`/events/new?${new URLSearchParams({ ...(props.draftId ? { draft: props.draftId } : {}), ...(props.initialCommunitySlug ? { community: props.initialCommunitySlug } : {}) })}`)}`}>Sign in</Link></>;
  return <ConnectedIntake {...props} />;
}
