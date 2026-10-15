"use client";

import { useRef, useState } from "react";
import { Field, Input } from "@/components/ui/field";
import { EventIdentityPicker } from "./event-identity-picker";
import { eventPerformerLabel, savedEventPerformer, selectEventPerformer, type EventIdentityOption, type EventPerformerValue } from "@/lib/event-editor-identity";

type PerformerRow = { key: string; label: string; personSlug?: string | null };

/** Presentation hydration never authors persisted labels or marks a lineup dirty. */
export function useEventPerformerEditor(initialPeople: EventIdentityOption[] = []) {
  const peopleRef = useRef(new Map(initialPeople.map(person => [person.slug, person])));
  const [, refresh] = useState(0);
  const [authored, setAuthored] = useState<Record<string, PerformerRow & { value: EventPerformerValue }>>({});
  function resolve(person: EventIdentityOption) {
    if (peopleRef.current.get(person.slug) === person) return;
    peopleRef.current.set(person.slug, person);
    refresh(version => version + 1);
  }
  function value(row: PerformerRow) {
    const intent = authored[row.key];
    return intent && intent.label === row.label && intent.personSlug === row.personSlug ? intent.value : savedEventPerformer({ ...row, profileName: row.personSlug ? peopleRef.current.get(row.personSlug)?.title : undefined });
  }
  function change(row: PerformerRow, next: EventPerformerValue) {
    const personSlug = next.kind === "linked" ? next.personSlug : "";
    const label = eventPerformerLabel({ value: next, profileName: peopleRef.current.get(personSlug)?.title }) || (next.kind === "linked" ? row.label : "");
    setAuthored(current => ({ ...current, [row.key]: { key: row.key, label, personSlug, value: next } }));
    return { personSlug, label };
  }
  return { value, change, resolve, person: (slug?: string | null) => slug ? peopleRef.current.get(slug) : undefined };
}

export function EventPerformerField({ value, selectedPerson, onChange, onResolve, disabled, required }: {
  value: EventPerformerValue;
  selectedPerson?: EventIdentityOption;
  onChange(value: EventPerformerValue): void;
  onResolve?(person: EventIdentityOption): void;
  disabled?: boolean;
  required?: boolean;
}) {
  const [linking, setLinking] = useState(false);
  const [cached, setCached] = useState<EventIdentityOption>();
  const person = value.kind === "linked" ? [selectedPerson, cached].find(option => option?.slug === value.personSlug) : undefined;
  const manual = value.kind === "manual" && value.label !== "";
  const override = value.kind === "linked" && value.billing.kind === "override";
  function resolve(option: EventIdentityOption) { setCached(option); onResolve?.(option); }
  return <div className="grid min-w-0 gap-3" data-performer-field>
    {manual ? <div className="grid gap-2">
      <Field>Performer<Input required={required} pattern={".*\\S.*"} value={value.label} disabled={disabled} onChange={event => onChange({ kind: "manual", label: event.currentTarget.value })} /></Field>
      <div className="flex items-center justify-between gap-3 text-sm"><span className="text-muted">Unlinked</span><button type="button" disabled={disabled} onClick={() => setLinking(true)}>Link profile</button></div>
    </div> : null}
    {!manual || linking ? <EventIdentityPicker kind="person" selectedSlug={value.kind === "linked" ? value.personSlug : undefined} selectedOption={person} disabled={disabled} required={required && !manual}
      onResolve={resolve}
      onSelect={option => { resolve(option); onChange(selectEventPerformer({ current: value, person: option })); setLinking(false); }}
      onClear={() => { onChange({ kind: "manual", label: eventPerformerLabel({ value, profileName: person?.title }) }); setLinking(false); }}
      manualAction={{ label: "Add manual entry", onChoose: label => { onChange({ kind: "manual", label }); setLinking(false); } }}
    /> : null}
    {value.kind === "linked" ? <details open={override || undefined} className="text-sm">
      <summary className="cursor-pointer text-muted">Display name as</summary>
      <Field className="mt-2"><span className="sr-only">Display name as</span><Input required={required && override} pattern={".*\\S.*"} disabled={disabled} value={value.billing.kind === "override" ? value.billing.label : ""} placeholder={person?.title} onChange={event => onChange({ ...value, billing: event.currentTarget.value ? { kind: "override", label: event.currentTarget.value } : { kind: "default" } })} /></Field>
    </details> : null}
  </div>;
}
