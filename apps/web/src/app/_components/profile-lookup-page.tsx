"use client";

import { useConvex } from "convex/react";
import type { FunctionReference } from "convex/server";
import Link from "next/link";
import { useFeatureFlagEnabled, usePostHog } from "posthog-js/react";
import { type CSSProperties, useCallback, useEffect, useRef, useState, useTransition } from "react";

import { api } from "@convex-generated-api";
import { PublicProfileLinks } from "./public-profile-links";
import { shouldRefreshBulkPrivateLookup } from "./lookup-private-refresh";
import { LookupSearchBox } from "./lookup-search-box";
import { mergeLookupSuggestions } from "./lookup-suggestion-merge";
import { SearchViewShell } from "./search-view-shell";
import { Card } from "@/components/ui/card";
import { EntityImage } from "@/components/ui/entity-image";
import { ProfileAvatarImage } from "@/components/ui/profile-avatar-image";
import { VerifiedTrustMark } from "@/components/ui/verified-trust-mark";
import { Table, TableCell, TableFrame, TableHead, TableHeaderCell } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { PublicSearchGenre, PublicSearchPerson } from "@/lib/public-search";
import type { AvatarAppearance } from "@/lib/avatar-appearance";
import {
  captureProductEvent,
  mirrorPrivateSeedLookupAccess,
  PRIVATE_SEED_LOOKUP_UI_FLAG,
} from "@/lib/posthog";

type ProfileTrustLabel = "community_submitted" | "unclaimed" | "claimed_unverified" | "claimed_verified";
export type ProfileLookupLinkType = PublicSearchPerson["outboundLinks"][number]["type"];
type LookupStatus = "live" | "missing-url" | "error";
type OptionalPublicText = string | null | undefined;

type PublicProfileGenre = Omit<PublicSearchGenre, "displayLabel"> & {
  displayLabel?: OptionalPublicText;
};

export type PublicProfileLookupResult = {
  slug: string;
  displayName: string;
  profilePath: string;
  aliases: string[];
  tags: string[];
  genres: PublicProfileGenre[];
  roleTags: string[];
  headline?: OptionalPublicText;
  bio?: OptionalPublicText;
  avatarImageUrl?: OptionalPublicText;
  avatarImageKind?: "logo" | "profile";
  avatarAppearance?: AvatarAppearance;
  accentColor?: OptionalPublicText;
  secondaryColor?: OptionalPublicText;
  region?: OptionalPublicText;
  timezone?: OptionalPublicText;
  trustLabel: ProfileTrustLabel;
  sourceLabel?: string;
  outboundLinks: PublicSearchPerson["outboundLinks"];
};

export type SeedLookupViewerAccess = {
  allowed: boolean;
  source: "feature_grant" | "none" | "signed_out" | "super_admin";
};

export type PrivateSeedLookupResult = {
  id: string;
  displayName: string;
  proposedSlug?: string;
  reviewState: string;
  publicationState: "draft_private" | "review_pending" | "published_unclaimed";
  reviewedAt?: number;
  /**
   * Where the candidate went once it published.
   *
   * The lookup covers published records now, and naming a person it cannot take
   * you to is the smaller half of the surface that used to drop them entirely.
   */
  publishedProfileSlug?: string;
  source: {
    name: string;
    observedAt?: number;
  } | null;
  fields: Array<{
    id: string;
    fieldKey: string;
    value: unknown;
    sourceLabel: string;
    confidence: string;
    reviewState: string;
    visibility: string;
    sourceObservedAt?: number;
    lastCheckedAt?: number;
    reviewedAt?: number;
  }>;
};

export type ProfileLookupDisplayResult = PublicProfileLookupResult | PrivateSeedLookupResult;

export function isPrivateSeedLookupResult(
  result: ProfileLookupDisplayResult,
): result is PrivateSeedLookupResult {
  return "publicationState" in result;
}

export type BulkLookupEntry = {
  query: string;
  results: ProfileLookupDisplayResult[];
};

const seedAccessApi = (api as unknown as {
  seedAccess: {
    lookupPeople: FunctionReference<
      "query",
      "public",
      { query: string; limit?: number },
      PrivateSeedLookupResult[]
    >;
  };
}).seedAccess;

