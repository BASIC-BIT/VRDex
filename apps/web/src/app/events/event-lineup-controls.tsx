"use client";
import { usePendingEventInput } from "./use-event-editor-leave-guard";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { formatZonedDateTimeInput } from "@/lib/calendar/zoned-date-time";

const validDuration = (value: string) => Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) <= 1440;
export function EventLineupSetup({ onGenerate, onAddPerformer }: { onGenerate: (count: number, durationMinutes: number) => void; onAddPerformer: () => void }) {
  const [count, setCount] = useState("4");
  const [duration, setDuration] = useState("60");
  return <div className="grid gap-3 sm:grid-cols-2"><Field>Slots<Input inputMode="numeric" value={count} onChange={event => setCount(event.target.value)} /></Field><Field>Minutes each<Input inputMode="numeric" value={duration} onChange={event => setDuration(event.target.value)} /></Field><div className="flex flex-wrap gap-3 sm:col-span-2"><Button type="button" variant="primary" disabled={!Number.isInteger(Number(count)) || Number(count) < 1 || Number(count) > 80 || !validDuration(duration)} onClick={() => onGenerate(Number(count), Number(duration))}>Generate</Button><Button type="button" variant="secondary" onClick={onAddPerformer}>Add performer</Button></div></div>;
}
export function EventLineupInsert({ index, disabled, onInsert, onAddUntimed, allowUntimed = true, atLimit = false }: { index: number; disabled?: boolean; onInsert: (index: number, durationMinutes: number) => void; onAddUntimed: (index: number) => void; allowUntimed?: boolean; atLimit?: boolean }) {
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState("60");
  return open ? <div className="flex flex-wrap items-end gap-3 rounded-control border border-border p-3"><Field>Duration<Input autoFocus aria-label="Slot duration" inputMode="numeric" value={duration} onChange={event => setDuration(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (!disabled && validDuration(duration)) { onInsert(index, Number(duration)); setOpen(false); } } }} /></Field><Button type="button" disabled={disabled || atLimit || !validDuration(duration)} onClick={() => { onInsert(index, Number(duration)); setOpen(false); }}>Insert slot</Button>{allowUntimed ? <Button type="button" variant="secondary" disabled={atLimit} onClick={() => { onAddUntimed(index); setOpen(false); }}>Add performer</Button> : null}<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div> : <Button type="button" variant="ghost" className="justify-self-start" aria-label={`Add slot at position ${index + 1}`} disabled={atLimit} onClick={() => { setDuration("60"); setOpen(true); }}>Add slot</Button>;
}
export function EventSlotDuration({ value, disabled, onCommit, onClear, unresolvedValue, detailed = false }: { value: number | undefined; disabled?: boolean; onCommit: (durationMinutes: number) => void; onClear?: () => void; unresolvedValue?: string; detailed?: boolean }) {
  const source = value === undefined ? unresolvedValue ?? "" : String(value);
  const [edit, setEdit] = useState<{ source: string; value: string } | null>(null);
  const raw = edit?.value ?? source;
  usePendingEventInput(edit !== null && raw !== source);
  const lastCommit = useRef<string | null>(null);
  const inputId = useId();
  const invalid = edit !== null && (!validDuration(raw) && !(onClear && raw.trim() === ""));
  useEffect(() => { const input = document.getElementById(inputId); if (input instanceof HTMLInputElement) input.setCustomValidity(invalid ? "Slot duration minutes must be a whole number." : ""); }, [invalid, inputId]);
  function commit() {
    if (!edit) return;
    if (!validDuration(raw) && !(onClear && raw.trim() === "")) return;
    setEdit(null);
    if (!disabled && onClear && raw.trim() === "" && source.trim() !== "" && lastCommit.current !== raw) { lastCommit.current = raw; onClear(); return; }
    if (!disabled && (value !== undefined || unresolvedValue !== undefined) && validDuration(raw) && Number(raw) !== value && lastCommit.current !== raw) { lastCommit.current = raw; onCommit(Number(raw)); }
  }
  return <Field className={detailed ? undefined : value !== undefined && !Number.isInteger(value) ? "max-w-56 text-xs text-muted" : "max-w-36 text-xs text-muted"}>{detailed ? "Slot duration minutes" : "Duration"}<Input id={inputId} data-pending-event-input={invalid || undefined} aria-invalid={invalid || undefined} data-slot-duration={detailed || undefined} inputMode="numeric" disabled={disabled || (value === undefined && unresolvedValue === undefined)} value={raw} onChange={event => { lastCommit.current = null; setEdit({ source, value: event.target.value }); }} onBlur={commit} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commit(); } else if (event.key === "Escape") { event.preventDefault(); setEdit(null); } }} /></Field>;
}
export function EventLineupReset({ disabled, onConfirm }: { disabled?: boolean; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  return <><Button type="button" variant="ghost" disabled={disabled} onClick={() => dialog.current?.showModal()}>Reset lineup</Button><dialog ref={dialog} aria-labelledby={title} className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-panel border border-border bg-background p-5 text-foreground backdrop:bg-black/60"><h2 id={title} className="text-xl font-semibold">Clear the lineup and start again?</h2><p className="mt-3 text-sm text-muted">Event details and artwork will stay.</p><div className="mt-5 flex flex-wrap gap-3"><Button type="button" onClick={() => { onConfirm(); dialog.current?.close(); }}>Clear lineup</Button><Button type="button" variant="secondary" onClick={() => dialog.current?.close()}>Cancel</Button></div></dialog></>;
}
export function EventSlotRemove({ label, range, disabled, onConfirm }: { label?: string; range?: string; disabled?: boolean; onConfirm(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  return <><Button type="button" variant="ghost" className="justify-self-start" disabled={disabled} onClick={() => { dialog.current?.showModal(); dialog.current?.querySelector<HTMLButtonElement>("[data-cancel-removal]")?.focus(); }}>Remove slot</Button><dialog ref={dialog} aria-labelledby={title} className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-panel border border-border bg-background p-5 text-foreground backdrop:bg-black/60"><h2 id={title} className="text-xl font-semibold">Remove this slot?</h2>{label ? <p className="mt-3 break-words">{label}</p> : null}{range ? <p className="mt-1 text-sm text-muted">{range}</p> : null}<div className="mt-5 flex flex-wrap gap-3"><Button type="button" onClick={() => { dialog.current?.close(); onConfirm(); }}>Remove slot</Button><Button type="button" variant="secondary" data-cancel-removal onClick={() => dialog.current?.close()}>Cancel</Button></div></dialog></>;
}
function formatConflictTime(instant: number, timezone: string): string {
  const minute = formatZonedDateTimeInput(instant, timezone).replace("T", " ");
  if (instant % 60_000 === 0) return minute;
  const date = new Date(instant);
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  const fraction = date.getUTCMilliseconds() ? `.${String(date.getUTCMilliseconds()).padStart(3, "0")}` : "";
  return `${minute}:${seconds}${fraction}`;
}
export function EventLineupConflict({ eventEndAt, latestKnownAt, lineupEndAt, timezone, onExtend }: { eventEndAt: number; latestKnownAt: number; lineupEndAt?: number; timezone: string; onExtend: (endAt: number) => void }) {
  return <div className="grid gap-2 border-t border-border pt-3" data-lineup-conflict><p className="text-sm text-danger">The lineup ends after the event.</p><dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm"><div><dt className="text-muted">Event end</dt><dd>{formatConflictTime(eventEndAt, timezone)}</dd></div><div><dt className="text-muted">{lineupEndAt === undefined ? "Slot" : "Lineup end"}</dt><dd>{formatConflictTime(lineupEndAt ?? latestKnownAt, timezone)}</dd></div></dl>{lineupEndAt === undefined ? null : <Button type="button" variant="secondary" className="justify-self-start" onClick={() => onExtend(lineupEndAt)}>Set event end to lineup end</Button>}</div>;
}
