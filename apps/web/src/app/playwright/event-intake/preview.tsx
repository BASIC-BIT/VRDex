"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ConvexProviderWithAuth, type ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { localCommunityFixture, localPersonFixtures, localWorldFixture } from "../../../../../../convex/_localFixtures";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { EventIntakeFieldsForm } from "../../events/event-intake-form";
import type { EventIntakeFields } from "../../../../../../packages/api-contracts/src/event-intake";
import { buttonVariants } from "@/components/ui/button";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

const fetchAccessToken = async () => null;
const useFixtureAuth = () => ({ isLoading: false, isAuthenticated: false, fetchAccessToken });
const fixtureArtwork: Record<string, string> = {
  "playwright-afterglow-social": "/api/e2e/fixture-assets/fixture-afterglow-event-poster",
  "playwright-dj-aurora": "/api/e2e/fixture-assets/fixture-aurora-profile-image-webp",
  "playwright-velvet-circuit": "/seed/fixture-avatar-velvet-circuit.svg",
  "playwright-0xluma": "/seed/fixture-avatar-luma.svg",
  "playwright-solaris-and-the-breakbeat-weather-system": "/seed/fixture-avatar-solaris.svg",
};

// Like revision-preview, this fixture owns its query transport. CI starts an
// empty local backend; presentation must not depend on a previous seed:local.
const fixtureClient = {
  setAuth() {},
  clearAuth() {},
  async query(query: FunctionReference<"query">, args: { slug?: string; entityType?: string; profileType?: string; query?: string; limit?: number }) {
    switch (getFunctionName(query)) {
      case "profiles:getPublicBySlug": {
        const profile = [localCommunityFixture, ...localPersonFixtures].find(profile =>
          profile.slug === args.slug && (!args.profileType || profile.profileType === args.profileType));
        return profile ? { ...profile, avatarImageUrl: fixtureArtwork[profile.slug], trustLabel: "unclaimed", mediaKit: {} } : null;
      }
      case "profiles:lookupPeople": {
        const query = args.query?.trim().toLowerCase();
        return query ? localPersonFixtures.filter(person =>
          [person.displayName, person.slug, ...person.aliases, ...(person.searchAliases ?? [])]
            .some(name => name.toLowerCase().includes(query)))
          .slice(0, args.limit ?? 8)
          .map(person => ({ slug: person.slug, displayName: person.displayName,
            profilePath: `/${person.slug}`, roleTags: person.person.roleTags, tags: person.tags,
            avatarImageUrl: fixtureArtwork[person.slug], trustLabel: "unclaimed" })) : [];
      }
      case "search:searchUniversal": {
        const text = args.query?.trim().toLowerCase();
        if (!text) return [];
        const community = localCommunityFixture;
        const matchesCommunity = (!args.entityType || args.entityType === "profile") &&
          (!args.profileType || args.profileType === "community") &&
          [community.displayName, community.slug, ...community.aliases, ...(community.searchAliases ?? [])]
            .some(name => name.toLowerCase().includes(text));
        const matchesWorld = (!args.entityType || args.entityType === "world") && !args.profileType &&
          [localWorldFixture.displayName, localWorldFixture.slug].some(name => name.toLowerCase().includes(text));
        return [
          ...(matchesCommunity ? [{ entityType: "profile", profileType: "community", slug: community.slug,
            title: community.displayName, routePath: `/${community.slug}`, imageUrl: fixtureArtwork[community.slug],
            subtitle: community.community.categoryTags.join(" / "), trustLabel: "unclaimed", score: 1 }] : []),
          ...(matchesWorld ? [{ entityType: "world", slug: localWorldFixture.slug, title: localWorldFixture.displayName,
            routePath: `/${localWorldFixture.slug}`, subtitle: localWorldFixture.tags.join(" / "), score: 1 }] : []),
        ].slice(0, args.limit ?? 8);
      }
      case "worlds:getPublicBySlug":
        return args.slug === localWorldFixture.slug ? localWorldFixture : null;
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
  return <ConvexProviderWithAuth client={fixtureClient} useAuth={useFixtureAuth}><PageShell className="py-10"><PageContainer max="3xl"><PageNav showMyEvents={false}><BrandLink /><Link className={buttonVariants({ variant: "secondary" })} href="/account/events">My events</Link></PageNav>{fields ? <EventIntakeFieldsForm heading={<h1 className="text-3xl font-semibold">Add event</h1>} initialFields={fields} newDraft={!fields.timezone} savedTimezonePreference={null} onSave={async value => { sessionStorage.setItem("event-intake-fixture", JSON.stringify(value)); }} onPublish={async value => { sessionStorage.setItem("event-intake-fixture", JSON.stringify(value)); sessionStorage.setItem("event-intake-published", JSON.stringify(value)); return { kind: "published", eventId: "fixture-event" as Id<"events">, eventPath: "/playwright-afterglow-social/events/playwright-afterglow-harbor-sessions" }; }} /> : null}</PageContainer></PageShell></ConvexProviderWithAuth>;
}