type LookupLink = PublicProfileLookupResult["outboundLinks"][number];

function compactList(items: OptionalPublicText[]): string[] {
  return items.flatMap((item) => {
    const trimmed = item?.trim();

    return trimmed ? [trimmed] : [];
  });
}

function genreLabel(genre: PublicProfileGenre): string {
  return genre.displayLabel?.trim() || genre.displayName;
}

function genreToneClass(slug: string): string {
  if (slug.includes("drum-and-bass") || slug === "neurofunk") {
    return "lookup-genre-chip--dnb";
  }

  if (slug.includes("house")) {
    return "lookup-genre-chip--house";
  }

  if (slug.includes("techno") || slug.includes("midtempo")) {
    return "lookup-genre-chip--techno";
  }

  if (slug.includes("uk-garage")) {
    return "lookup-genre-chip--ukg";
  }

  if (slug.includes("trap") || slug === "140" || slug.includes("bass")) {
    return "lookup-genre-chip--bass";
  }

  return "lookup-genre-chip--default";
}

function dedupeProfiles(results: PublicProfileLookupResult[]): PublicProfileLookupResult[] {
  const profiles = new Map<string, PublicProfileLookupResult>();

  for (const result of results) {
    profiles.set(result.slug, result);
  }

  return [...profiles.values()];
}

function dedupePrivateSeeds(results: PrivateSeedLookupResult[]): PrivateSeedLookupResult[] {
  const candidates = new Map<string, PrivateSeedLookupResult>();

  for (const result of results) {
    candidates.set(result.id, result);
  }

  return [...candidates.values()];
}

function ProfileAvatar({ profile }: { profile: Pick<PublicProfileLookupResult, "avatarAppearance" | "avatarImageKind" | "avatarImageUrl" | "displayName"> }) {
  if (profile.avatarImageKind === "logo") {
    return (
      <EntityImage
        alt=""
        className="lookup-avatar lookup-avatar--logo"
        imageClassName="object-contain"
        label={profile.displayName}
        sizes="83px"
        src={profile.avatarImageUrl}
      />
    );
  }

  return (
    <ProfileAvatarImage
      alt=""
      appearance={profile.avatarAppearance}
      className="lookup-avatar"
      label={profile.displayName}
      sizes="83px"
      src={profile.avatarImageUrl}
    />
  );
}

function LookupStatusNotice({ status }: { status: LookupStatus }) {
  if (status === "live") {
    return null;
  }

  return (
    <Card surface="dashed">
      {status === "missing-url" ? "Lookup data is not available in this environment yet." : "Lookup data is temporarily unavailable."}
    </Card>
  );
}

function LookupGenres({ genres }: { genres: PublicProfileGenre[] }) {
  const visibleGenres = genres.filter((genre) => genreLabel(genre));
  const accessibleLabel = visibleGenres.map(genreLabel).join(", ");

  if (visibleGenres.length === 0) {
    return null;
  }

  return (
    <div aria-label={accessibleLabel} className="lookup-genre-line">
      <span aria-hidden="true" className="lookup-genre-list">
        {visibleGenres.map((genre) => (
          <span
            className={cn(
              "lookup-genre-chip",
              genreToneClass(genre.slug),
              genre.featured ? "lookup-genre-chip--featured" : undefined,
            )}
            key={genre.slug}
          >
            {genreLabel(genre)}
          </span>
        ))}
      </span>
    </div>
  );
}

function lookupIdentityStyle(profile: PublicProfileLookupResult): CSSProperties | undefined {
  const accentColor = profile.accentColor?.trim();

  if (!accentColor) {
    return undefined;
  }

  return {
    "--lookup-profile-accent": accentColor,
    "--lookup-profile-secondary": profile.secondaryColor?.trim() || accentColor,
  } as CSSProperties;
}

