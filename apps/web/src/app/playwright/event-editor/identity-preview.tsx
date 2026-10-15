"use client";

import { useMemo, useRef, useState } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import {
  getFunctionName,
  type FunctionReference,
  type FunctionReturnType,
} from "convex/server";
import type { api } from "@convex-generated-api";
import { EventIdentityPicker } from "../../events/event-identity-picker";
import {
  personIdentityOption,
  type EventIdentityOption,
  type EventPersonResult,
  type EventSearchResult,
} from "@/lib/event-editor-identity";
import { PageContainer, PageShell } from "@/components/ui/page-shell";

const people = [
  {
    slug: "aurora-house",
    displayName: "Aurora",
    profilePath: "/aurora-house",
    aliases: [],
    tags: ["House"],
    genres: [],
    roleTags: ["DJ"],
    avatarImageUrl: "/seed/fixture-avatar-luma.svg",
    avatarImageKind: "profile",
    trustLabel: "claimed_verified",
    outboundLinks: [],
  },
  {
    slug: "aurora-visual",
    displayName: "Aurora",
    profilePath: "/aurora-visual",
    aliases: [],
    tags: [],
    genres: [],
    roleTags: ["Visual artist"],
    avatarImageUrl: "/seed/fixture-avatar-solaris.svg",
    avatarImageKind: "profile",
    trustLabel: "unclaimed",
    outboundLinks: [],
  },
] satisfies EventPersonResult[];
const community = {
  kind: "community",
  slug: "afterglow",
  title: "Afterglow",
  href: "/afterglow",
  imageUrl: "/seed/fixture-avatar-velvet-circuit.svg",
  imageKind: "logo",
  context: "Owner",
} satisfies EventIdentityOption;

