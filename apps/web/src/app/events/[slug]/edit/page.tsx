import Link from "next/link";
import { notFound } from "next/navigation";

import { EventEditorForm } from "../../event-editor-form";
import { EventBackendNotice } from "../../../_components/event-public-page";
import { buttonVariants } from "@/components/ui/button";
import { Card, Eyebrow } from "@/components/ui/card";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { fetchPublicEventBySlug } from "@/convex/server";

export const dynamic = "force-dynamic";

type EditEventPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function EditEventPage({ params }: EditEventPageProps) {
  const { slug } = await params;
  const result = await fetchPublicEventBySlug(slug);

  if (result.kind === "missing-url" || result.kind === "error") {
    return <EventBackendNotice kind={result.kind} />;
  }

  if (result.event === null) {
    notFound();
  }

  return (
    <PageShell className="py-10">
      <PageContainer max="5xl">
        <PageNav>
          <BrandLink />
          <Link className={buttonVariants({ variant: "secondary" })} href={`/e/${result.event.slug}`}>
            View event
          </Link>
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

            <Card surface="glass">
              <EventEditorForm event={result.event} />
            </Card>
          </div>
        </section>
      </PageContainer>
    </PageShell>
  );
}
