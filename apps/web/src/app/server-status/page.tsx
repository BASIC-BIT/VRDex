import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, Eyebrow } from "@/components/ui/card";
import { PageContainer, PageShell } from "@/components/ui/page-shell";
import { fetchBackendStatus } from "@/convex/server";

export const dynamic = "force-dynamic";

export default async function ServerStatusPage() {
  const status = await fetchBackendStatus();

  return (
    <PageShell className="py-10">
      <PageContainer className="gap-8" max="4xl">
        <section className="overflow-hidden rounded-hero border border-border bg-surface shadow-hero backdrop-blur">
          <div className="flex flex-col gap-8 px-6 py-8 sm:px-8 lg:px-10 lg:py-10">
            <div className="flex items-center gap-3 text-sm uppercase tracking-[0.28em] text-muted">
              <Badge shape="pill">VRDex</Badge>
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
                className={buttonVariants({ size: "lg", variant: "primary" })}
                href="/"
              >
                Back to homepage
              </Link>
              <a
                className={buttonVariants({ size: "lg", variant: "secondary" })}
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
          <Card>
            <Eyebrow>Live result</Eyebrow>

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
                  <div className="rounded-card border border-border bg-surface-strong px-4 py-4">
                    <dt className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted">
                      Status
                    </dt>
                    <dd className="mt-2 font-medium">{status.data.status}</dd>
                  </div>
                  <div className="rounded-card border border-border bg-surface-strong px-4 py-4">
                    <dt className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted">
                      Scope
                    </dt>
                    <dd className="mt-2 font-medium">{status.data.scope}</dd>
                  </div>
                  <div className="rounded-card border border-border bg-surface-strong px-4 py-4">
                    <dt className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted">
                      Backend
                    </dt>
                    <dd className="mt-2 font-medium">{status.data.backend}</dd>
                  </div>
                  <div className="rounded-card border border-border bg-surface-strong px-4 py-4">
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
                  bootstrap writes <code className="font-mono text-[0.95em]">NEXT_PUBLIC_CONVEX_URL</code> into
                  <code className="font-mono text-[0.95em]"> apps/web/.env.local</code> before using this
                  server-side route.
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
          </Card>

          <Card>
            <Eyebrow>Pattern rule</Eyebrow>
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
          </Card>
        </section>
      </PageContainer>
    </PageShell>
  );
}