export function EventIdentityPreview() {
  const [kind, setKind] = useState<EventIdentityOption["kind"]>("person");
  const [selectedSlug, setSelectedSlug] = useState("");
  const [selected, setSelected] = useState<EventIdentityOption | null>(null);
  const [manual, setManual] = useState("");
  const [manualHandoff, setManualHandoff] = useState(false);
  const manualInputRef = useRef<HTMLInputElement>(null);
  const [requestStarted, setRequestStarted] = useState(false);
  const [lastRequest, setLastRequest] = useState("");
  const [pending] = useState<Array<() => void>>([]);
  const client = useMemo(() => {
    const fixtureClient = new ConvexReactClient(
      "https://playwright-preview.convex.cloud",
    );
    // Only the external query boundary is substituted; selection, focus, search
    // lifecycle, presentation and image failure run through the real components.
    Object.defineProperty(fixtureClient, "query", {
      value: async (
        reference: FunctionReference<"query">,
        args: {
          query?: string;
          slug?: string;
          now?: number;
          limit?: number;
          entityType?: string;
          profileType?: string;
        },
      ) => {
        const name = getFunctionName(reference);
        setLastRequest(`${name}:${args.slug ?? args.query ?? ""}`);
        if (name === "profiles:getPublicBySlug") {
          if (args.slug === "protected-person")
            throw new Error("Fixture unavailable hydration");
          return null;
        }
        if (name === "worlds:getPublicBySlug") {
          if (typeof args.now !== "number")
            throw new Error("World lookup requires now");
          if (!args.slug)
            throw new Error("Saved world hydration requires a slug");
          const world = {
            slug: args.slug,
            displayName: "Saved Harbor",
            tags: ["Music"],
            visibilityStatus: "public",
            platformCompatibility: ["pc"],
            media: [],
            creatorAttributions: [],
            outboundLinks: [],
            eventContext: { upcoming: [], recent: [] },
          } satisfies NonNullable<
            FunctionReturnType<typeof api.worlds.getPublicBySlug>
          >;
          return { ...world, heroImageUrl: "/seed/fixture-avatar-luma.svg" };
        }
        if (args.limit !== 8)
          throw new Error("Picker searches must be bounded to eight");
        if (args.query === "Failure")
          throw new Error("Fixture search unavailable");
        if (args.query === "Slow") {
          setRequestStarted(true);
          await new Promise<void>((resolve) => pending.push(resolve));
          return [
            { ...people[0], slug: "stale-person", displayName: "Stale person" },
          ];
        }
        if (name === "profiles:lookupPeople") {
          if (args.query === "Broken")
            return [
              {
                ...people[0],
                slug: "broken",
                displayName: "Broken Picture",
                avatarImageUrl: "/fixtures/broken.png",
              },
            ];
          return args.query?.toLowerCase().includes("aurora") ? people : [];
        }
        if (name === "search:searchUniversal") {
          if (args.entityType === "world")
            return [
              {
                entityType: "world",
                slug: "harbor",
                routePath: "/harbor",
                title: "Harbor",
                imageUrl: "/seed/fixture-avatar-luma.svg",
                score: 1,
              },
            ] satisfies EventSearchResult[];
          if (args.entityType !== "profile" || args.profileType !== "community")
            throw new Error("Community search must retain its type filter");
          return [
            {
              entityType: "profile",
              profileType: "community",
              slug: "other-club",
              routePath: "/other-club",
              title: "Other Club",
              score: 1,
            },
          ] satisfies EventSearchResult[];
        }
        throw new Error(`Unexpected fixture query ${name}`);
      },
    });
    return fixtureClient;
  }, [pending]);

  return (
    <PageShell className="py-10">
      <PageContainer max="3xl">
        <h1 className="mb-6 text-2xl font-semibold">Identity picker fixture</h1>
        <div className="mb-8 flex flex-wrap gap-4 text-sm">
          {(["person", "community", "world"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setKind(value);
                setSelectedSlug("");
                setSelected(null);
              }}
            >
              {value}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              pending.splice(0).forEach((release) => release());
              setRequestStarted(false);
            }}
          >
            Release requests
          </button>
          {requestStarted ? (
            <button type="button">Request started</button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setKind("person");
              setSelectedSlug("protected-person");
              setSelected({
                ...personIdentityOption(people[0]),
                slug: "protected-person",
              });
            }}
          >
            Resume unavailable
          </button>
          <button
            type="button"
            onClick={() => {
              setKind("world");
              setSelectedSlug("saved-world");
              setSelected(null);
            }}
          >
            Resume world
          </button>
          <button
            type="button"
            onClick={() => {
              setKind("person");
              setSelectedSlug("unknown-person");
              setSelected(null);
            }}
          >
            Resume unknown
          </button>
        </div>
        <div className="max-w-lg">
          <ConvexProvider client={client}>
            <EventIdentityPicker
              kind={kind}
              selectedSlug={selectedSlug}
              selectedOption={selected}
              shortcuts={kind === "community" ? [community] : []}
              onSelect={(option) => {
                setSelectedSlug(option.slug);
                setSelected(option);
              }}
              onClear={() => {
                setSelectedSlug("");
                setSelected(null);
              }}
              manualAction={
                kind === "person"
                  ? {
                      label: "Add manual entry",
                      onChoose: (text) => {
                        setManual(text);
                        if (manualHandoff) manualInputRef.current?.focus();
                      },
                    }
                  : kind === "world"
                    ? { label: "Use manual location", onChoose: setManual }
                    : undefined
              }
            />
          </ConvexProvider>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={manualHandoff}
            onChange={(event) => setManualHandoff(event.currentTarget.checked)}
          />
          Hand off manual focus
        </label>
        {manualHandoff ? (
          <input
            ref={manualInputRef}
            aria-label="Manual performer"
            defaultValue={manual}
          />
        ) : null}
        <div className="mt-[28rem] grid gap-2 text-xs text-muted">
          <output data-testid="selected-slug">{selectedSlug}</output>
          <output data-testid="manual-name">{manual}</output>
          <output data-testid="last-request">{lastRequest}</output>
        </div>
      </PageContainer>
    </PageShell>
  );
}
