"use client";
import { useEffect, useRef, useState } from "react";
import { ConvexError } from "convex/values";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { BACKEND_ERROR_COPY } from "@/lib/error-copy";
import { EVENT_INTAKE_MAX_POSTERS, type EventIntakePatch, type EventIntakeCandidate } from "../../../../../packages/api-contracts/src/event-intake";

export type IntakeSourceAction = (action: "extract" | "upload" | "artwork" | "read" | "remove" | "retry", fields: EventIntakePatch, revision: number, file?: File, onStaged?: (fields: EventIntakePatch) => void) => Promise<{ fields?: EventIntakePatch; preview?: string; candidate?: EventIntakeCandidate; artworkSourceId?: string | null }>;
export const sourceIds = (fields: EventIntakePatch) => fields.posterSourceIds ?? (fields.posterSourceId ? [fields.posterSourceId] : []);
const labels: Record<string, string> = { title: "Event title", communitySlug: "Community", eventDate: "Date", start: "Start time", end: "End time", timezone: "Time zone", venueLabel: "Venue", summary: "Description", sourceUrl: "Source URL", lineup: "Lineup" };
function valueText(value: unknown): string {
  if (Array.isArray(value)) return value.map(row => [row.performerLabel, row.personSlug, row.roleLabel, valueText(row.start), valueText(row.end)].filter(Boolean).join(" · ")).join("\n");
  if (value && typeof value === "object" && "time" in value) return String(value.time);
  return value == null ? "" : String(value);
}
export function EventIntakeSuggestions({ fields, onChange, lineup = false }: { fields: EventIntakePatch; onChange: (fields: EventIntakePatch) => void; lineup?: boolean }) {
  const tentative = Object.entries(fields.tentative ?? {}).filter(([key, value]) => value != null && (key === "lineup") === lineup);
  const questions = fields.questions?.filter(question => !question.startsWith("source: ") && question.startsWith("lineup") === lineup);
  const evidence = fields.evidence?.filter(row => row.fieldPath.startsWith("lineup") === lineup);
  return <>
    {tentative.length ? <section className="grid gap-3 rounded-control border border-border p-4"><h2 className="text-lg font-semibold">Tentative details</h2>
      {tentative.map(([key, value]) => <div key={key} className="grid min-w-0 gap-2 border-t border-border pt-3 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0"><p className="text-sm text-muted">{labels[key] ?? key}</p><p className="whitespace-pre-wrap break-words">{valueText(value)}</p></div>
        <Button type="button" variant="secondary" aria-label={`Accept ${labels[key] ?? key}`} onClick={() => { const next = { ...fields.tentative }; delete next[key as keyof typeof next]; onChange({ ...fields, [key]: value, tentative: next }); }}>Accept</Button>
      </div>)}
    </section> : null}
    {questions?.length ? <section className="grid gap-2"><h2 className="text-lg font-semibold">Questions</h2>{questions.map((question, index) => <p key={index} className="break-words text-sm">{question}</p>)}</section> : null}
    {evidence?.length ? <details><summary className="cursor-pointer text-sm">Source evidence</summary><ul className="mt-2 grid gap-2 text-sm">{evidence.map((row, index) => <li key={index} className="break-words">{labels[row.fieldPath.replace(/^event\./, "")] ?? row.fieldPath}: {row.excerpt} ({row.assessment}{row.posterIndex != null ? ` · Image ${row.posterIndex + 1}` : " · Text"})</li>)}</ul></details> : null}
  </>;
}
export function EventIntakeSource({ fields, revision, onChange, action, busy, setBusy, setMessage, initialArtworkSourceId, onPreview, onExtract }: {
  fields: EventIntakePatch; revision: number; onChange: (fields: EventIntakePatch) => void; action: IntakeSourceAction;
  busy: boolean; setBusy: (busy: boolean) => void; setMessage: (message: string) => void; initialArtworkSourceId?: string;
  onPreview: (url: string | undefined) => void; onExtract: () => void;
}) {
  const [pendingCompletions, setPendingCompletions] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [artworkSourceId, setArtworkSourceId] = useState<string | null | undefined>(initialArtworkSourceId);
  const [readSource] = useState(() => action);
  const inFlight = useRef(false);
  const ids = sourceIds(fields);
  const key = JSON.stringify(ids);
  useEffect(() => {
    let active = true;
    for (const sourceId of JSON.parse(key) as string[]) {
      void readSource("read", { posterSourceId: sourceId }, revision).then(result => { if (active) setPreviews(current => ({ ...current, [sourceId]: result.preview ?? "" })); }).catch(() => { if (active) setPreviews(current => ({ ...current, [sourceId]: "" })); });
    }
    return () => { active = false; };
  }, [readSource, key, revision, busy]);
  useEffect(() => { onPreview(artworkSourceId && (JSON.parse(key) as string[]).includes(artworkSourceId) ? previews[artworkSourceId] : undefined); }, [artworkSourceId, key, previews, onPreview]);
  async function run(kind: "extract" | "upload" | "artwork" | "remove" | "retry", files: File[] = [], sourceId?: string) {
    if (inFlight.current) return;
    if (kind === "upload" && ids.length + files.length > EVENT_INTAKE_MAX_POSTERS) { setMessage("Maximum 5 images"); return; }
    inFlight.current = true; setBusy(true); setMessage("");
    let current = fields;
    try {
      for (const file of kind === "upload" ? files : [undefined]) {
        let pendingId = sourceId;
        const result = await action(kind, sourceId ? { ...current, posterSourceId: sourceId } : current, revision, file, staged => {
          current = staged; onChange(staged);
          if (kind === "upload") {
            pendingId = sourceIds(staged).at(-1);
            if (pendingId) setPendingCompletions(ids => [...ids, pendingId!]);
          }
        });
        if (pendingId) setPendingCompletions(ids => ids.filter(id => id !== pendingId));
        if (result.fields) { current = result.fields; onChange(current); }
        if (result.artworkSourceId !== undefined) setArtworkSourceId(result.artworkSourceId);
      }
      if (kind === "extract" && !current.questions?.some(question => question.startsWith("source: "))) onExtract();
    } catch (error) {
      setMessage(error instanceof ConvexError && typeof error.data === "object" && error.data && "code" in error.data && error.data.code === "VERSION_CONFLICT"
        ? "This draft changed elsewhere. Reload before saving." : error instanceof Error && error.message === "INVALID_POSTER" ? "Choose a PNG, JPEG or WebP image up to 12 MB." : BACKEND_ERROR_COPY);
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="grid min-w-0 gap-5" aria-label="Event source">
    <h2 className="text-xl font-semibold">Source</h2>
    <Field>Source text<Textarea value={fields.sourceText ?? ""} maxLength={12000} rows={6} onChange={event => onChange({ ...fields, sourceText: event.target.value, tentative: null, questions: null, evidence: null })} /></Field>
    <Field>Poster<Input type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={busy || ids.length >= EVENT_INTAKE_MAX_POSTERS} onChange={event => { const files = Array.from(event.target.files ?? []); if (files.length) void run("upload", files); event.target.value = ""; }} /></Field>
    <div className="grid gap-4 sm:grid-cols-2">{ids.map((id, index) => <div key={id} className="grid content-start gap-3 rounded-control border border-border p-3">
      {previews[id] ? <>{/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={previews[id]} alt={`Source poster ${index + 1}`} className="h-40 w-full rounded-control object-contain" /></> : <p className="text-sm text-muted">Image {index + 1}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {artworkSourceId === id ? <span className="text-sm font-medium">Artwork</span> : <Button type="button" variant="secondary" aria-label={`Use image ${index + 1} as artwork`} disabled={busy || !previews[id]} onClick={() => void run("artwork", [], id)}>Use artwork</Button>}
        {pendingCompletions.includes(id) || !previews[id] ? <Button type="button" variant="secondary" aria-label={`Retry image ${index + 1}`} disabled={busy} onClick={() => void run("retry", [], id)}>Retry</Button> : null}
        <Button type="button" variant="secondary" aria-label={`Remove image ${index + 1}`} disabled={busy} onClick={() => void run("remove", [], id)}>Remove</Button>
      </div>
    </div>)}</div>
    {fields.questions?.some(question => question.startsWith("source: ")) ? <p role="status" className="text-sm text-muted">Extraction unavailable</p> : null}
    <Button type="button" variant="secondary" disabled={busy || (!fields.sourceText?.trim() && !ids.length)} onClick={() => void run("extract")}>Extract details</Button>
  </section>;
}
