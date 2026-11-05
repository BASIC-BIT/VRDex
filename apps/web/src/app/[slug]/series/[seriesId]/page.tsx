import { notFound } from "next/navigation";

import { EventBackendNotice, EventPreviewCard } from "../../../_components/event-public-page";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { fetchPublicEventSeries } from "@/convex/server";

export const dynamic = "force-dynamic";

type EventSeriesPageProps = {
  params: Promise<{ seriesId: string; slug: string }>;
};

export default async function EventSeriesPage({ params }: EventSeriesPageProps) {
  const { seriesId, slug } = await params;
  const result = await fetchPublicEventSeries(seriesId);

  if (result.kind === "missing-url" || result.kind === "error") {
    return <EventBackendNotice kind={result.kind} />;
  }

  const { series } = result;

  if (series === null || series.communitySlug !== slug) {
    notFound();
  }

  return (
    <PageShell className="py-5 sm:py-6 lg:py-7" tone="event">
      <PageContainer className="gap-5">
        <PageNav>
          <BrandLink />
        </PageNav>

        <header>
          <h1 className="text-5xl leading-none font-semibold tracking-[-0.05em] sm:text-7xl">{series.title}</h1>
          {series.summary ? <p className="mt-4 max-w-2xl text-base leading-7 text-muted sm:text-lg">{series.summary}</p> : null}
        </header>

        <Card surface="white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold tracking-tight">Upcoming nights</h2>
            <a className={buttonVariants({ size: "sm", variant: "secondary" })} href={`/${slug}/series/${series.id}/calendar.ics`}>
              Add to calendar
            </a>
          </div>
          {series.nights.length > 0 ? (
            <div className="mt-5 grid gap-3 lg:grid-cols-2">
              {series.nights.map((night) => (
                <EventPreviewCard event={night} key={night.id} />
              ))}
            </div>
          ) : null}
        </Card>
      </PageContainer>
    </PageShell>
  );
}
