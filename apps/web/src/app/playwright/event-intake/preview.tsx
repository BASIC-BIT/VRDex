"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ConvexProviderWithAuth, type ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { localCommunityFixture } from "../../../../../../convex/_localFixtures";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { EventIntakeFieldsForm } from "../../events/event-intake-form";
import type { EventIntakeFields } from "../../../../../../packages/api-contracts/src/event-intake";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

const fetchAccessToken = async () => null;
const useFixtureAuth = () => ({ isLoading: false, isAuthenticated: false, fetchAccessToken });

// Like revision-preview, this fixture owns its query transport. CI starts an
// empty local backend; presentation must not depend on a previous seed:local.
const fixtureClient = {
  setAuth() {},
  clearAuth() {},
  async query(query: FunctionReference<"query">, args: { slug?: string; profileType?: string }) {
    switch (getFunctionName(query)) {
      case "profiles:getPublicBySlug":
        return args.slug === localCommunityFixture.slug && args.profileType === "community"
          ? { ...localCommunityFixture, trustLabel: "unclaimed", mediaKit: {} }
          : null;
      case "profiles:lookupPeople":
      case "search:searchUniversal":
        return [];
      case "worlds:getPublicBySlug":
        return null;
      default:
        throw new Error("Unexpected intake fixture query");
    }
  },
} as unknown as ConvexReactClient;
export function EventIntakePreview() {
  const params = useSearchParams();
  const [fields, setFields] = useState<EventIntakeFields | null>(null);
  useEffect(() => { queueMicrotask(() => setFields(JSON.parse(sessionStorage.getItem("event-intake-fixture") ?? '{"communitySlug":"playwright-afterglow-social","timeTba":false}'))); }, []);
  if (params.has("entry")) return <Link href={params.get("entry") === "staff" ? "/playwright/event-lineup?editor&mode=create" : "/playwright/event-intake"}>Open editor</Link>;
  return <ConvexProviderWithAuth client={fixtureClient} useAuth={useFixtureAuth}><PageShell className="py-10"><PageContainer max="3xl"><PageNav><BrandLink /></PageNav>{fields ? <EventIntakeFieldsForm heading={<h1 className="text-3xl font-semibold">Add event</h1>} initialFields={fields} newDraft={!fields.timezone} savedTimezonePreference={null} onSave={async value => { sessionStorage.setItem("event-intake-fixture", JSON.stringify(value)); }} onPublish={async value => { sessionStorage.setItem("event-intake-fixture", JSON.stringify(value)); sessionStorage.setItem("event-intake-published", JSON.stringify(value)); return { kind: "published", eventId: "fixture-event" as Id<"events">, eventPath: "/playwright-afterglow-social/events/playwright-afterglow-harbor-sessions" }; }} /> : null}</PageContainer></PageShell></ConvexProviderWithAuth>;
}
