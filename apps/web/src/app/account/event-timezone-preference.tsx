"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex-generated-api";
import { Button } from "@/components/ui/button";
import { BACKEND_ERROR_COPY } from "@/lib/error-copy";
import { Notice } from "@/components/ui/notice";
import { EventTimezonePicker } from "../_components/event-timezone-picker";

export function EventTimezonePreferenceControl({ value, onSave }: { value?: string; onSave: (timezone: string | null) => Promise<null> }) {
  const [selection, setSelection] = useState<string | null>(value ?? null);
  const edited = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (!edited.current) setSelection(value ?? null); }, [value]);
  async function save(timezone: string | null) {
    setPending(true); setError("");
    try { await onSave(timezone); edited.current = false; setSelection(timezone); }
    catch { setError(BACKEND_ERROR_COPY); }
    finally { setPending(false); }
  }
  return <section className="border-t border-border py-8">
    <h2 className="text-lg font-semibold">Default event time zone</h2>
    <fieldset disabled={pending} className="mt-4 grid max-w-md gap-3">
      <EventTimezonePicker value={selection} date={null} name="defaultEventTimezone" onChange={zone => { edited.current = true; setSelection(zone); }} />
      <div className="flex gap-2"><Button type="button" disabled={!selection} onClick={() => void save(selection)}>Save</Button><Button type="button" onClick={() => void save(null)}>Clear</Button></div>
    </fieldset>
    {error ? <Notice className="mt-3"><span role="alert">{error}</span></Notice> : null}
  </section>;
}

export function AccountEventTimezonePreference({ value }: { value?: string }) {
  const save = useMutation(api.accounts.setEventTimezonePreference);
  return <EventTimezonePreferenceControl value={value} onSave={timezone => save({ timezone })} />;
}