function LookupIdentity({ profile }: { profile: PublicProfileLookupResult }) {
  const hasFlair = Boolean(profile.accentColor?.trim());
  const identityMeta = compactList([profile.region, profile.timezone]).join(" / ");
  return (
    <div
      className={cn("lookup-identity", hasFlair ? "lookup-identity--flair" : undefined)}
      style={lookupIdentityStyle(profile)}
    >
      <div className="lookup-avatar-wrap">
        <ProfileAvatar profile={profile} />
        {profile.trustLabel === "claimed_verified" ? <VerifiedTrustMark className="verified-trust-mark--avatar" /> : null}
      </div>
      <div className="lookup-identity-copy">
        <div className="lookup-name-row">
          <Link className="lookup-name-link" href={profile.profilePath}>
            {profile.displayName}
          </Link>
        </div>
        {profile.aliases.length > 0 ? (
          <div className="lookup-alias-line">
            <span>aka</span>
            <span className="lookup-alias-line__value">{profile.aliases.join(" / ")}</span>
          </div>
        ) : null}
        {identityMeta ? <div className="lookup-identity-meta">{identityMeta}</div> : null}
      </div>
    </div>
  );
}

function LookupResultRow({ profile }: { profile: PublicProfileLookupResult }) {
  return (
    <tr className="lookup-result-row align-middle">
      <TableCell className="lookup-name-cell px-2 py-2">
        <LookupIdentity profile={profile} />
      </TableCell>
      <TableCell className="lookup-genre-cell px-2 py-2">
        <LookupGenres genres={profile.genres} />
      </TableCell>
      <TableCell className="lookup-links-cell px-2 py-2">
        <PublicProfileLinks links={profile.outboundLinks} />
      </TableCell>
    </tr>
  );
}

function LookupResultCard({ profile }: { profile: PublicProfileLookupResult }) {
  return (
    <Card className="lookup-result-card grid gap-2" padding="sm">
      <LookupIdentity profile={profile} />
      <div className="text-xs">
        <LookupGenres genres={profile.genres} />
      </div>
      <PublicProfileLinks links={profile.outboundLinks} />
    </Card>
  );
}

function privateFieldValue<T>(candidate: PrivateSeedLookupResult, fieldKey: string): T | undefined {
  return candidate.fields.find((field) => field.fieldKey === fieldKey)?.value as T | undefined;
}

function privateSeedLinks(candidate: PrivateSeedLookupResult): PublicProfileLookupResult["outboundLinks"] {
  const links = privateFieldValue<Array<Omit<LookupLink, "source">>>(candidate, "outboundLinks");

  return Array.isArray(links)
    ? links.map((link) => ({ ...link, source: "partner_provided" as const }))
    : [];
}

function privateSeedGenres(candidate: PrivateSeedLookupResult): PublicProfileGenre[] {
  const genres = privateFieldValue<string[]>(candidate, "genres");

  return Array.isArray(genres)
    ? genres.map((displayName) => ({
        displayName,
        slug: displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      }))
    : [];
}

function PrivateSeedIdentity({ candidate }: { candidate: PrivateSeedLookupResult }) {
  const aliases = privateFieldValue<string[]>(candidate, "aliases") ?? [];

  return (
    <div className="lookup-private-identity ph-no-capture" data-ph-no-capture>
      {/* Linked once it has somewhere to go. A published candidate whose public
          search result does not match what the operator typed would otherwise be
          named here and nowhere else. */}
      {candidate.publishedProfileSlug ? (
        <Link className="lookup-private-name" href={`/${candidate.publishedProfileSlug}`}>
          {candidate.displayName}
        </Link>
      ) : (
        <span className="lookup-private-name">{candidate.displayName}</span>
      )}
      {aliases.length > 0 ? (
        <div className="lookup-alias-line">
          <span>aka</span>
          <span className="lookup-alias-line__value">{aliases.join(" / ")}</span>
        </div>
      ) : null}
    </div>
  );
}

function PrivateSeedResultRow({ candidate }: { candidate: PrivateSeedLookupResult }) {
  return (
    <tr className="lookup-result-row ph-no-capture align-middle" data-ph-no-capture>
      <TableCell className="lookup-name-cell px-2 py-2">
        <PrivateSeedIdentity candidate={candidate} />
      </TableCell>
      <TableCell className="lookup-genre-cell px-2 py-2">
        <LookupGenres genres={privateSeedGenres(candidate)} />
      </TableCell>
      <TableCell className="lookup-links-cell px-2 py-2">
        <PublicProfileLinks links={privateSeedLinks(candidate)} />
      </TableCell>
    </tr>
  );
}

