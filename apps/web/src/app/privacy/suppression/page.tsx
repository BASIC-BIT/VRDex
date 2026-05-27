import Link from "next/link";

import { SuppressionRequestForm } from "./suppression-request-form";

export const dynamic = "force-dynamic";

export default function SuppressionRequestPage() {
  return (
    <main className="min-h-screen px-6 py-8 text-foreground sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <nav className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <Link className="font-mono uppercase tracking-[0.28em] text-muted" href="/">
            VRDex
          </Link>
          <Link className="rounded-full border border-border bg-surface px-4 py-2 font-medium" href="/discover">
            Back to discovery
          </Link>
        </nav>

        <section className="rounded-[2rem] border border-border bg-surface px-6 py-8 shadow-[0_24px_80px_rgba(64,40,24,0.12)] sm:px-8">
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
            Privacy and suppression
          </p>
          <h1 className="mt-4 text-4xl leading-none font-semibold tracking-[-0.04em] sm:text-6xl">
            Request review of a public listing.
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-muted sm:text-base">
            VRDex supports owner opt-out and pre-claim safety review as separate paths. This first form records the request and keeps final hiding decisions explicit so search, event, and profile surfaces can enforce them consistently.
          </p>
        </section>

        <section className="rounded-[1.5rem] border border-border bg-surface px-5 py-6 sm:px-6">
          <SuppressionRequestForm />
        </section>
      </div>
    </main>
  );
}
