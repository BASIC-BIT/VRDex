import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { EventEditorForm } from "../../event-editor-form";
import { EventDiscordExportPanel } from "../../../_components/event-discord-export-panel";
import { EventBackendNotice } from "../../../_components/event-public-page";
import { buttonVariants } from "@/components/ui/button";
import { Card, Eyebrow } from "@/components/ui/card";
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
  const discordPostText = formatDiscordEventPost({
    canonicalUrl: getCanonicalEventUrl(result.event.slug, requestHeaders),
    event: result.event,
  });

  return (
    <PageShell className="py-10">
      <PageContainer max="5xl">
        <PageNav>
          <BrandLink />
          {result.event.publicationState === "published" ? (
            <Link className={buttonVariants({ variant: "secondary" })} href={`/${result.event.slug}`}>
              View event
            </Link>
          ) : null}
        </PageNav>

        <section className="overflow-hidden rounded-hero border border-border bg-surface shadow-hero backdrop-blur">
          <div className="grid gap-8 px-6 py-8 sm:px-8 lg:grid-cols-[0.82fr_1.18fr] lg:px-10 lg:py-10">
            <div className="flex flex-col justify-between gap-8">
              <div>
                <Eyebrow>Event editing</Eyebrow>
                <h1 className="mt-5 text-4xl leading-none font-semibold tracking-[-0.04em] sm:text-6xl">
                  Update {result.event.title}.
                </h1>
                <p className="mt-5 max-w-xl text-base leading-7 text-muted sm:text-lg">
                  Event slugs can be shortened or edited without changing the event identity. Durable generated short links are tracked separately.
                </p>
              </div>
            </div>

            <div className="grid gap-4">
              <Card surface="glass">
                <EventEditorForm event={result.event} />
              </Card>
              <EventDiscordExportPanel text={discordPostText} />
            </div>
          </div>
        </section>
      </PageContainer>
    </PageShell>
  );
}
