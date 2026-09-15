import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  getRouter,
  usePathname,
  useSearchParams,
} from "@storybook/nextjs-vite/navigation.mock";
import { useState } from "react";
import {
  ConvexProvider,
  ConvexReactClient,
  type Watch,
  type WatchQueryOptions,
  type MutationOptions,
} from "convex/react";
import {
  getFunctionName,
  type ArgsAndOptions,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from "convex/server";
import { ClubAnalytics } from "@/app/account/communities/[slug]/club-analytics";
import { ClubInstances } from "@/app/account/communities/[slug]/club-instances";
import {
  ClubWorkspaceView,
  type WorkspaceData,
} from "@/app/account/communities/[slug]/club-workspace";
import { PageContainer, PageShell } from "@/components/ui/page-shell";
import type { Id } from "../../../../convex/_generated/dataModel";

// Storybook-only transport. Every query is resolved here; no server is contacted.
class AnalyticsFixtureClient extends ConvexReactClient {
  private readonly cache = new Map<string, unknown>();
  private readonly fixtureListeners = new Set<() => void>();
  private readonly now = Date.now();
  private preferences = {
    widgets: ["current", "activity", "membership", "instances", "recaps"],
    rangeDays: 30,
  };
  private clubDefaults = this.preferences;
  private personal = false;
  private associatedEvent = false;
  constructor() {
    super("https://fixture.invalid");
  }
  private result(name: string, args: Record<string, unknown>) {
    const key = JSON.stringify([name, args]);
    if (this.cache.has(key)) return this.cache.get(key);
    const start = Number(args.startAt),
      end = Number(args.endAt);
    const session = (index: number, live = false) => ({
      id: `fixture-session-${index}`,
      worldId: `wrld_fixture_${index}`,
      worldName: ["Midnight Atrium", "The Observatory", "Afterhours Lounge"][
        index % 3
      ],
      providerInstanceId: `${10000 + index}~group(grp_fixture)`,
      openedAt: this.now - (index + 1) * 86400_000,
      closedAt: live ? null : this.now - (index + 1) * 86400_000 + 4 * 3600_000,
      lastObservedAt: live
        ? this.now
        : this.now - (index + 1) * 86400_000 + 4 * 3600_000,
      state: live ? "open" : "closed",
    });
    const page = (values: unknown[]) => ({
      page: values,
      isDone: true,
      continueCursor: "",
      before: null,
      after: null,
    });
    let result: unknown;
    if (name === "clubAnalytics:getContext")
      result = {
        now: this.now,
        epochStartedAt: this.now - 100 * 86400_000,
        current: {
          population: 112,
          activeInstances: 2,
          groupMemberCount: 2430,
          observedAt: this.now,
        },
        readableCategories: workspace.readableCategories,
        preferences: this.preferences,
        clubDefaults: this.clubDefaults,
        savedPersonal: this.personal,
      };
    else if (name === "clubAnalytics:getBucket") {
      const index = new Date(start).getDate();
      const peak = [23, 41, 0, 18, 154, 0, 87][index % 7]!;
      result = {
        startAt: start,
        endAt: end,
        complete: true,
        population: {
          peak,
          average: peak * 0.58,
          playerHours: peak * 3.1,
          coverageRatio: 0.97,
          lastValue: peak / 2,
        },
        membership: {
          lastValue: 2360 + index * 3,
          observedAt: end - 300_000,
          netChange: 3,
        },
      };
    } else if (
      name === "clubAnalytics:getSeries" ||
      name === "clubAnalytics:getInstanceSeries"
    )
      result = page(
        Array.from(
          { length: Math.min(288, Math.ceil((end - start) / 300_000)) },
          (_, index) => ({
            at: start + index * 300_000,
            value:
              args.kind === "members"
                ? 2420 + Math.floor(index / 20)
                : Math.round(30 + 90 * Math.sin(index / 30) ** 2),
            coverage: index > 90 && index < 104 ? "unknown" : "observed",
          }),
        ),
      );
    else if (name === "clubAnalytics:listInstances")
      result = page(
        args.kind === "live"
          ? [session(0, true), session(1, true)]
          : [session(2), session(3), session(4)],
      );
    else if (name === "clubAnalytics:getInstance") {
      const index = Number(String(args.sessionId).split("-").at(-1));
      result = session(index, index < 2);
    }
    else if (name === "clubMembership:getMovementBucket")
      result = { joins: 4, departures: 2, complete: true };
    else if (name === "clubAnalytics:getInstanceSummaryPage")
      result = page([
        {
          peak: 154,
          area: 87.2 * (end - start) * 0.97,
          observedDuration: (end - start) * 0.97,
          first: null,
          last: null,
        },
      ]);
    else if (name === "clubAnalytics:listEventRecaps")
      result = page([
        {
          id: "fixture-recap",
          eventId: "fixture-event",
          title: "Afterhours 043",
          slug: "afterhours-043",
          startAt: this.now - 3 * 86400_000,
          endAt: this.now - 3 * 86400_000 + 4 * 3600_000,
          peak: 154,
          playerHours: 602,
          coverageRatio: 0.97,
        },
      ]);
    else if (name === "clubProviderReads:context")
      result = {
        enabledFeatures: ["instances"],
        permittedProviderRoleIds: [],
        protectedUserIds: [],
      };
    else if (name === "communityTelemetry:getInstanceEventAssociation")
      result = this.associatedEvent ? { eventId: "fixture-event", title: "Afterhours 043" } : null;
    else if (name === "clubProviderReads:listEvents")
      result = page([{ id: "fixture-event", title: "Afterhours 043", startAt: this.now, status: "scheduled" }]);
    else if (name === "clubOperations:list")
      result = page([]);
    else throw new Error(`Unmocked fixture query ${name}`);
    this.cache.set(key, result);
    return result;
  }
  override watchQuery<Query extends FunctionReference<"query">>(
    query: Query,
    ...args: ArgsAndOptions<Query, WatchQueryOptions>
  ): Watch<FunctionReturnType<Query>> {
    return {
      onUpdate: (callback) => {
        this.fixtureListeners.add(callback);
        return () => this.fixtureListeners.delete(callback);
      },
      localQueryResult: () =>
        this.result(
          getFunctionName(query),
          args[0] ?? {},
        ) as FunctionReturnType<Query>,
      journal: () => undefined,
    };
  }
  override async mutation<Mutation extends FunctionReference<"mutation">>(
    mutation: Mutation,
    ...args: ArgsAndOptions<Mutation, MutationOptions<FunctionArgs<Mutation>>>
  ): Promise<FunctionReturnType<Mutation>> {
    const value = args[0] as Record<string, unknown> | undefined;
    if (getFunctionName(mutation) === "communityTelemetry:associateEventInstance") this.associatedEvent = true;
    if (
      getFunctionName(mutation) === "clubAnalytics:savePreferences" &&
      value
    ) {
      const prefs = {
        widgets: value.widgets as string[],
        rangeDays: value.rangeDays as number,
      };
      if (value.scope === "club") this.clubDefaults = prefs;
      else {
        this.preferences = prefs;
        this.personal = true;
      }
    }
    if (
      getFunctionName(mutation) === "clubAnalytics:resetPersonalPreferences"
    ) {
      this.preferences = this.clubDefaults;
      this.personal = false;
    }
    this.cache.clear();
    this.fixtureListeners.forEach((callback) => callback());
    return null as FunctionReturnType<Mutation>;
  }
}

const workspace: WorkspaceData = {
  community: {
    _id: "fixture-club" as Id<"profiles">,
    slug: "afterhours",
    displayName: "Afterhours",
  },
  actor: { kind: "owner", roleIds: [], permissions: [] },
  roles: [],
  assignments: [],
  hasMoreAssignments: false,
  invitations: [],
  actionLog: [],
  visibility: null,
  integration: null,
  connectionState: "active",
  readableCategories: [
    "current_population",
    "population_history",
    "group_size",
    "instance_history",
    "membership_movement",
    "event_recaps",
  ],
};
function AnalyticsFixture({
  mode = "home",
}: {
  mode?: "home" | "analytics" | "instances";
}) {
  const [client] = useState(() => new AnalyticsFixtureClient());
  const [href, setHref] = useState(
    `/account/communities/afterhours${mode === "home" ? "" : `/${mode}`}`,
  );
  const url = new URL(href, "https://fixture.invalid");
  usePathname.mockReturnValue(url.pathname);
  useSearchParams.mockReturnValue(
    url.searchParams as ReturnType<typeof useSearchParams>,
  );
  getRouter().push.mockImplementation((next) => setHref(next));
  return (
    <ConvexProvider client={client}>
      <PageShell>
        <PageContainer max="7xl">
          <ClubWorkspaceView data={workspace} pathname={url.pathname}>
            {mode === "instances" ? (
              <ClubInstances />
            ) : (
              <ClubAnalytics mode={mode} />
            )}
          </ClubWorkspaceView>
        </PageContainer>
      </PageShell>
    </ConvexProvider>
  );
}
const meta = {
  title: "Clubs/Analytics",
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Home: Story = { render: () => <AnalyticsFixture /> };
export const Analytics: Story = {
  render: () => <AnalyticsFixture mode="analytics" />,
};
export const Instances: Story = {
  render: () => <AnalyticsFixture mode="instances" />,
};