function PrivateSeedResultCard({ candidate }: { candidate: PrivateSeedLookupResult }) {
  return (
    <Card
      className="lookup-result-card ph-no-capture grid gap-2"
      data-ph-no-capture
      padding="sm"
    >
      <PrivateSeedIdentity candidate={candidate} />
      <div className="text-xs"><LookupGenres genres={privateSeedGenres(candidate)} /></div>
      <PublicProfileLinks links={privateSeedLinks(candidate)} />
    </Card>
  );
}

function BulkLookupSummary({ entries }: { entries: BulkLookupEntry[] }) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <Card
      className="lookup-panel lookup-bulk-summary ph-no-capture grid gap-2"
      data-ph-no-capture
      padding="sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-[-0.03em]">Lineup matches</h2>
        <span className="text-xs text-muted">{entries.length} pasted entries</span>
      </div>
      <div className="lookup-bulk-grid">
        {entries.map((entry) => (
          <div className="lookup-bulk-row" key={entry.query}>
            <span className="font-mono text-xs text-muted">{entry.query}</span>
            <span className="text-sm">
              {entry.results.length === 0
                ? "No match"
                : entry.results.map((result) => result.displayName).join(" / ")}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

type LookupResponse = {
  privateResults: PrivateSeedLookupResult[];
  results: PublicProfileLookupResult[];
  viewerAccess: SeedLookupViewerAccess;
};

async function fetchLookupResults(query: string): Promise<LookupResponse> {
  const response = await fetch(`/lookup/suggest?q=${encodeURIComponent(query)}`, { cache: "no-store" });

  if (!response.ok) {
    throw new Error("Lookup request failed.");
  }

  const data = await response.json() as LookupResponse;

  return data;
}

function updateLookupUrl(query: string, routePath: "/" | "/lookup" | "/search", view?: "dj") {
  const params = new URLSearchParams();
  if (query) {
    params.set("q", query);
  }
  if (view) {
    params.set("view", view);
  }
  const nextUrl = params.size > 0 ? `${routePath}?${params.toString()}` : routePath;

  const currentUrl = `${window.location.pathname}${window.location.search}`;
  if (currentUrl !== nextUrl) {
    window.history.pushState(null, "", nextUrl);
  }
}

type ProfileLookupPageProps = {
  privateResults: PrivateSeedLookupResult[];
  query: string;
  results: PublicProfileLookupResult[];
  routePath?: "/" | "/lookup" | "/search";
  status: LookupStatus;
  view?: "dj";
  viewerAccess: SeedLookupViewerAccess;
};

type QueryPrivateResults = (
  query: string,
) => Promise<PrivateSeedLookupResult[]>;

export function ProfileLookupPage({
  privateResults,
  query,
  results,
  routePath = "/lookup",
  status,
  view,
  viewerAccess,
}: ProfileLookupPageProps) {
  const props = { privateResults, query, results, routePath, status, view, viewerAccess };

  return process.env.NEXT_PUBLIC_CONVEX_URL
    ? <ConnectedProfileLookupPage {...props} />
    : <ProfileLookupPageContent {...props} queryPrivateResults={null} />;
}

function ConnectedProfileLookupPage(props: ProfileLookupPageProps) {
  const convex = useConvex();
  const queryPrivateResults = useCallback(
    async (query: string) => await convex.query(seedAccessApi.lookupPeople, {
      query,
      limit: 12,
    }),
    [convex],
  );

  return <ProfileLookupPageContent {...props} queryPrivateResults={queryPrivateResults} />;
}

function ProfileLookupPageContent({
  privateResults,
  query,
  queryPrivateResults,
  results,
  routePath = "/lookup",
  status,
  view,
  viewerAccess,
}: ProfileLookupPageProps & { queryPrivateResults: QueryPrivateResults | null }) {
  const posthog = usePostHog();
  const privateUiFlag = useFeatureFlagEnabled(PRIVATE_SEED_LOOKUP_UI_FLAG);
  const [displayQuery, setDisplayQuery] = useState(query);
  const [displayResults, setDisplayResults] = useState(results);
  const [displayPrivateResults, setDisplayPrivateResults] = useState(privateResults);
  const [seedViewerAccess, setSeedViewerAccess] = useState(viewerAccess);
  const [lookupStatus, setLookupStatus] = useState<LookupStatus>(status);
  const [bulkEntries, setBulkEntries] = useState<BulkLookupEntry[]>([]);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const requestVersionRef = useRef(0);
  const privateLookupQueryRef = useRef<string | null>(
    privateResults.length > 0 ? query : null,
  );
  const bulkLookupLinesRef = useRef<string[]>([]);
  const bulkPrivateRefreshAttemptedRef = useRef(privateUiFlag === true);
  const [isPending, startTransition] = useTransition();
  const isSearching = pendingLabel !== null || isPending;
  const privateUiEnabled = seedViewerAccess.source === "super_admin" || privateUiFlag === true;
  const visibleResults = mergeLookupSuggestions(
    displayResults,
    seedViewerAccess.allowed && privateUiEnabled ? displayPrivateResults : [],
  );
  const visiblePublicResults = visibleResults.filter(
    (result): result is PublicProfileLookupResult => !isPrivateSeedLookupResult(result),
  );
  const visiblePrivateResults = visibleResults.filter(isPrivateSeedLookupResult);
  const seedViewerAccessAllowed = seedViewerAccess.allowed;
  const seedViewerAccessSource = seedViewerAccess.source;
  const hasQuery = Boolean(displayQuery.trim()) || bulkEntries.length > 0 || isSearching;

  useEffect(() => {
    const handleHistoryNavigation = () => window.location.reload();
    window.addEventListener("popstate", handleHistoryNavigation);
    return () => window.removeEventListener("popstate", handleHistoryNavigation);
  }, []);

  useEffect(() => {
    mirrorPrivateSeedLookupAccess(posthog, seedViewerAccess.allowed);
  }, [posthog, seedViewerAccess.allowed]);

  useEffect(() => {
    if (visiblePrivateResults.length === 0) {
      return;
    }

    captureProductEvent(posthog, "private_seed_results_shown", {
      result_count: visiblePrivateResults.length === 1 ? "one" : "multiple",
      ui_flag: seedViewerAccess.source === "super_admin" ? "super_admin_bypass" : "enabled",
    });
  }, [displayQuery, posthog, seedViewerAccess.source, visiblePrivateResults.length]);

  const fetchAllowedPrivateResults = useCallback(async (
    nextLookup: LookupResponse,
    nextQuery: string,
  ) => {
    const enabled = nextLookup.viewerAccess.source === "super_admin" || privateUiFlag === true;

    if (!nextLookup.viewerAccess.allowed || !enabled) {
      return [];
    }

    if (nextLookup.privateResults.length > 0) {
      return nextLookup.privateResults;
    }

    if (!queryPrivateResults) {
      return [];
    }

    privateLookupQueryRef.current = nextQuery;
    try {
      return await queryPrivateResults(nextQuery);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Client-side private seed lookup failed: ${message}`);
      return [];
    }
  }, [privateUiFlag, queryPrivateResults]);

  useEffect(() => {
    const currentQuery = displayQuery.trim();
    const enabled = seedViewerAccess.source === "super_admin" || privateUiFlag === true;

    if (
      bulkEntries.length > 0 ||
      currentQuery.length < 1 ||
      displayPrivateResults.length > 0 ||
      !seedViewerAccess.allowed ||
      !enabled ||
      !queryPrivateResults ||
      privateLookupQueryRef.current === currentQuery
    ) {
      return;
    }

    let cancelled = false;
    const requestVersion = requestVersionRef.current;
    privateLookupQueryRef.current = currentQuery;

    void queryPrivateResults(currentQuery)
      .then((initialPrivateResults) => {
        if (!cancelled && requestVersionRef.current === requestVersion) {
          startTransition(() => setDisplayPrivateResults(initialPrivateResults));
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Client-side private seed lookup failed: ${message}`);
      });

    return () => {
      cancelled = true;
    };
  }, [
    bulkEntries.length,
    displayPrivateResults.length,
    displayQuery,
    privateUiFlag,
    queryPrivateResults,
    seedViewerAccess.allowed,
    seedViewerAccess.source,
  ]);

  const runLookup = useCallback(async (nextQuery: string) => {
    const normalizedQuery = nextQuery.trim();

    if (!normalizedQuery) {
      return;
    }

    const requestVersion = requestVersionRef.current + 1;

    requestVersionRef.current = requestVersion;
    setPendingLabel(`Searching ${normalizedQuery}`);
    captureProductEvent(posthog, "lookup_submitted", {
      access_scope: seedViewerAccess.allowed && privateUiEnabled
        ? "private_and_public"
        : "public_only",
      mode: "single",
      view_key: "dj",
    });

    try {
      const nextLookup = await fetchLookupResults(normalizedQuery);
      const nextPrivateResults = await fetchAllowedPrivateResults(
        nextLookup,
        normalizedQuery,
      );

      if (requestVersionRef.current !== requestVersion) {
        return;
      }

      startTransition(() => {
        setDisplayQuery(normalizedQuery);
        setDisplayResults(nextLookup.results);
        setDisplayPrivateResults(nextPrivateResults);
        setSeedViewerAccess(nextLookup.viewerAccess);
        setLookupStatus("live");
        setBulkEntries([]);
        updateLookupUrl(normalizedQuery, routePath, view);
      });
    } catch {
      if (requestVersionRef.current === requestVersion) {
        setLookupStatus("error");
      }
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setPendingLabel(null);
      }
    }
  }, [fetchAllowedPrivateResults, posthog, privateUiEnabled, routePath, seedViewerAccess.allowed, view]);

  const runBulkLookup = useCallback(async (
    lines: string[],
    options: { flagRefresh?: boolean } = {},
  ) => {
    bulkLookupLinesRef.current = lines;
    if (!options.flagRefresh) {
      bulkPrivateRefreshAttemptedRef.current = privateUiFlag === true;
    }
    if (lines.length === 0) {
      requestVersionRef.current += 1;
      startTransition(() => {
        setBulkEntries([]);
        setDisplayQuery("");
        setDisplayResults([]);
        setDisplayPrivateResults([]);
        setLookupStatus("live");
        updateLookupUrl("", routePath, view);
      });
      return;
    }

    const requestVersion = requestVersionRef.current + 1;

    requestVersionRef.current = requestVersion;
    setPendingLabel(`Searching ${lines.length} lineup entries`);
    captureProductEvent(posthog, "lookup_submitted", {
      access_scope: seedViewerAccessAllowed && privateUiEnabled
        ? "private_and_public"
        : "public_only",
      mode: "bulk",
      view_key: "dj",
    });

    try {
      const entries = await Promise.all(
        lines.map(async (line) => {
          const lookup = await fetchLookupResults(line);
          const privateResults = await fetchAllowedPrivateResults(lookup, line);
          const showPrivate = lookup.viewerAccess.allowed && (
            lookup.viewerAccess.source === "super_admin" || privateUiFlag === true
          );

          return {
            lookup: { ...lookup, privateResults },
            query: line,
            results: mergeLookupSuggestions(
              lookup.results,
              showPrivate ? privateResults : [],
            ),
          };
        }),
      );
      const nextResults = dedupeProfiles(entries.flatMap((entry) => entry.lookup.results));
      const nextPrivateResults = dedupePrivateSeeds(
        entries.flatMap((entry) => entry.lookup.privateResults),
      );
      const nextViewerAccess = entries[0]?.lookup.viewerAccess ?? {
        allowed: seedViewerAccessAllowed,
        source: seedViewerAccessSource,
      };

      if (requestVersionRef.current !== requestVersion) {
        return;
      }

      startTransition(() => {
        setBulkEntries(
          entries.map(({ query: entryQuery, results: entryResults }) => ({
            query: entryQuery,
            results: entryResults,
          })),
        );
        setDisplayQuery(`${lines.length} lineup entries`);
        setDisplayResults(nextResults);
        setDisplayPrivateResults(nextViewerAccess.allowed ? nextPrivateResults : []);
        setSeedViewerAccess(nextViewerAccess);
        setLookupStatus("live");
        updateLookupUrl("", routePath, view);
      });
    } catch {
      if (requestVersionRef.current === requestVersion) {
        setLookupStatus("error");
      }
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setPendingLabel(null);
      }
    }
  }, [
    fetchAllowedPrivateResults,
    posthog,
    privateUiEnabled,
    privateUiFlag,
    routePath,
    seedViewerAccessAllowed,
    seedViewerAccessSource,
    view,
  ]);

  useEffect(() => {
    const lines = bulkLookupLinesRef.current;
    if (!shouldRefreshBulkPrivateLookup({
      bulkEntryCount: bulkEntries.length,
      flagEnabled: privateUiFlag === true,
      lineCount: lines.length,
      refreshAttempted: bulkPrivateRefreshAttemptedRef.current,
    })) {
      return;
    }

    bulkPrivateRefreshAttemptedRef.current = true;
    void runBulkLookup(lines, { flagRefresh: true });
  }, [bulkEntries.length, privateUiFlag, runBulkLookup]);

  const clearLookup = useCallback(() => {
    requestVersionRef.current += 1;
    bulkLookupLinesRef.current = [];
    bulkPrivateRefreshAttemptedRef.current = privateUiFlag === true;
    startTransition(() => {
      setDisplayQuery("");
      setDisplayResults([]);
      setDisplayPrivateResults([]);
      setBulkEntries([]);
      setLookupStatus("live");
      setPendingLabel(null);
      updateLookupUrl("", routePath, view);
    });
  }, [privateUiFlag, routePath, view]);

  const canonicalView = view ?? "dj";
  const switcherQuery = bulkEntries.length > 0 ? undefined : displayQuery;

  return (
    <SearchViewShell
      activeView={canonicalView}
      className="lookup-theme"
      query={switcherQuery}
      searchControl={(
        <LookupSearchBox
          actionPath={routePath}
          initialQuery={displayQuery}
          initialResults={visibleResults}
          isSearching={isSearching}
          onBulkLookup={runBulkLookup}
          onClear={clearLookup}
          onLookup={runLookup}
          showPrivateSuggestions={seedViewerAccess.allowed && privateUiEnabled}
          view={view}
        />
      )}
    >
        <LookupStatusNotice status={lookupStatus} />

        {hasQuery ? (
          <section aria-label="Lookup results" className="grid gap-3">
            {isSearching ? <span className="sr-only">{pendingLabel ?? "Searching"}</span> : null}
            <BulkLookupSummary entries={bulkEntries} />
            <div className={cn("lookup-results-wrap", isSearching ? "lookup-results-wrap--pending" : undefined)}>
              {visiblePublicResults.length === 0 && visiblePrivateResults.length === 0 && !isSearching ? (
                <Card className="lookup-panel" surface="dashed">
                  <p className="font-medium">No matches found.</p>
                </Card>
              ) : visiblePublicResults.length > 0 || visiblePrivateResults.length > 0 ? (
                <>
                  <div className="grid gap-3 min-[1320px]:hidden">
                    {visiblePublicResults.map((profile) => <LookupResultCard key={profile.slug} profile={profile} />)}
                    {visiblePrivateResults.map((candidate) => (
                      <PrivateSeedResultCard candidate={candidate} key={candidate.id} />
                    ))}
                  </div>
                  <TableFrame className="lookup-table hidden min-[1320px]:block">
                    <Table>
                      <TableHead>
                        <tr>
                          <TableHeaderCell>Name</TableHeaderCell>
                          <TableHeaderCell>Genres</TableHeaderCell>
                          <TableHeaderCell>Links</TableHeaderCell>
                        </tr>
                      </TableHead>
                      <tbody className="divide-y divide-border">
                        {visiblePublicResults.map((profile) => <LookupResultRow key={profile.slug} profile={profile} />)}
                        {visiblePrivateResults.map((candidate) => (
                          <PrivateSeedResultRow candidate={candidate} key={candidate.id} />
                        ))}
                      </tbody>
                    </Table>
                  </TableFrame>
                </>
              ) : null}
            </div>
          </section>
        ) : null}
    </SearchViewShell>
  );
}
