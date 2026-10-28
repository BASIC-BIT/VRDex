import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HomeDiscoveryView } from "@/app/_components/discovery/home-discovery";
import type { DiscoverySnapshot } from "@/lib/discovery/controller";
import poster from "../../public/test-media/event-poster.png";
import logo from "../../public/brand/vrdex-wordmark.svg";

type Available = Extract<DiscoverySnapshot, { kind: "available" }>;
const genre: Available["clubs"][number]["genres"][number] = {
  slug: "liquid-dnb",
  displayName: "Liquid DnB",
};
const clubs: Available["clubs"] = [
  {
    id: "prism",
    slug: "prism",
    displayName: "Prism Collective",
    profileType: "community",
    genres: [genre],
    logoImageUrl: typeof logo === "string" ? logo : logo.src,
  },
  {
    id: "tidal",
    slug: "tidal",
    displayName: "Tidal Society",
    profileType: "community",
    genres: [genre],
  },
];
const events: Available["events"] = [
  {
    id: "orbit",
    slug: "orbit",
    href: "/prism/events/orbit",
    title: "ORBIT",
    host: clubs[0],
    schedule: {
      kind: "timed",
      startAt: Date.UTC(2026, 10, 2, 22),
      endAt: Date.UTC(2026, 10, 3, 2),
    },
    posterImageUrl: poster.src,
  },
  {
    id: "low-tide",
    slug: "low-tide",
    href: "/tidal/events/low-tide",
    title: "Low Tide",
    host: clubs[1],
    schedule: { kind: "date_only", eventDate: "2026-12-05" },
    posterImageUrl: poster.src,
  },
];
const eventSignals: Available["eventSignals"] = [
  {
    eventId: "orbit",
    coverage: "complete",
    manualLabels: [],
    performers: [
      {
        id: "aurora",
        slug: "aurora",
        displayName: "Aurora",
        profileType: "person",
        genres: [genre],
      },
    ],
  },
  {
    eventId: "low-tide",
    coverage: "complete",
    manualLabels: [],
    performers: [
      {
        id: "nori",
        slug: "nori",
        displayName: "Nori",
        profileType: "person",
        genres: [genre],
      },
    ],
  },
];
const coverage: Available["coverage"] = {
  events: [
    {
      pages: 1,
      cursor: null,
      complete: true,
      band: 0,
      kind: "timed",
      direction: "asc",
    },
  ],
  clubs: [{ pages: 1, cursor: null, complete: true, direction: "asc" }],
  signals: [],
  candidateCount: 2,
  favoriteCount: 1,
};
const available: Available = {
  kind: "available",
  events,
  clubs,
  eventSignals,
  favoriteProfiles: [],
  coverage,
  refreshing: false,
};
const meta = {
  title: "Home/Discovery",
  component: HomeDiscoveryView,
  decorators: [
    (Story) => (
      <main className="mx-auto max-w-7xl p-5">
        <Story />
      </main>
    ),
  ],
  args: {
    snapshot: available,
    preferences: {
      version: 1,
      plan: [],
      favoriteProfileIds: ["aurora", "prism"],
    },
    timeZone: "America/New_York",
    hour12: true,
    onSelect() {},
    onSave() {},
    onFavorite() {},
    retry() {},
  },
} satisfies Meta<typeof HomeDiscoveryView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Mixed: Story = {};
export const ColdStart: Story = {
  args: { preferences: { version: 1, plan: [], favoriteProfileIds: [] } },
};
export const Sparse: Story = {
  args: {
    snapshot: {
      ...available,
      events: events.slice(0, 1),
      clubs: clubs.slice(0, 1),
    },
  },
};
export const Empty: Story = {
  args: { snapshot: { ...available, events: [], clubs: [] } },
};
export const Partial: Story = {
  args: {
    snapshot: {
      ...available,
      events: [],
      clubs: [],
      coverage: {
        ...coverage,
        events: coverage.events.map((stream) => ({
          ...stream,
          complete: false,
        })),
        clubs: coverage.clubs.map((stream) => ({ ...stream, complete: false })),
      },
    },
  },
};
export const Failed: Story = {
  args: { snapshot: { kind: "error", error: new Error("Fixture failure") } },
};
export const Loading: Story = { args: { snapshot: { kind: "loading" } } };
export const MissingArtwork: Story = {
  args: {
    snapshot: {
      ...available,
      events: events.map((event) => ({ ...event, posterImageUrl: undefined })),
      clubs: clubs.map((club) => ({
        ...club,
        logoImageUrl: undefined,
        imageUrl: undefined,
        bannerImageUrl: undefined,
      })),
    },
  },
};
export const MissingPublicGenres: Story = {
  args: {
    snapshot: {
      ...available,
      eventSignals: [],
      clubs: clubs.map((club) => ({ ...club, genres: [] })),
    },
  },
};
