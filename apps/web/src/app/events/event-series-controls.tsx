"use client";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@convex-generated-api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { SeriesRule } from "../../../../../convex/_eventSeriesModel";
import { EventTimezonePicker } from "../_components/event-timezone-picker";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { BACKEND_ERROR_COPY } from "@/lib/error-copy";
import { changedSeriesFields, seriesEditorFields, seriesOverrideRows, type EditableSeries, type RepeatValue, type SeriesEditorFields } from "@/lib/event-series-editor";
import { EditorSection, EventEditorSteps } from "./event-editor-steps";
import { EventLocationField } from "./event-location-field";
import { useEventEditorLeaveGuard } from "./use-event-editor-leave-guard";

const noteLinkClassName = "font-medium underline-offset-4 hover:underline";

export function RepeatControl({ allowNone = true, min, value, onChange }: { allowNone?: boolean; min?: string; value: RepeatValue; onChange(next: RepeatValue): void }) {
  return <div className="grid items-start gap-4 sm:grid-cols-2">
    <Field>
      Repeats
      <Select aria-label="Repeats" value={value.frequency} onChange={change => onChange({ ...value, frequency: change.currentTarget.value as RepeatValue["frequency"] })}>
        {allowNone ? <option value="none">Does not repeat</option> : null}
        <option value="weekly">Weekly</option>
        <option value="biweekly">Every two weeks</option>
        <option value="monthly_weekday">Monthly</option>
      </Select>
    </Field>
    {value.frequency !== "none" ? <Field>Ends<Input type="date" min={min} value={value.endsOn} onChange={change => onChange({ ...value, endsOn: change.currentTarget.value })} /></Field> : null}
  </div>;
}

export function EventSeriesNote({ communitySlug, editSeries, eventSlug, overrides, onReset }: {
  communitySlug: string;
  editSeries: boolean;
  eventSlug: string;
  overrides: string[];
  onReset(fields: string[]): Promise<void>;
}) {
  const router = useRouter();
  const [resetting, setResetting] = useState(false);
  const [failed, setFailed] = useState(false);
  const editPath = `/${communitySlug}/events/${eventSlug}/edit`;
  async function reset(fields: string[]) {
    setResetting(true);
    setFailed(false);
    try { await onReset(fields); } catch { setFailed(true); }
    setResetting(false);
    router.refresh();
  }
  const rows = seriesOverrideRows(overrides);
  return <div className="grid gap-3 rounded-control border border-border bg-surface px-4 py-3 text-sm">
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <p className="mr-auto font-medium">Part of a series.</p>
      <Link className={noteLinkClassName} href={editPath} onClick={click => {
        click.preventDefault();
        click.currentTarget.closest("form")?.querySelector<HTMLElement>("input:not([type=hidden])")?.focus();
      }}>Edit this night</Link>
      {editSeries ? <Link className={noteLinkClassName} href={`${editPath}?scope=series`}>Edit the series</Link> : null}
    </div>
    {rows.length > 0 ? <ul className="grid gap-2 border-t border-border pt-3">
      {rows.map(row => <li className="flex flex-wrap items-center justify-between gap-2" key={row.label}>
        <span className="min-w-0 text-muted">{row.label}</span>
        <Button aria-label={`Reset ${row.label} to series`} disabled={resetting} onClick={() => void reset(row.fields)} size="sm" type="button" variant="secondary">Reset to series</Button>
      </li>)}
    </ul> : null}
    {failed ? <Notice variant="error">{BACKEND_ERROR_COPY}</Notice> : null}
  </div>;
}

export function EventSeriesEditor({ communitySlug, eventSlug, heading, series }: {
  communitySlug: string;
  eventSlug: string;
  heading?: ReactNode;
  series: EditableSeries;
}) {
  const router = useRouter();
  const update = useMutation(api.eventSeries.update);
  const [fields, setFields] = useState(() => seriesEditorFields(series));
  const [status, setStatus] = useState<"idle" | "submitting" | "error" | "saved">("idle");
  const changes = changedSeriesFields(series, fields);
  const { requestLeave } = useEventEditorLeaveGuard({ dirty: status !== "saved" && Object.keys(changes).length > 0 });
  const nightPath = `/${communitySlug}/events/${eventSlug}/edit`;
  useEffect(() => { if (status === "saved") requestLeave(() => router.replace(nightPath)); }, [nightPath, requestLeave, router, status]);
  const busy = status === "submitting" || status === "saved";
  const text = (key: Exclude<keyof SeriesEditorFields, "frequency">) => ({ value: fields[key], onChange: (change: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { const value = change.currentTarget.value; setFields(current => ({ ...current, [key]: value })); } });
  async function onSubmit(submit: FormEvent<HTMLFormElement>) {
    submit.preventDefault();
    if (busy) return;
    setStatus("submitting");
    try {
      if (Object.keys(changes).length > 0) await update({ seriesId: series.id as Id<"eventSeries">, ...changes });
      setStatus("saved");
    } catch {
      setStatus("error");
      router.refresh();
    }
  }
  return <form className="grid gap-8" onSubmit={onSubmit}>
    <EventEditorSteps heading={heading} steps={[]} activeStep="Details" onSelect={() => {}}>
      <div className="space-y-8">
        <EditorSection title="Details">
          <Field>Event title<Input {...text("title")} required /></Field>
          <Field>Description<Textarea aria-label="Description" className="min-h-36" rows={5} {...text("summary")} /></Field>
          <EventLocationField worldSlug={fields.worldSlug} venueLabel={fields.venueLabel} onChange={next => setFields(current => ({ ...current, ...next }))} />
        </EditorSection>
        <EditorSection title="Timing">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>Starts<Input type="time" {...text("startTime")} required /></Field>
            <Field>Doors open<Input type="time" {...text("doorsTime")} /></Field>
            <Field>Ends (optional)<Input type="time" {...text("endTime")} /></Field>
          </div>
          <EventTimezonePicker value={fields.timezone} date={series.startsOn} onChange={timezone => { if (timezone) setFields(current => ({ ...current, timezone })); }} />
          <RepeatControl allowNone={false} min={series.startsOn} value={fields} onChange={next => setFields(current => ({ ...current, ...next, frequency: next.frequency as SeriesRule["frequency"] }))} />
        </EditorSection>
        <EditorSection title="Source">
          <Field>Announcement link<Input {...text("sourceUrl")} placeholder="https://..." /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>Banner image URL<Input {...text("bannerImageUrl")} placeholder="https://..." /></Field>
            <Field>Thumbnail image URL<Input {...text("thumbnailImageUrl")} placeholder="https://..." /></Field>
          </div>
        </EditorSection>
      </div>
    </EventEditorSteps>
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled={busy} size="lg" type="submit" variant="primary">{busy ? "Saving..." : "Save changes"}</Button>
      <Link className={buttonVariants({ size: "lg", variant: "secondary" })} href={nightPath}>Edit this night</Link>
    </div>
    {status === "error" ? <Notice variant="error">{BACKEND_ERROR_COPY}</Notice> : null}
  </form>;
}
