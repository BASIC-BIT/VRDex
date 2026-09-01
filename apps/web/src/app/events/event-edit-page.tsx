import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { EventBackendNotice } from "../_components/event-public-page";
import { EventEditorPage } from "./event-editor-page";
import { fetchEditableEventBySlug } from "@/convex/server";
import { formatDiscordEventPost } from "../../../../../convex/_eventDiscordExport";

function firstHeaderValue(value: string | null): string | undefined {
  const firstValue = value?.split(",")[0]?.trim();
  return firstValue === "" ? undefined : firstValue;
}

function requestOrigin(requestHeaders: Headers): string | undefined {
  const host = firstHeaderValue(requestHeaders.get("x-forwarded-host")) ?? firstHeaderValue(requestHeaders.get("host"));
  if (host === undefined) return undefined;

  const protocol = firstHeaderValue(requestHeaders.get("x-forwarded-proto")) ?? (
    host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https"
  );

  try {
    const origin = new URL(`${protocol}://${host}`);
    return origin.protocol === "http:" || origin.protocol === "https:" ? origin.origin : undefined;
  } catch {
    return undefined;
  }
}

export async function EventEditPage({ communitySlug, eventSlug }: { communitySlug: string; eventSlug: string }) {
  const result = await fetchEditableEventBySlug(eventSlug);

  if (result.kind === "missing-url" || result.kind === "error") {
    return <EventBackendNotice kind={result.kind} />;
  }

  if (result.event === null || result.event.communitySlug !== communitySlug) {
    notFound();
  }

  const routePath = `/${communitySlug}/events/${result.event.slug}`;
  const origin = requestOrigin(await headers());
  const canonicalUrl = origin === undefined ? routePath : new URL(routePath, origin).href;
  const discordPostText = result.event.publicationState === "published"
    ? formatDiscordEventPost({ canonicalUrl, event: result.event })
    : null;

  return (
    <EventEditorPage
      communityName={result.event.communityName ?? communitySlug}
      communitySlug={communitySlug}
      discordPostText={discordPostText}
      event={result.event}
    />
  );
}
