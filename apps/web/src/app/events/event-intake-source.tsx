"use client";
import { useEffect, useState } from "react";
import { ConvexError } from "convex/values";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { BACKEND_ERROR_COPY } from "@/lib/error-copy";
import type { EventIntakePatch, EventIntakeCandidate } from "../../../../../packages/api-contracts/src/event-intake";

export type IntakeSourceAction = (action: "extract" | "upload" | "artwork" | "read", fields: EventIntakePatch, revision: number, file?: File) => Promise<{ fields?: EventIntakePatch; preview?: string; candidate?: EventIntakeCandidate; artworkSourceId?: string }>;
const labels: Record<string, string> = { title: "Event title", communitySlug: "Community", eventDate: "Date", start: "Start time", end: "End time", timezone: "Time zone", venueLabel: "Venue", summary: "Description", sourceUrl: "Source URL", lineup: "Slots" };
function valueText(value: unknown): string {
  if (Array.isArray(value)) return value.map(row => [row.performerLabel, row.personSlug, row.roleLabel, valueText(row.start), valueText(row.end)].filter(Boolean).join(" · ")).join("\n");
  if (value && typeof value === "object" && "time" in value) return String(value.time);
  return value == null ? "" : String(value);
}
export function EventIntakeSource({ fields, revision, onChange, action, busy, setBusy, setMessage, initialArtworkSourceId }: {
  fields: EventIntakePatch; revision: number; onChange: (fields: EventIntakePatch) => void; action: IntakeSourceAction;
  busy: boolean; setBusy: (busy: boolean) => void; setMessage: (message: string) => void; initialArtworkSourceId?: string;
}) {
  const [preview, setPreview] = useState<{ sourceId: string; url: string } | null>(null);
  const [evidence, setEvidence] = useState<EventIntakeCandidate["evidence"]>([]);
  const unavailable = fields.questions?.some(question => question.startsWith("source: ")) ?? false;
  const [artworkSourceId, setArtworkSourceId] = useState(initialArtworkSourceId);
  const [readSource] = useState(() => action);
  const posterSourceId = fields.posterSourceId;
  const previewUrl = preview && preview.sourceId === posterSourceId ? preview.url : "";
  const artworkSelected = Boolean(posterSourceId && artworkSourceId === posterSourceId);
  useEffect(() => {
    if (!posterSourceId) return;
    let active = true;
    void readSource("read", { posterSourceId }, revision).then(result => { if (active) setPreview({ sourceId: posterSourceId, url: result.preview ?? "" }); }).catch(() => { if (active) setPreview(null); });
    return () => { active = false; };
  }, [readSource, posterSourceId, revision]);
  async function run(kind: "extract" | "upload" | "artwork", file?: File) {
    setBusy(true); setMessage("");
    try {
      const result = await action(kind, fields, revision, file);
      if (result.fields) onChange(result.fields);
      if (result.candidate) setEvidence(result.candidate.evidence);
      else if (kind === "upload") setEvidence([]);
      if (result.artworkSourceId) setArtworkSourceId(result.artworkSourceId);
    } catch (error) {
      setMessage(error instanceof ConvexError && typeof error.data === "object" && error.data && "code" in error.data && error.data.code === "VERSION_CONFLICT"
        ? "This draft changed elsewhere. Reload before saving." : error instanceof Error && error.message === "INVALID_POSTER" ? "Choose a PNG, JPEG or WebP image up to 12 MB." : BACKEND_ERROR_COPY);
    } finally { setBusy(false); }
  }
  return <section className="grid min-w-0 gap-4 border-b border-border pb-6" aria-label="Event source">
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <div className="grid content-start gap-3"><Field>Source text<Textarea value={fields.sourceText ?? ""} maxLength={12000} rows={5} onChange={event => { onChange({ ...fields, sourceText: event.target.value, tentative: undefined, questions: undefined }); setEvidence([]); }} /></Field>
        <Field>Poster<Input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) void run("upload", file); event.target.value = ""; }} /></Field>
        <Button type="button" variant="secondary" disabled={busy || (!fields.sourceText?.trim() && !fields.posterSourceId)} onClick={() => void run("extract")}>Extract details</Button>
        {unavailable ? <p role="status" className="text-sm text-muted">Extraction unavailable</p> : null}
      </div>
      <div className="grid content-start gap-3">{previewUrl ? <><p className="text-sm text-muted">Private source</p>
        {/* Private data URL already contains the validated image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={previewUrl} alt="Source poster" className="max-h-80 w-full rounded-control object-contain" /></> : null}
        {fields.posterSourceId ? artworkSelected ? <p className="text-sm">Artwork selected</p> : <Button type="button" variant="secondary" disabled={busy || !previewUrl} onClick={() => void run("artwork")}>Use as event artwork</Button> : null}
      </div>
    </div>
    {fields.tentative && Object.keys(fields.tentative).length ? <section className="grid gap-3"><h2 className="text-xl font-semibold">Tentative details</h2>
      {Object.entries(fields.tentative).filter(([, value]) => value != null).map(([key, value]) => <div key={key} className="grid min-w-0 gap-2 border-t border-border pt-3 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0"><p className="text-sm text-muted">{labels[key] ?? key}</p><p className="whitespace-pre-wrap break-words">{valueText(value)}</p></div>
        <Button type="button" variant="secondary" aria-label={`Accept ${labels[key] ?? key}`} onClick={() => { const tentative = { ...fields.tentative }; delete tentative[key as keyof typeof tentative]; onChange({ ...fields, [key]: value, tentative }); }}>Accept</Button>
      </div>)}
    </section> : null}
    {fields.questions?.length && !unavailable ? <section className="grid gap-2"><h2 className="text-lg font-semibold">Questions</h2>{fields.questions.map((question, index) => <p key={index} className="break-words text-sm">{question}</p>)}</section> : null}
    {evidence.length ? <details><summary className="cursor-pointer text-sm">Source evidence</summary><ul className="mt-2 grid gap-2 text-sm">{evidence.map((row, index) => <li key={index} className="break-words">{labels[row.fieldPath.replace(/^event\./, "")] ?? row.fieldPath}: {row.excerpt} ({row.assessment})</li>)}</ul></details> : null}
  </section>;
}
