"use client";
import { useEffect, useState } from "react";
import { useConvex } from "convex/react";
import { api } from "@convex-generated-api";
import type { EventIdentityOption } from "@/lib/event-editor-identity";
import { ProfileSuggestion } from "../_components/profile-suggestion";
import { eventLocalDate } from "@/lib/calendar/event-intake-date-time";
import type { EventIntakePatch, EventIntakeLocalTime } from "../../../../../packages/api-contracts/src/event-intake";
import { selectEventLocalTime } from "../../../../../packages/api-contracts/src/event-intake";

export function useEventCommunity(slug?: string | null, retained?: EventIdentityOption) {
  const client = useConvex();
  const [cached, setCached] = useState<EventIdentityOption>();
  useEffect(() => {
    if (!slug) return;
    let current = true;
    async function hydrate(slug: string) {
      const profile = await client.query(api.profiles.getPublicBySlug, { slug, profileType: "community", includeTelemetry: false });
      if (current && profile?.displayName) setCached({ kind: "community", slug: profile.slug, title: profile.displayName, href: `/${profile.slug}`, imageUrl: profile.avatarImageUrl, imageKind: profile.avatarImageUrl && profile.avatarImageUrl === profile.mediaKit.primaryLogo?.imageUrl ? "logo" : "profile", appearance: profile.mediaKit.avatarAppearance });
    }
    void hydrate(slug).catch(() => { /* Retain known presentation when public hydration is unavailable. */ });
    return () => { current = false; };
  }, [client, slug]);
  return cached?.slug === slug ? cached : retained?.slug === slug ? retained : undefined;
}

export function EventCommunitySummary({ community }: { community?: EventIdentityOption }) {
  return <div className="flex min-h-10 items-center gap-3" aria-label="Community">{community ? <ProfileSuggestion option={{ ...community, context: undefined, trustLabel: undefined }} /> : <span aria-label="Loading community" className="h-8 w-32 animate-pulse rounded-control bg-surface-strong" />}</div>;
}

export function EventEditorPreview({ fields, artwork, community }: { fields: EventIntakePatch; artwork?: string; community?: EventIdentityOption }) {
  function time(local?: EventIntakeLocalTime | null) {
    if (!local || !fields.eventDate || !fields.timezone) return "";
    try { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(selectEventLocalTime(fields.eventDate, local, fields.timezone)); }
    catch { return ""; }
  }
  return <>
    <h2 className="text-lg font-semibold">Event preview</h2>
    {artwork ? <>{/* Private preview stays local to the editor. */}{/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={artwork} alt="Event artwork" className="max-h-80 w-full rounded-control object-contain" /></> : null}
    {fields.title ? <h3 className="break-words text-2xl font-semibold">{fields.title}</h3> : null}
    <div className="grid gap-2 text-sm text-muted">
      {fields.communitySlug ? <EventCommunitySummary community={community} /> : null}
      {fields.eventDate ? <p>{time(fields.start) || eventLocalDate(fields.eventDate, fields.timeTba ? null : fields.start)}{!fields.timeTba && time(fields.end) ? ` – ${time(fields.end)}` : ""}{fields.timeTba ? " · Time TBA" : ""}</p> : null}
      {fields.venueLabel ? <p>{fields.venueLabel}</p> : null}
    </div>
    {fields.summary ? <p className="break-words text-sm">{fields.summary}</p> : null}
    {fields.lineup?.length ? <div className="grid gap-3 border-t border-border pt-4"><h3 className="font-medium">Lineup</h3>{fields.lineup.map(row => <div key={row.clientKey} className="text-sm"><p>{row.performerLabel || row.personSlug}</p><p className="text-muted">{time(row.start)}{time(row.end) ? ` – ${time(row.end)}` : ""}</p></div>)}</div> : null}
  </>;
}
