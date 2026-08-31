import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { EventDiscordExportPanel } from "../_components/event-discord-export-panel";
import { EventBackendNotice } from "../_components/event-public-page";
import { EventEditorForm } from "./event-editor-form";
import { buttonVariants } from "@/components/ui/button";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
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
    <div className="ph-no-capture" data-ph-no-capture>
      <PageShell className="py-10">
        <PageContainer max="6xl">
          <PageNav>
            <BrandLink />
            {result.event.publicationState === "published" ? (
              <Link className={buttonVariants({ variant: "secondary" })} href={routePath}>
                View event
              </Link>
            ) : null}
          </PageNav>

          <header className="border-b border-border pb-6 pt-2">
            <p className="text-sm font-medium text-muted">Edit event</p>
            <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">{result.event.title}</h1>
          </header>

          <EventEditorForm communitySlug={communitySlug} event={result.event} />
          {discordPostText === null ? null : <EventDiscordExportPanel text={discordPostText} />}
        </PageContainer>
      </PageShell>
    </div>
  );
}
