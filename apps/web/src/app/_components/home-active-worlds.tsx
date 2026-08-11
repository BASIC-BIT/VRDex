import Link from "next/link";

import { Eyebrow, SectionHeading } from "@/components/ui/card";
import { EntityImage } from "@/components/ui/entity-image";
import { Notice } from "@/components/ui/notice";
import { ViewerLocalEventDateTime } from "./viewer-local-event-times";

type EventSourceType = "manual" | "community" | "partner" | "import" | "ai_suggested";

export type PublicActiveWorld = {
  slug: string;
  displayName: string;
  tags: string[];
  summary?: string;
  heroImageUrl?: string;
  upcomingEventCount: number;
  activityLabel: "Hosting upcoming events";
  nextEvent: {
    title: string;
    slug?: string;
    startAt: number;
    doorsOpenAt?: number;
    endAt?: number;
    timezone?: string;
    communityName?: string;
    source: {
      sourceType: EventSourceType;
      label: string;
      url?: string;
    };
  };
};

function ActiveWorldCard({ world }: { world: PublicActiveWorld }) {
  return (
    <Link
      className="group relative flex aspect-[4/3] min-h-72 min-w-0 flex-col justify-between overflow-hidden rounded-panel border border-border bg-media p-5 !text-white shadow-panel transition hover:-translate-y-1"
      href={`/${world.slug}`}
    >
      <EntityImage className="absolute inset-0 size-full rounded-none bg-media text-4xl text-white" label={world.displayName} sizes="(min-width: 1024px) 33vw, 100vw" src={world.heroImageUrl} />
      <span aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--media)_80%,transparent),color-mix(in_srgb,var(--accent)_16%,transparent))]" />

      <div className="relative">
        <h3 className="text-3xl font-semibold text-white">{world.displayName}</h3>
        <p className="mt-3 line-clamp-2 text-sm leading-6 text-white/76">
          {world.summary ?? "Upcoming public events are linked here."}
        </p>
        <div className="mt-5 rounded-card border border-white/16 bg-white/12 p-4 backdrop-blur">
          <Eyebrow className="text-white/62" tone="inverse">Next event</Eyebrow>
          <p className="mt-2 font-medium text-white">{world.nextEvent.title}</p>
          <p className="mt-1 text-sm text-white/72">
            <ViewerLocalEventDateTime timestamp={world.nextEvent.startAt} />
            {world.nextEvent.communityName ? ` by ${world.nextEvent.communityName}` : ""}
          </p>
        </div>
      </div>
    </Link>
  );
}

export function HomeActiveWorldsSection({
  status,
  worlds,
}: {
  status: "live" | "missing-url" | "error";
  worlds: PublicActiveWorld[];
}) {
  return (
    <section className="min-w-0 border-t border-border pt-6">
      <SectionHeading>Featured worlds</SectionHeading>

      {worlds.length > 0 ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {worlds.map((world) => (
            <ActiveWorldCard key={world.slug} world={world} />
          ))}
        </div>
      ) : (
        <Notice className="mt-6 px-5 py-6" variant="dashed">
          <p className="font-medium">No confirmed upcoming venues yet.</p>
          <p className="mt-2 text-sm leading-6 text-muted">
            {status === "live"
              ? "Published events will appear here after they are explicitly linked to world profiles."
              : "Start the local backend to read active world data, or use fixture mode during visual review."}
          </p>
        </Notice>
      )}
    </section>
  );
}
