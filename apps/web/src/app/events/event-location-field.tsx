"use client";

import { useState } from "react";
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
  const world = selected?.slug === worldSlug ? selected : selectedWorld?.slug === worldSlug ? selectedWorld : undefined;
  function retainPresentation(option: EventIdentityOption) {
    setSelected(option);
    onWorldPresentation?.(option);
  }
  return <div className="grid gap-2">
    <span className="text-sm font-medium">Where</span>
    <EventIdentityPicker kind="world" selectedSlug={worldSlug} selectedOption={world} disabled={disabled}
      onResolve={retainPresentation}
      onSelect={option => { retainPresentation(option); onChange({ worldSlug: option.slug, venueLabel: "" }); }}
      onClear={() => { setSelected(undefined); onChange({ worldSlug: "", venueLabel: venueLabel || world?.title || "" }); }}
      freeform={{ value: venueLabel, onChange: value => onChange({ worldSlug: "", venueLabel: value }) }} />
    {worldSlug ?
      <details open={Boolean(venueLabel && venueLabel !== world?.title)}>
        <summary className="cursor-pointer text-sm font-medium">Details</summary>
        <Field className="mt-3">Where<Input disabled={disabled} value={venueLabel} maxLength={120} onChange={event => onChange({ worldSlug, venueLabel: event.target.value })} /></Field>
      </details>
    : null}
  </div>;
}
