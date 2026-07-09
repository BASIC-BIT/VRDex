import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, Eyebrow, SectionHeading } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { safeImageBackground } from "@/lib/safe-image";
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

const activeWorldOverlay = "linear-gradient(135deg, rgba(8, 18, 32, 0.72), rgba(8, 145, 178, 0.2))";

function ActiveWorldCard({ world }: { world: PublicActiveWorld }) {
  const heroStyle = safeImageBackground(world.heroImageUrl, activeWorldOverlay);
  const tags = world.tags.slice(0, 3);

  return (
    <Link
      className="group flex min-h-72 flex-col justify-between overflow-hidden rounded-panel border border-cyan-950/10 bg-slate-950 p-5 !text-white shadow-panel transition hover:-translate-y-1"
      href={`/w/${world.slug}`}
      style={heroStyle}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge mono variant="inverse">
          {world.activityLabel}
        </Badge>
        <Badge className="bg-cyan-300/18 text-cyan-50" variant="inverseMuted">
          {world.upcomingEventCount} upcoming
        </Badge>
      </div>

      <div>
        <h3 className="text-3xl font-semibold tracking-[-0.04em] text-white">{world.displayName}</h3>
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
        {tags.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <Badge variant="inverseMuted" key={tag}>
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
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
    <Card className="lg:px-8" surface="white">
      <SectionHeading
        description="Worlds with upcoming public events."
      >
        Worlds hosting events soon
      </SectionHeading>

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
    </Card>
  );
}
