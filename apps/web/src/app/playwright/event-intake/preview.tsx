"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EventIntakeFieldsForm } from "../../events/event-intake-form";
import type { EventIntakeFields } from "../../../../../../packages/api-contracts/src/event-intake";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
export function EventIntakePreview() {
  const router = useRouter();
  const [fields, setFields] = useState<EventIntakeFields | null>(null);
  useEffect(() => { queueMicrotask(() => setFields(JSON.parse(sessionStorage.getItem("event-intake-fixture") ?? '{"communitySlug":"playwright-afterglow-social","timeTba":false}'))); }, []);
  return <PageShell className="py-10"><PageContainer max="3xl"><PageNav><BrandLink /></PageNav><h1 className="mb-8 text-3xl font-semibold">Add event</h1>{fields ? <EventIntakeFieldsForm initialFields={fields} onSave={async value => { sessionStorage.setItem("event-intake-fixture", JSON.stringify(value)); }} onPublish={async value => { sessionStorage.setItem("event-intake-published", JSON.stringify(value)); router.replace("/playwright-afterglow-social/events/playwright-afterglow-harbor-sessions"); }} /> : null}</PageContainer></PageShell>;
}
