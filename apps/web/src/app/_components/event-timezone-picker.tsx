"use client";
import { useId, useState } from "react";
import { Input } from "@/components/ui/field";
import { searchEventTimezones } from "@/lib/event-timezones";

export function EventTimezonePicker({ value, date, onChange }: { value: string | null; date: string | null; onChange: (value: string | null) => void }) {
  const id = useId();
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const options = searchEventTimezones(query ?? value ?? "", date).slice(0, 30);
  function select(zone: string) { onChange(zone); setQuery(null); setOpen(false); setActive(-1); }
  return <div className="relative grid gap-2">
    <Input role="combobox" aria-label="Time zone" aria-autocomplete="list" aria-expanded={open} aria-controls={id} aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
      autoComplete="off" value={query ?? value ?? ""} placeholder="City, region or abbreviation"
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
      onChange={event => { setQuery(event.target.value); onChange(null); setActive(-1); setOpen(true); }}
      onKeyDown={event => {
        if (event.key === "Escape") { setOpen(false); return; }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActive(index => Math.max(0, Math.min(options.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))); }
        if (event.key === "Enter" && open) { event.preventDefault(); if (options[active]) select(options[active]!.value); }
      }} />
    <input name="timezone" type="hidden" value={value ?? ""} />
    {open ? <ul id={id} role="listbox" aria-label="Time zones" className="absolute top-full z-20 max-h-64 w-full overflow-auto rounded-control border border-border bg-surface shadow-panel">
      {options.map((option, index) => <li id={`${id}-${index}`} key={option.value} role="option" aria-selected={active === index} className={`cursor-pointer px-3 py-2 text-sm ${active === index ? "bg-surface-strong" : ""}`} onMouseDown={event => event.preventDefault()} onClick={() => select(option.value)}>{option.label}</li>)}
      {!options.length ? <li className="px-3 py-2 text-sm text-muted">No matches</li> : null}
    </ul> : null}
  </div>;
}
