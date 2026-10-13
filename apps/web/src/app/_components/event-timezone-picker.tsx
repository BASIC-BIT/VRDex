"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { commonEventTimezones, eventTimezoneLabel, searchEventTimezones } from "@/lib/event-timezones";

export function EventTimezonePicker({ value, date, instant, preferredValue, name = "timezone", onChange }: {
  value: string | null; date: string | null; instant?: number; preferredValue?: string | null; name?: string; onChange: (value: string | null) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const options = query.trim() ? searchEventTimezones(query, date, instant).slice(0, 30)
    : [...new Set([value, preferredValue, ...commonEventTimezones].filter((zone): zone is string => Boolean(zone)))].flatMap(zone => searchEventTimezones(zone, date, instant).filter(option => option.value === zone)).slice(0, 30);
  useEffect(() => { if (open) root.current?.querySelector<HTMLInputElement>('[role="combobox"]')?.focus(); }, [open]);
  useEffect(() => { if (open && active >= 0) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [active, id, open]);
  function close() { setOpen(false); setQuery(""); setActive(-1); root.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
  function select(zone: string) { onChange(zone); close(); }
  return <div ref={root} className="relative w-full sm:w-fit sm:max-w-md" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setQuery(""); setActive(-1); } }}>
    <Button type="button" aria-label="Time zone" aria-haspopup="listbox" aria-expanded={open} aria-controls={id} className="w-full justify-between gap-3 text-left" variant="surface"
      onClick={() => { setQuery(""); setActive(-1); setOpen(current => !current); }}>
      <span>{value ? eventTimezoneLabel(value, instant) : "Time zone"}</span><span aria-hidden="true">▾</span>
    </Button>
    <input name={name} type="hidden" value={value ?? ""} />
    {open ? <div className="absolute top-full z-20 mt-1 w-full min-w-0 sm:w-96 sm:max-w-[min(24rem,80vw)] rounded-control border border-border bg-surface shadow-panel">
      <div className="p-2"><Input role="combobox" aria-label="Time zone" aria-autocomplete="list" aria-expanded={open} aria-controls={id} aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
        autoComplete="off" value={query} placeholder="City, region or abbreviation"
        onChange={event => { setQuery(event.target.value); setActive(-1); }}
        onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); close(); }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive(index => Math.max(0, Math.min(options.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))); }
          if (event.key === "Enter") { event.preventDefault(); const option = options[active]; if (option) select(option.value); }
        }} /></div>
      <ul id={id} role="listbox" aria-label="Time zones" className="max-h-64 overflow-auto">
        {options.map((option, index) => <li id={`${id}-${index}`} key={option.value} role="option" aria-selected={value === option.value} className={`cursor-pointer px-3 py-2 text-sm ${active === index ? "bg-surface-strong" : ""}`} onMouseDown={event => event.preventDefault()} onClick={() => select(option.value)}>{option.label}</li>)}
        {!options.length ? <li className="px-3 py-2 text-sm text-muted">No matches</li> : null}
      </ul>
    </div> : null}
  </div>;
}
