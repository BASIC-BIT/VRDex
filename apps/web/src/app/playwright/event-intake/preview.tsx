"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { EventIntakeFieldsForm } from "../../events/event-intake-form";
import type { EventIntakeFields } from "../../../../../../packages/api-contracts/src/event-intake";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
export function EventIntakePreview() {
  const params = useSearchParams();
  const [fields, setFields] = useState<EventIntakeFields | null>(null);
  useEffect(() => { queueMicrotask(() => setFields(JSON.parse(sessionStorage.getItem("event-intake-fixture") ?? '{"communitySlug":"playwright-afterglow-social","timeTba":false}'))); }, []);
  if (params.has("entry")) return <Link href={params.get("entry") === "staff" ? "/playwright/event-lineup?editor&mode=create" : "/playwright/event-intake"}>Open editor</Link>;
  return <PageShell className="py-10"><PageContainer max="3xl"><PageNav><BrandLink /></PageNav>{fields ? <EventIntakeFieldsForm heading={<h1 className="text-3xl font-semibold">Add event</h1>} initialFields={fields} newDraft={!fields.timezone} savedTimezonePreference={null} onSave={async value => { sessionStorage.setItem("event-intake-fixture", JSON.stringify(value)); }} onPublish={async value => { sessionStorage.setItem("event-intake-fixture", JSON.stringify(value)); sessionStorage.setItem("event-intake-published", JSON.stringify(value)); return { kind: "published", eventId: "fixture-event" as Id<"events">, eventPath: "/playwright-afterglow-social/events/playwright-afterglow-harbor-sessions" }; }} /> : null}</PageContainer></PageShell>;
}
