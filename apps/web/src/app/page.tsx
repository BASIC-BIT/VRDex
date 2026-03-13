import { ConvexRuntimePanel } from "./convex-runtime-panel";

export default function Home() {
  return (
    <main className="min-h-screen px-6 py-10 text-foreground sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <section className="overflow-hidden rounded-[2rem] border border-border bg-surface shadow-[0_24px_80px_rgba(64,40,24,0.12)] backdrop-blur">
          <div className="grid gap-10 px-6 py-8 sm:px-8 lg:grid-cols-[1.4fr_0.9fr] lg:px-10 lg:py-10">
            <div className="flex flex-col gap-8">
              <div className="flex items-center gap-3 text-sm uppercase tracking-[0.28em] text-muted">
                <span className="rounded-full border border-border px-3 py-1">VRDex</span>
                <span>Web + backend bootstrap</span>
              </div>

              <div className="max-w-3xl space-y-5">
                <h1 className="text-4xl leading-none font-semibold tracking-[-0.04em] sm:text-6xl">
                  Profiles, communities, and scene presence for VRChat.
                </h1>
                <p className="max-w-2xl text-base leading-7 text-muted sm:text-lg">
                  The first <code className="font-mono text-[0.95em]">Next.js</code> runtime
                  path into <code className="font-mono text-[0.95em]">Convex</code> is now in
                  place. This landing page stays lightweight while proving the stack is wired end
                  to end.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <a
                  className="inline-flex items-center justify-center rounded-full bg-accent px-5 py-3 text-sm font-medium text-white transition hover:bg-accent-strong"
                  href="https://nextjs.org/docs"
                  target="_blank"
                  rel="noreferrer"
                >
                  Next.js docs
                </a>
                <a
                  className="inline-flex items-center justify-center rounded-full border border-border bg-surface-strong px-5 py-3 text-sm font-medium transition hover:-translate-y-0.5"
                  href="https://www.convex.dev/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Convex next
                </a>
              </div>
            </div>

            <aside className="rounded-[1.5rem] border border-border bg-surface-strong p-5">
              <ConvexRuntimePanel />
            </aside>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <article className="rounded-[1.5rem] border border-border bg-surface px-5 py-6">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
              Now in place
            </p>
            <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">
              A live app-to-backend read
            </h2>
            <p className="mt-3 text-sm leading-7 text-muted">
              The web app now mounts the minimum Convex client/provider wiring and
              reads the placeholder <code className="font-mono text-[0.95em]">health:status</code>{" "}
              query from the real backend bootstrap.
            </p>
          </article>

          <article className="rounded-[1.5rem] border border-border bg-surface px-5 py-6">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
              Deliberately deferred
            </p>
            <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">
              Schema, auth, and billing depth
            </h2>
            <p className="mt-3 text-sm leading-7 text-muted">
              This slice avoids inventing product tables, auth flows, or payment
              posture. The goal is one obvious runtime path, not premature app
              architecture.
            </p>
          </article>

          <article className="rounded-[1.5rem] border border-border bg-surface px-5 py-6">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
              Immediate follow-on
            </p>
            <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">
              Add the first server-side pattern
            </h2>
            <p className="mt-3 text-sm leading-7 text-muted">
              The next app/data milestone is the first intentional App Router
              server-side Convex read path under <code className="font-mono text-[0.95em]">#64</code>.
            </p>
          </article>
        </section>
      </div>
    </main>
  );
}
