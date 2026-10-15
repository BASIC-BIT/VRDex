"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import type { EventIdentityOption } from "@/lib/event-editor-identity";
import { EventIdentityPicker } from "./event-identity-picker";

export function EventLocationField({ worldSlug, venueLabel, selectedWorld, onWorldPresentation, onChange, disabled }: {
  worldSlug: string;
  venueLabel: string;
  selectedWorld?: EventIdentityOption;
  onWorldPresentation?(world: EventIdentityOption): void;
  onChange(next: { worldSlug: string; venueLabel: string }): void;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<EventIdentityOption>();
  const [searching, setSearching] = useState(false);
  const [manual, setManual] = useState(!worldSlug && Boolean(venueLabel));
  const manualInput = useRef<HTMLDivElement>(null);
  const world = selected?.slug === worldSlug ? selected : selectedWorld?.slug === worldSlug ? selectedWorld : undefined;
  const showManual = !worldSlug && (manual || Boolean(venueLabel)) && !searching;
  function retainPresentation(option: EventIdentityOption) {
    setSelected(option);
    onWorldPresentation?.(option);
  }
  function chooseManual(text: string) {
    setSelected(undefined);
    setSearching(false);
    setManual(true);
    onChange({ worldSlug: "", venueLabel: text });
    requestAnimationFrame(() => manualInput.current?.querySelector("input")?.focus());
  }
  return <div className="grid gap-2">
    {!showManual ? <span className="text-sm font-medium">Where</span> : null}
    {showManual ? <div ref={manualInput} className="grid gap-2">
      <Field>Where<Input disabled={disabled} value={venueLabel} maxLength={120} onChange={event => onChange({ worldSlug: "", venueLabel: event.target.value })} /></Field>
      <Button type="button" variant="secondary" className="justify-self-start" disabled={disabled} onClick={() => setSearching(true)}>Change</Button>
    </div> : <EventIdentityPicker kind="world" selectedSlug={worldSlug} selectedOption={world} disabled={disabled}
      onResolve={retainPresentation}
      onSelect={option => { retainPresentation(option); setSearching(false); setManual(false); onChange({ worldSlug: option.slug, venueLabel: "" }); }}
      onClear={() => { setSelected(undefined); setManual(Boolean(venueLabel)); onChange({ worldSlug: "", venueLabel }); }}
      manualAction={{ label: "Use manual location", onChoose: chooseManual }} />}
    {worldSlug ? <>
      <details open={Boolean(venueLabel && venueLabel !== world?.title)}>
        <summary className="cursor-pointer text-sm font-medium">Details</summary>
        <Field className="mt-3">Where<Input disabled={disabled} value={venueLabel} maxLength={120} onChange={event => onChange({ worldSlug, venueLabel: event.target.value })} /></Field>
      </details>
      <Button type="button" variant="secondary" className="justify-self-start" disabled={disabled} onClick={() => chooseManual(venueLabel || world?.title || "")}>Use manual location</Button>
    </> : null}
  </div>;
}
