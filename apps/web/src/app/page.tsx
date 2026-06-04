import Link from "next/link";
import { DiscoverySearchForm } from "./_components/discovery-analytics";
import { HomeActiveWorldsSection } from "./_components/home-active-worlds";
import { BackendStatusCard } from "./backend-status-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, Eyebrow, SectionTitle } from "@/components/ui/card";
import { PageContainer, PageShell } from "@/components/ui/page-shell";
import { fetchDiscovery, fetchHomeActiveWorlds } from "@/convex/server";

export const dynamic = "force-dynamic";

function formatHomeEventTime(value: number | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function Home() {
  const [activeWorlds, discovery] = await Promise.all([fetchHomeActiveWorlds(), fetchDiscovery()]);
  const featuredEvents = discovery.data.upcomingEvents.slice(0, 3);

  return (
    <PageShell className="py-10">
      <PageContainer className="gap-8">
        <section className="overflow-hidden rounded-hero bg-[#221512] text-white shadow-hero">
          <div className="grid gap-10 bg-[radial-gradient(circle_at_top_left,rgba(214,106,77,0.34),transparent_34%),linear-gradient(135deg,#221512,#7c321f)] px-6 py-8 sm:px-8 lg:grid-cols-[1.35fr_0.9fr] lg:px-10 lg:py-12">
            <div className="flex flex-col gap-8">
              <div className="flex items-center gap-3 text-sm uppercase tracking-[0.28em] text-white/68">
                <Badge className="border-white/25 bg-transparent" shape="pill" variant="inverseMuted">VRDex</Badge>
                <span>Search-first discovery</span>
              </div>

              <div className="max-w-3xl space-y-5">
                <h1 className="text-5xl leading-none font-semibold tracking-[-0.055em] sm:text-7xl">
                  Find what is happening in VRChat tonight.
                </h1>
                <p className="max-w-2xl text-base leading-7 text-white/76 sm:text-lg">
                  Search people, communities, worlds, and events with trust labels, source-aware ranking, and featured posters built for the VRChat scene.
                </p>
              </div>

              <DiscoverySearchForm />

              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  className={buttonVariants({ size: "lg", variant: "inversePrimary" })}
                  href="/discover"
                >
                  Explore discovery
                </Link>
                <Link
                  className={buttonVariants({ size: "lg", variant: "inverse" })}
                  href="/events/new"
                >
                  Add an event
                </Link>
                <Link
                  className={buttonVariants({ size: "lg", variant: "inverse" })}
                  href="/submit"
                >
                  Add a profile
                </Link>
              </div>
            </div>

            <aside className="rounded-panel border border-white/18 bg-white/14 p-5 backdrop-blur">
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-white/64">
                Tonight and soon
              </p>
              <div className="mt-5 grid gap-3">
                {featuredEvents.length === 0 ? (
                  <p className="text-sm leading-6 text-white/74">Public event posters will land here as events are added.</p>
                ) : (
                  featuredEvents.map((event) => (
                    <Link
                      className="rounded-card border border-white/14 bg-white/12 px-4 py-4 transition hover:-translate-y-0.5"
                      href={event.routePath}
                      key={`${event.entityType}-${event.slug}`}
                    >
                      <span className="block text-lg font-semibold tracking-[-0.03em]">{event.title}</span>
                      <span className="mt-1 block text-sm text-white/70">{formatHomeEventTime(event.startsAt) ?? event.subtitle}</span>
                    </Link>
                  ))
                )}
              </div>

              <div className="mt-5 border-t border-white/15 pt-5 text-foreground">
                <BackendStatusCard />
              </div>
            </aside>
          </div>
        </section>

        <HomeActiveWorldsSection status={activeWorlds.kind} worlds={activeWorlds.worlds} />

        <section className="grid gap-4 lg:grid-cols-3">
          <Card>
            <Eyebrow>Now in place</Eyebrow>
            <SectionTitle className="mt-4 text-2xl tracking-[-0.03em]">
              Public profile routes
            </SectionTitle>
            <p className="mt-3 text-sm leading-7 text-muted">
              Person pages live under <code className="font-mono text-[0.95em]">/p/&lt;slug&gt;</code>,
              community pages live under <code className="font-mono text-[0.95em]">/c/&lt;slug&gt;</code>,
              and both render shared identity, presentation, and trust state.
            </p>
          </Card>

          <Card>
            <Eyebrow>Deliberately deferred</Eyebrow>
            <SectionTitle className="mt-4 text-2xl tracking-[-0.03em]">
              Owner authority still separate
            </SectionTitle>
            <p className="mt-3 text-sm leading-7 text-muted">
              Community submissions create unclaimed profiles only. Rich claim,
              auth-provider setup, billing posture, and moderation workflows stay
              in their own follow-on issues.
            </p>
          </Card>

          <Card>
            <Eyebrow>Initial readiness</Eyebrow>
            <SectionTitle className="mt-4 text-2xl tracking-[-0.03em]">
              Hosted previews first
            </SectionTitle>
            <p className="mt-3 text-sm leading-7 text-muted">
              Before deeper product discovery, VRDex needs live Vercel previews,
              auth wiring, and stronger validation loops so each change can be
              checked outside a local workstation.
            </p>
          </Card>
        </section>
      </PageContainer>
    </PageShell>
  );
}
