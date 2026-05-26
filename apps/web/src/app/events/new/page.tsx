import Link from "next/link";

import { EventEditorForm } from "../event-editor-form";

export default function NewEventPage() {
  return (
    <main className="min-h-screen px-6 py-10 text-foreground sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <nav className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <Link className="font-mono uppercase tracking-[0.28em] text-muted" href="/">
            VRDex
          </Link>
          <Link className="rounded-full border border-border bg-surface px-4 py-2 font-medium" href="/submit">
            Add profile
          </Link>
        </nav>

        <section className="overflow-hidden rounded-[2rem] border border-border bg-surface shadow-[0_24px_80px_rgba(64,40,24,0.12)] backdrop-blur">
          <div className="grid gap-8 px-6 py-8 sm:px-8 lg:grid-cols-[0.82fr_1.18fr] lg:px-10 lg:py-10">
            <div className="flex flex-col justify-between gap-8">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
                  Event publishing
                </p>
                <h1 className="mt-5 text-4xl leading-none font-semibold tracking-[-0.04em] sm:text-6xl">
                  Add a VRDex event.
                </h1>
                <p className="mt-5 max-w-xl text-base leading-7 text-muted sm:text-lg">
                  Create a source-aware event with a readable slug, community host, optional world link, media links, poster image, and published person associations.
                </p>
              </div>

              <div className="rounded-[1.5rem] border border-border bg-surface-strong px-5 py-5">
                <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
                  Scope guard
                </p>
                <p className="mt-3 text-sm leading-7 text-muted">
                  This first editor keeps approval, disputes, RSVP, recurring events, short links, and social discovery in follow-up issues while preserving room for them in the data model.
                </p>
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-border bg-white/45 px-5 py-6 sm:px-6">
              <EventEditorForm />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
