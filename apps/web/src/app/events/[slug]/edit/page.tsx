import Link from "next/link";
import { notFound } from "next/navigation";

import { EventEditorForm } from "../../event-editor-form";
import { EventBackendNotice } from "../../../_components/event-public-page";
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
    <main className="min-h-screen px-6 py-10 text-foreground sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <nav className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <Link className="font-mono uppercase tracking-[0.28em] text-muted" href="/">
            VRDex
          </Link>
          <Link className="rounded-full border border-border bg-surface px-4 py-2 font-medium" href={`/e/${result.event.slug}`}>
            View event
          </Link>
        </nav>

        <section className="overflow-hidden rounded-[2rem] border border-border bg-surface shadow-[0_24px_80px_rgba(64,40,24,0.12)] backdrop-blur">
          <div className="grid gap-8 px-6 py-8 sm:px-8 lg:grid-cols-[0.82fr_1.18fr] lg:px-10 lg:py-10">
            <div className="flex flex-col justify-between gap-8">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
                  Event editing
                </p>
                <h1 className="mt-5 text-4xl leading-none font-semibold tracking-[-0.04em] sm:text-6xl">
                  Update {result.event.title}.
                </h1>
                <p className="mt-5 max-w-xl text-base leading-7 text-muted sm:text-lg">
                  Event slugs can be shortened or edited without changing the event identity. Durable generated short links are tracked separately.
                </p>
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-border bg-white/45 px-5 py-6 sm:px-6">
              <EventEditorForm event={result.event} />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
