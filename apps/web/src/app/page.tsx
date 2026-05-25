import Link from "next/link";
import { HomeActiveWorldsSection } from "./_components/home-active-worlds";
import { BackendStatusCard } from "./backend-status-card";
import { fetchHomeActiveWorlds } from "@/convex/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const activeWorlds = await fetchHomeActiveWorlds();

  return (
    <main className="min-h-screen px-6 py-10 text-foreground sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <section className="overflow-hidden rounded-[2rem] border border-border bg-surface shadow-[0_24px_80px_rgba(64,40,24,0.12)] backdrop-blur">
          <div className="grid gap-10 px-6 py-8 sm:px-8 lg:grid-cols-[1.4fr_0.9fr] lg:px-10 lg:py-10">
            <div className="flex flex-col gap-8">
              <div className="flex items-center gap-3 text-sm uppercase tracking-[0.28em] text-muted">
                <span className="rounded-full border border-border px-3 py-1">VRDex</span>
                <span>Web + Convex runtime path</span>
              </div>

              <div className="max-w-3xl space-y-5">
                <h1 className="text-4xl leading-none font-semibold tracking-[-0.04em] sm:text-6xl">
                  Profiles, communities, and scene presence for VRChat.
                </h1>
                <p className="max-w-2xl text-base leading-7 text-muted sm:text-lg">
                  VRDex now has the first submit-to-public-profile path: signed-in
                  community members can seed unclaimed people and communities, and
                  published profiles render at their canonical URLs.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  className="inline-flex items-center justify-center rounded-full bg-accent px-5 py-3 text-sm font-medium text-white transition hover:bg-accent-strong"
                  href="/submit"
                >
                  Add a profile
                </Link>
                <Link
                  className="inline-flex items-center justify-center rounded-full border border-border bg-surface-strong px-5 py-3 text-sm font-medium transition hover:-translate-y-0.5"
                  href="/server-status"
                >
                  Server-side baseline
                </Link>
                <Link
                  className="inline-flex items-center justify-center rounded-full border border-border bg-surface-strong px-5 py-3 text-sm font-medium transition hover:-translate-y-0.5"
                  href="/deployment"
                >
                  Deployment check
                </Link>
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
              <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted">
                Scaffold choices
              </p>
              <dl className="mt-5 space-y-4 text-sm">
                <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
                  <dt className="text-muted">Framework</dt>
                  <dd className="text-right font-medium">Next.js 16 App Router</dd>
                </div>
                <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
                  <dt className="text-muted">Language</dt>
                  <dd className="text-right font-medium">TypeScript</dd>
                </div>
                <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
                  <dt className="text-muted">Styling</dt>
                  <dd className="text-right font-medium">Tailwind CSS v4</dd>
                </div>
                <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
                  <dt className="text-muted">Package manager</dt>
                  <dd className="text-right font-medium">pnpm workspace</dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-muted">Next issues</dt>
                  <dd className="text-right font-medium">#18, #59, #61</dd>
                </div>
              </dl>

              <div className="mt-5 border-t border-border pt-5">
                <BackendStatusCard />
              </div>
            </aside>
          </div>
        </section>

        <HomeActiveWorldsSection status={activeWorlds.kind} worlds={activeWorlds.worlds} />

        <section className="grid gap-4 lg:grid-cols-3">
          <article className="rounded-[1.5rem] border border-border bg-surface px-5 py-6">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
              Now in place
            </p>
            <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">
              Public profile routes
            </h2>
            <p className="mt-3 text-sm leading-7 text-muted">
              Person pages live under <code className="font-mono text-[0.95em]">/p/&lt;slug&gt;</code>,
              community pages live under <code className="font-mono text-[0.95em]">/c/&lt;slug&gt;</code>,
              and both render shared identity, presentation, and trust state.
            </p>
          </article>

          <article className="rounded-[1.5rem] border border-border bg-surface px-5 py-6">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
              Deliberately deferred
            </p>
            <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">
              Owner authority still separate
            </h2>
            <p className="mt-3 text-sm leading-7 text-muted">
              Community submissions create unclaimed profiles only. Rich claim,
              auth-provider setup, billing posture, and moderation workflows stay
              in their own follow-on issues.
            </p>
          </article>

          <article className="rounded-[1.5rem] border border-border bg-surface px-5 py-6">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
              Initial readiness
            </p>
            <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">
              Hosted previews first
            </h2>
            <p className="mt-3 text-sm leading-7 text-muted">
              Before deeper product discovery, VRDex needs live Vercel previews,
              auth wiring, and stronger validation loops so each change can be
              checked outside a local workstation.
            </p>
          </article>
        </section>
      </div>
    </main>
  );
}
