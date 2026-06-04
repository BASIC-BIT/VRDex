import Link from "next/link";

import { EventEditorForm } from "../event-editor-form";
import { buttonVariants } from "@/components/ui/button";
import { Card, Eyebrow } from "@/components/ui/card";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export default function NewEventPage() {
  return (
    <PageShell className="py-10">
      <PageContainer max="5xl">
        <PageNav>
          <BrandLink />
          <Link className={buttonVariants({ variant: "secondary" })} href="/submit">
            Add profile
          </Link>
        </PageNav>

        <section className="overflow-hidden rounded-hero border border-border bg-surface shadow-hero backdrop-blur">
          <div className="grid gap-8 px-6 py-8 sm:px-8 lg:grid-cols-[0.82fr_1.18fr] lg:px-10 lg:py-10">
            <div className="flex flex-col justify-between gap-8">
              <div>
                <Eyebrow>Event publishing</Eyebrow>
                <h1 className="mt-5 text-4xl leading-none font-semibold tracking-[-0.04em] sm:text-6xl">
                  Add a VRDex event.
                </h1>
                <p className="mt-5 max-w-xl text-base leading-7 text-muted sm:text-lg">
                  Create a source-aware event with a readable slug, community host, optional world link, media links, poster image, and published person associations.
                </p>
              </div>

              <Card surface="strong">
                <Eyebrow>Scope guard</Eyebrow>
                <p className="mt-3 text-sm leading-7 text-muted">
                  This first editor keeps approval, disputes, RSVP, recurring events, short links, and social discovery in follow-up issues while preserving room for them in the data model.
                </p>
              </Card>
            </div>

            <Card surface="glass">
              <EventEditorForm />
            </Card>
          </div>
        </section>
      </PageContainer>
    </PageShell>
  );
}
