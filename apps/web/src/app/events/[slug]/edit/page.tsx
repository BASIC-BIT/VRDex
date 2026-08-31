import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { EventEditorForm } from "../../event-editor-form";
import { EventDiscordExportPanel } from "../../../_components/event-discord-export-panel";
import { EventBackendNotice } from "../../../_components/event-public-page";
import { buttonVariants } from "@/components/ui/button";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { fetchEditableEventBySlug } from "@/convex/server";
import { formatDiscordEventPost } from "../../../../../../../convex/_eventDiscordExport";

export const dynamic = "force-dynamic";

type EditEventPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

function firstHeaderValue(value: string | null): string | undefined {
  const firstValue = value?.split(",")[0]?.trim();
  return firstValue === "" ? undefined : firstValue;
}

function getRequestOrigin(requestHeaders: Headers): string | undefined {
  const host = firstHeaderValue(requestHeaders.get("x-forwarded-host")) ?? firstHeaderValue(requestHeaders.get("host"));

  if (host === undefined) {
    return undefined;
  }

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

function getCanonicalEventUrl(slug: string, requestHeaders: Headers): string {
  const routePath = `/${slug}`;
  const origin = getRequestOrigin(requestHeaders);

  if (origin === undefined) {
    return routePath;
  }

  return new URL(routePath, origin).href;
}

export default async function EditEventPage({ params }: EditEventPageProps) {
  const { slug } = await params;
  const result = await fetchEditableEventBySlug(slug);

  if (result.kind === "missing-url" || result.kind === "error") {
    return <EventBackendNotice kind={result.kind} />;
  }

  if (result.event === null) {
    notFound();
  }

  const requestHeaders = await headers();
  const discordPostText = result.event.publicationState === "published"
    ? formatDiscordEventPost({
        canonicalUrl: getCanonicalEventUrl(result.event.slug, requestHeaders),
        event: result.event,
      })
    : null;

  return (
    <PageShell className="py-10">
      <PageContainer max="6xl">
        <PageNav>
          <BrandLink />
          {result.event.publicationState === "published" ? (
            <Link className={buttonVariants({ variant: "secondary" })} href={`/${result.event.slug}`}>
              View event
            </Link>
          ) : null}
        </PageNav>

        <header className="border-b border-border pb-6 pt-2">
          <p className="text-sm font-medium text-muted">Edit event</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">{result.event.title}</h1>
        </header>

        <EventEditorForm event={result.event} />
        {discordPostText === null ? null : <EventDiscordExportPanel text={discordPostText} />}
      </PageContainer>
    </PageShell>
  );
}
