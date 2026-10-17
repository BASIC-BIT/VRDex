"use client";
import { useEffect, useState } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { EventEditorForm } from "../../events/event-editor-form";
import { EventIntakeFieldsForm } from "../../events/event-intake-form";
import { EventTimezonePreferenceControl } from "../../account/event-timezone-preference";
import { EventTimezonePicker } from "../../_components/event-timezone-picker";
import { PageContainer, PageShell } from "@/components/ui/page-shell";

const staffClient = new ConvexReactClient("https://playwright-preview.convex.cloud");

export function EventTimezonePreview({ staff = false }: { staff?: boolean }) {
  const [ready, setReady] = useState(false);
  const [preference, setPreference] = useState<string>();
  const [zone, setZone] = useState<string | null>("America/Indiana/Indianapolis");
  const [selections, setSelections] = useState(0);
  useEffect(() => {
    queueMicrotask(() => {
      setPreference(localStorage.getItem("fixture-timezone-preference") ?? undefined);
      setReady(true);
    });
    function release(event: Event) { if (event instanceof CustomEvent && typeof event.detail === "string") setPreference(event.detail); }
    window.addEventListener("fixture-timezone-preference", release);
    return () => window.removeEventListener("fixture-timezone-preference", release);
  }, []);
  return <PageShell className="py-10"><PageContainer max="3xl">
    {ready && staff ? <ConvexProvider client={staffClient}><EventEditorForm demoMode communitySlug="afterglow" savedTimezonePreference={preference} /></ConvexProvider> : null}
    {ready && !staff ? <EventIntakeFieldsForm newDraft savedTimezonePreference={preference} heading={<h1>Add event</h1>} initialFields={{ timeTba: false }} onSave={async fields => { sessionStorage.setItem("fixture-saved-timezone-draft", JSON.stringify(fields)); }} onPublish={async () => ({ kind: "saved" })} onSource={async (action, fields) => { if (sessionStorage.getItem("fixture-timezone-source-defer")) await new Promise<void>(resolve => window.addEventListener("release-timezone-source", () => resolve(), { once: true })); return { fields: action === "extract" && fields.sourceText === "Tentative timing" ? { ...fields, tentative: { eventDate: "2026-11-01", start: { time: "03:30", dayOffset: 0 } } } : action === "extract" ? { ...fields, timezone: "America/New_York", eventDate: "2026-11-01", start: { time: "01:30", occurrence: "later" } } : fields }; }} /> : null}
    <div data-testid="account-preference"><EventTimezonePreferenceControl value={preference} onSave={async timezone => {
      if (timezone) localStorage.setItem("fixture-timezone-preference", timezone); else localStorage.removeItem("fixture-timezone-preference");
      setPreference(timezone ?? undefined); return null;
    }} /></div>
    <div data-testid="picker-probe" className="max-w-md border-t border-border py-8">
      <EventTimezonePicker value={zone} date={null} onChange={value => { setZone(value); setSelections(count => count + 1); }} />
      <output data-testid="selection-count">{selections}</output>
    </div>
  </PageContainer></PageShell>;
}
