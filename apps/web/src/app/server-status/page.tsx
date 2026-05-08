import Link from "next/link";
import { fetchBackendStatus } from "@/convex/server";

export const dynamic = "force-dynamic";

export default async function ServerStatusPage() {
  const status = await fetchBackendStatus();

  return (
    <main className="min-h-screen px-6 py-10 text-foreground sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <section className="overflow-hidden rounded-[2rem] border border-border bg-surface shadow-[0_24px_80px_rgba(64,40,24,0.12)] backdrop-blur">
          <div className="flex flex-col gap-8 px-6 py-8 sm:px-8 lg:px-10 lg:py-10">
            <div className="flex items-center gap-3 text-sm uppercase tracking-[0.28em] text-muted">
              <span className="rounded-full border border-border px-3 py-1">VRDex</span>
              <span>Server-side Convex baseline</span>
            </div>

            <div className="max-w-3xl space-y-5">
              <h1 className="text-4xl leading-none font-semibold tracking-[-0.04em] sm:text-6xl">
                First server-side App Router read path.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted sm:text-lg">
                This route demonstrates the baseline <code className="font-mono text-[0.95em]">Next.js</code>{" "}
                server-component pattern for Convex in VRDex: use <code className="font-mono text-[0.95em]">fetchQuery</code>{" "}
                for a server-only read, and keep <code className="font-mono text-[0.95em]">useQuery</code> for
                reactive client surfaces.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                className="inline-flex items-center justify-center rounded-full bg-accent px-5 py-3 text-sm font-medium text-white transition hover:bg-accent-strong"
                href="/"
              >
                Back to homepage
              </Link>
              <a
                className="inline-flex items-center justify-center rounded-full border border-border bg-surface-strong px-5 py-3 text-sm font-medium transition hover:-translate-y-0.5"
                href="https://docs.convex.dev/client/nextjs/app-router/server-rendering"
                target="_blank"
                rel="noreferrer"
              >
                Convex server docs
              </a>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <article className="rounded-[1.5rem] border border-border bg-surface px-5 py-6">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
              Live result
            </p>

            {status.kind === "live" ? (
              <>
                <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">
                  Server read reached Convex
                </h2>
                <p className="mt-3 text-sm leading-7 text-muted">
                  This page rendered on the server using <code className="font-mono text-[0.95em]">fetchQuery(api.health.status)</code>{" "}
                  before the response reached the browser.
                </p>

                <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                  <div className="rounded-2xl border border-border bg-surface-strong px-4 py-4">
                    <dt className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted">
                      Status
                    </dt>
                    <dd className="mt-2 font-medium">{status.data.status}</dd>
                  </div>
                  <div className="rounded-2xl border border-border bg-surface-strong px-4 py-4">
                    <dt className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted">
                      Scope
                    </dt>
                    <dd className="mt-2 font-medium">{status.data.scope}</dd>
                  </div>
                  <div className="rounded-2xl border border-border bg-surface-strong px-4 py-4">
                    <dt className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted">
                      Backend
                    </dt>
                    <dd className="mt-2 font-medium">{status.data.backend}</dd>
                  </div>
                  <div className="rounded-2xl border border-border bg-surface-strong px-4 py-4">
                    <dt className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted">
                      Note
                    </dt>
                    <dd className="mt-2 font-medium">{status.data.note}</dd>
                  </div>
                </dl>
              </>
            ) : status.kind === "missing-url" ? (
              <>
                <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">
                  Convex URL not configured
                </h2>
                <p className="mt-3 text-sm leading-7 text-muted">
                  Run <code className="font-mono text-[0.95em]">pnpm bootstrap:backend:local</code> so the local
                  bootstrap mirrors <code className="font-mono text-[0.95em]">NEXT_PUBLIC_CONVEX_URL</code> into the
                  web app before using this server-side route.
                </p>
              </>
            ) : (
              <>
                <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">
                  Convex server read failed
                </h2>
                <p className="mt-3 text-sm leading-7 text-muted">
                  Start <code className="font-mono text-[0.95em]">pnpm dev:backend:local</code>, confirm
                  <code className="font-mono text-[0.95em]"> NEXT_PUBLIC_CONVEX_URL</code> is available to the web app,
                  and reload this page.
                </p>
              </>
            )}
          </article>

          <aside className="rounded-[1.5rem] border border-border bg-surface px-5 py-6">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
              Pattern rule
            </p>
            <dl className="mt-5 space-y-4 text-sm">
              <div className="border-b border-border pb-4">
                <dt className="font-medium">Use <code className="font-mono text-[0.95em]">fetchQuery</code></dt>
                <dd className="mt-2 leading-6 text-muted">
                  For server components, route handlers, and server actions that only need a server-side read.
                </dd>
              </div>
              <div className="border-b border-border pb-4">
                <dt className="font-medium">Use <code className="font-mono text-[0.95em]">useQuery</code></dt>
                <dd className="mt-2 leading-6 text-muted">
                  For reactive client components like the homepage runtime card that should update after first render.
                </dd>
              </div>
              <div>
                <dt className="font-medium">Defer <code className="font-mono text-[0.95em]">preloadQuery</code></dt>
                <dd className="mt-2 leading-6 text-muted">
                  Until a feature actually needs server-rendered first paint plus a hydrated reactive client handoff.
                </dd>
              </div>
            </dl>
          </aside>
        </section>
      </div>
    </main>
  );
}
