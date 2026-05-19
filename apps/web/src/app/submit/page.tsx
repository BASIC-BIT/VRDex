import Link from "next/link";

import { ProfileSubmissionForm } from "./profile-submission-form";

export default function SubmitProfilePage() {
  return (
    <main className="min-h-screen px-6 py-10 text-foreground sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <nav className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <Link className="font-mono uppercase tracking-[0.28em] text-muted" href="/">
            VRDex
          </Link>
          <Link
            className="rounded-full border border-border bg-surface px-4 py-2 font-medium"
            href="/server-status"
          >
            Server status
          </Link>
        </nav>

        <section className="overflow-hidden rounded-[2rem] border border-border bg-surface shadow-[0_24px_80px_rgba(64,40,24,0.12)] backdrop-blur">
          <div className="grid gap-8 px-6 py-8 sm:px-8 lg:grid-cols-[0.85fr_1.15fr] lg:px-10 lg:py-10">
            <div className="flex flex-col justify-between gap-8">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
                  Community submissions
                </p>
                <h1 className="mt-5 text-4xl leading-none font-semibold tracking-[-0.04em] sm:text-6xl">
                  Add a missing VRChat scene profile.
                </h1>
                <p className="mt-5 max-w-xl text-base leading-7 text-muted sm:text-lg">
                  This first submission flow creates ordinary unclaimed profiles for people and communities. It keeps the field set narrow so community entries are useful without pretending to be owner-authored pages.
                </p>
              </div>

              <div className="rounded-[1.5rem] border border-border bg-surface-strong px-5 py-5">
                <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
                  Safe by default
                </p>
                <p className="mt-3 text-sm leading-7 text-muted">
                  Submission requires Convex auth, stores source attribution for later moderation, generates the canonical slug server-side, and publishes with an unclaimed trust state.
                </p>
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-border bg-white/45 px-5 py-6 sm:px-6">
              <ProfileSubmissionForm />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
