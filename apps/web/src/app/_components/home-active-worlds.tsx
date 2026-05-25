import Link from "next/link";

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
    startAt: number;
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

function formatEventDate(timestamp: number, timezone: string | undefined): string {
  const baseOptions: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };

  try {
    return new Intl.DateTimeFormat("en", {
      ...baseOptions,
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(new Date(timestamp));
  } catch {
    return new Intl.DateTimeFormat("en", baseOptions).format(new Date(timestamp));
  }
}

function safeImageBackground(imageUrl: string | undefined) {
  if (!imageUrl) {
    return undefined;
  }

  try {
    const url = new URL(imageUrl);

    if (url.protocol !== "https:") {
      return undefined;
    }

    return {
      backgroundImage: `linear-gradient(135deg, rgba(8, 18, 32, 0.72), rgba(8, 145, 178, 0.2)), url(${JSON.stringify(url.href)})`,
    };
  } catch {
    return undefined;
  }
}

function ActiveWorldCard({ world }: { world: PublicActiveWorld }) {
  const heroStyle = safeImageBackground(world.heroImageUrl);
  const tags = world.tags.slice(0, 3);

  return (
    <Link
      className="group flex min-h-72 flex-col justify-between overflow-hidden rounded-[1.5rem] border border-cyan-950/10 bg-slate-950 p-5 text-white shadow-[0_18px_60px_rgba(8,37,53,0.16)] transition hover:-translate-y-1"
      href={`/w/${world.slug}`}
      style={heroStyle}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-white/16 px-3 py-1 font-mono uppercase tracking-[0.18em] text-white/78">
          {world.activityLabel}
        </span>
        <span className="rounded-full bg-cyan-300/18 px-3 py-1 text-cyan-50">
          {world.upcomingEventCount} upcoming
        </span>
      </div>

      <div>
        <h3 className="text-3xl font-semibold tracking-[-0.04em]">{world.displayName}</h3>
        <p className="mt-3 line-clamp-2 text-sm leading-6 text-white/76">
          {world.summary ?? "A VRDex world with confirmed upcoming event context."}
        </p>
        <div className="mt-5 rounded-2xl border border-white/16 bg-white/12 p-4 backdrop-blur">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-white/62">Next event</p>
          <p className="mt-2 font-medium">{world.nextEvent.title}</p>
          <p className="mt-1 text-sm text-white/72">
            {formatEventDate(world.nextEvent.startAt, world.nextEvent.timezone)}
            {world.nextEvent.communityName ? ` by ${world.nextEvent.communityName}` : ""}
          </p>
        </div>
        {tags.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span className="rounded-full bg-white/12 px-3 py-1 text-xs text-white/76" key={tag}>
                {tag}
              </span>
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
    <section className="rounded-[2rem] border border-border bg-white/80 px-5 py-6 shadow-sm sm:px-6 lg:px-8">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">World discovery</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
            Worlds hosting events soon
          </h2>
        </div>
        <p className="max-w-xl text-sm leading-6 text-muted">
          Event-derived venue cards use confirmed VRDex event-world links. They are not live VRChat popularity, private presence, or scraped attendance.
        </p>
      </div>

      {worlds.length > 0 ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {worlds.map((world) => (
            <ActiveWorldCard key={world.slug} world={world} />
          ))}
        </div>
      ) : (
        <div className="mt-6 rounded-[1.5rem] border border-dashed border-border bg-surface px-5 py-6">
          <p className="font-medium">No confirmed upcoming venues yet.</p>
          <p className="mt-2 text-sm leading-6 text-muted">
            {status === "live"
              ? "Published events will appear here after they are explicitly linked to world profiles."
              : "Start the local backend to read active world data, or use fixture mode during visual review."}
          </p>
        </div>
      )}
    </section>
  );
}
