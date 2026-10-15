"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import type { EventIdentityOption } from "@/lib/event-editor-identity";
import { EventIdentityPicker } from "./event-identity-picker";

export function EventLocationField({ worldSlug, venueLabel, selectedWorld, onChange, disabled }: {
  worldSlug: string;
  venueLabel: string;
  selectedWorld?: EventIdentityOption;
  onChange(next: { worldSlug: string; venueLabel: string }): void;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<EventIdentityOption>();
  const [searching, setSearching] = useState(false);
  const world = selected?.slug === worldSlug ? selected : selectedWorld;
  return <div className="grid gap-2">
    {worldSlug || !venueLabel || searching ? <span className="text-sm font-medium">Where</span> : null}
    {!worldSlug && venueLabel && !searching ? <div className="grid gap-2"><Field>Where<Input disabled={disabled} value={venueLabel} maxLength={120} onChange={event => onChange({ worldSlug: "", venueLabel: event.target.value })} /></Field><Button type="button" variant="secondary" className="justify-self-start" disabled={disabled} onClick={() => setSearching(true)}>Change</Button></div> : <EventIdentityPicker kind="world" selectedSlug={worldSlug} selectedOption={world} disabled={disabled} onSelect={option => { setSelected(option); setSearching(false); onChange({ worldSlug: option.slug, venueLabel: "" }); }} onClear={() => { setSelected(undefined); onChange({ worldSlug: "", venueLabel }); }} manualAction={{ label: "Use manual location", onChoose: text => { setSelected(undefined); setSearching(false); onChange({ worldSlug: "", venueLabel: text }); } }} />}
    {worldSlug ? <><details open={Boolean(venueLabel && venueLabel !== world?.title)}><summary className="cursor-pointer text-sm font-medium">Details</summary><Field className="mt-3">Where<Input disabled={disabled} value={venueLabel} maxLength={120} onChange={event => onChange({ worldSlug, venueLabel: event.target.value })} /></Field></details><Button type="button" variant="secondary" className="justify-self-start" disabled={disabled} onClick={() => { setSearching(false); onChange({ worldSlug: "", venueLabel: venueLabel || world?.title || "" }); }}>Use manual location</Button></> : null}
  </div>;
}
