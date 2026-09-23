import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  getRouter,
  usePathname,
  useSearchParams,
} from "@storybook/nextjs-vite/navigation.mock";
import { useLayoutEffect, useState } from "react";
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
import { ClubConnection } from "@/app/account/communities/[slug]/club-connection";
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
  private suggestions = [
    { id: "fixture-suggestion-1", eventTitle: "Afterhours 043", sessionId: "fixture-session-2", worldName: "Afterhours Lounge", openedAt: this.now - 3 * 86400_000, confidence: 0.75, canConfirm: true },
    { id: "fixture-suggestion-2", eventTitle: "Afterhours 043", sessionId: null, worldName: null, openedAt: null, confidence: 0.75, canConfirm: false },
  ];
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
        now: Date.now(),
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
      if (args.sessionId === "foo") return null;
      if (args.sessionId === "unreadable")
        throw new Error("Instance not found.");
      const index = Number(String(args.sessionId).split("-").at(-1));
      result = session(index, index < 2);
    } else if (name === "clubMembership:getMovementBucket")
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
    else if (name === "clubAnalytics:listAssociationSuggestions")
      result = page(this.suggestions);
    else if (name === "clubProviderReads:context")
      result = {
        enabledFeatures: ["instances"],
        permittedProviderRoleIds: [],
        protectedUserIds: [],
      };
    else if (name === "communityTelemetry:getInstanceEventAssociation")
      result = this.associatedEvent
        ? { eventId: "fixture-event", title: "Afterhours 043" }
        : null;
    else if (name === "clubProviderReads:get")
      result = {
        state: "succeeded",
        fresh: true,
        remainingFreshMs: 60_000,
        result: { items: [], nextOffset: null, observedAt: this.now },
        errorCode: null,
      };
    else if (name === "clubProviderReads:listEvents")
      result = page([
        {
          id: "fixture-event",
          title: "Afterhours 043",
          startAt: this.now,
          status: "scheduled",
        },
      ]);
    else if (name === "clubOperations:list") result = page([]);
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
    if (getFunctionName(mutation) === "clubProviderReads:request")
      return "fixture-read" as FunctionReturnType<Mutation>;
    const value = args[0] as Record<string, unknown> | undefined;
    if (getFunctionName(mutation) === "clubOperations:enqueue" &&
      (value?.schedule as {kind: string})?.kind !== "immediate")
      throw new Error("Expected immediate schedule");
    if (
      getFunctionName(mutation) === "communityTelemetry:associateEventInstance"
    )
      this.associatedEvent = true;
    if (getFunctionName(mutation) === "communityTelemetry:reviewAssociationSuggestion" && value) {
      this.suggestions = this.suggestions.filter((suggestion) => suggestion.id !== value.associationId);
    }
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
  initialInstance,
  canManageEvents = true,
  canReadInstances = true,
}: {
  mode?: "home" | "analytics" | "instances";
  initialInstance?: string;
  canManageEvents?: boolean;
  canReadInstances?: boolean;
}) {
  const [client] = useState(() => new AnalyticsFixtureClient());
  const [href, setHref] = useState(
    `/account/communities/afterhours${mode === "home" ? "" : `/${mode}`}${initialInstance ? `?instance=${initialInstance}` : ""}`,
  );
  const url = new URL(href, "https://fixture.invalid");
  usePathname.mockReturnValue(url.pathname);
  useSearchParams.mockReturnValue(
    url.searchParams as ReturnType<typeof useSearchParams>,
  );
  getRouter().push.mockImplementation((next) => setHref(next));
  const fixtureWorkspace: WorkspaceData = {
    ...workspace,
    actor: canManageEvents
      ? canReadInstances
        ? workspace.actor
        : { kind: "staff", roleIds: [], permissions: ["manage_events"] }
      : { kind: "staff", roleIds: [], permissions: ["manage_integrations"] },
    readableCategories: canReadInstances
      ? workspace.readableCategories
      : workspace.readableCategories.filter((category) => category !== "instance_history"),
  };
  return (
    <ConvexProvider client={client}>
      <PageShell>
        <PageContainer max="7xl">
          <ClubWorkspaceView data={fixtureWorkspace} pathname={url.pathname}>
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
export const AnalyticsWithoutEventManagement: Story = {
  render: () => <AnalyticsFixture mode="analytics" canManageEvents={false} />,
};
export const AnalyticsWithoutInstanceHistory: Story = {
  render: () => <AnalyticsFixture mode="analytics" canReadInstances={false} />,
};
export const Instances: Story = {
  render: () => <AnalyticsFixture mode="instances" />,
};
export const InvalidInstance: Story = {
  render: () => <AnalyticsFixture mode="instances" initialInstance="foo" />,
};
export const UnreadableInstance: Story = {
  render: () => (
    <AnalyticsFixture mode="instances" initialInstance="unreadable" />
  ),
};

// Real query owners with an argument-keyed cache; no server is contacted.
class DisplayFixtureClient extends AnalyticsFixtureClient {
  private values = new Map<string, unknown>();
  private displayListeners = new Set<() => void>();
  readonly attempts = new Set<string>();
  private readonly origin = performance.now();
  private observedAt = 1_800_000_000_000;
  mode = "fresh";
  holdNew = false;
  serverNow() {
    return 1_800_000_000_000 + performance.now() - this.origin;
  }
  change(mode: string) {
    this.mode = mode;
    if (mode === "replace") this.observedAt = this.serverNow();
    if (mode === "aged")
      this.observedAt =
        this.serverNow() - (this.kind === "analytics" ? 345_000 : 45_000);
    if (mode === "near-expiry")
      this.observedAt =
        this.serverNow() - (this.kind === "analytics" ? 360_000 : 60_000) + 1;
    if (mode === "future") this.observedAt = this.serverNow() + 1;
    this.values.clear();
    this.displayListeners.forEach((callback) => callback());
  }
  constructor(
    readonly kind: "analytics" | "connection",
    initial: string,
  ) {
    super();
    this.change(initial === "delayed" ? "aged" : initial);
    this.holdNew = initial === "delayed";
  }
  override watchQuery<Query extends FunctionReference<"query">>(
    query: Query,
    ...args: ArgsAndOptions<Query, WatchQueryOptions>
  ): Watch<FunctionReturnType<Query>> {
    const name = getFunctionName(query);
    if (name !== "clubAnalytics:getContext" && name !== "clubConnection:get")
      return super.watchQuery(query, ...args);
    const key = JSON.stringify([name, args[0]]);
    return {
      onUpdate: (callback) => {
        this.displayListeners.add(callback);
        return () => this.displayListeners.delete(callback);
      },
      localQueryResult: () => {
        if (this.holdNew && !this.attempts.has(key)) return undefined;
        this.attempts.add(key);
        if (!this.values.has(key)) {
          const now = this.serverNow();
          const authority =
            this.mode === "revoked"
              ? null
              : {
                  groupId: "grp_fixture",
                  userId: "usr_fixture",
                  membershipStatus: "member",
                  permissions: ["*"],
                  observedAt: this.mode === "invalid" ? NaN : this.observedAt,
                };
          const result =
            this.mode === "loading"
              ? undefined
              : this.kind === "analytics"
                ? {
                    now,
                    epochStartedAt: 0,
                    current: ["absent", "revoked", "disabled"].includes(
                      this.mode,
                    )
                      ? {}
                      : {
                          population: 112,
                          observedAt:
                            this.mode === "invalid" ? NaN : this.observedAt,
                        },
                    readableCategories: ["current_population"],
                    preferences: { widgets: ["current"], rangeDays: 7 },
                    clubDefaults: { widgets: ["current"], rangeDays: 7 },
                    savedPersonal: false,
                  }
                : this.mode === "absent"
                  ? null
                  : {
                      now,
                      integrationId: "fixture-integration",
                      authority,
                      enabledFeatures:
                        this.mode === "disabled" ? [] : ["analytics"],
                      features: [
                        {
                          feature: "analytics",
                          enabled: this.mode !== "disabled",
                          ready: this.mode !== "not-ready",
                          missingPermissions: [],
                        },
                      ],
                      roles: [],
                    };
          this.values.set(key, result);
        }
        return this.values.get(key) as FunctionReturnType<Query>;
      },
      journal: () => undefined,
    };
  }
}
function DisplayFreshnessFixture({
  kind,
  initial = "fresh",
}: {
  kind: "analytics" | "connection";
  initial?: string;
}) {
  const [client] = useState(() => new DisplayFixtureClient(kind, initial));
  const [ownerKey, remount] = useState(0);
  const [scope, setScope] = useState(false);
  const [allowed, setAllowed] = useState(true);
  const [attempts, inspect] = useState(0);
  const [, rerender] = useState(0);
  const [delayEffect, setDelayEffect] = useState(false);
  useLayoutEffect(() => {
    if (!delayEffect) return;
    // Simulate a main-thread delay after the fresh DOM commit but before the
    // query owner's passive timer effect, without causing another render.
    const label = kind === "analytics" ? "112" : "Connected";
    const wasFresh = Array.from(document.querySelectorAll("p, span")).some(
      (node) => node.textContent === label,
    );
    document.documentElement.dataset.freshBeforeEffect = String(wasFresh);
    const originalNow = performance.now;
    const now = originalNow.bind(performance);
    performance.now = () => now() + 2;
    return () => {
      performance.now = originalNow;
      delete document.documentElement.dataset.freshBeforeEffect;
    };
  }, [delayEffect, kind]);
  usePathname.mockReturnValue("/account/communities/afterhours");
  useSearchParams.mockReturnValue(
    new URLSearchParams() as ReturnType<typeof useSearchParams>,
  );
  const data: WorkspaceData = {
    ...workspace,
    community: {
      ...workspace.community,
      _id: (scope ? "other-club" : "fixture-club") as Id<"profiles">,
      slug: scope ? "other" : "afterhours",
    },
    actor: allowed
      ? workspace.actor
      : { kind: "staff", roleIds: [], permissions: [] },
  };
  return (
    <ConvexProvider client={client}>
      <div>
        {[
          "fresh",
          "aged",
          "replace",
          "future",
          "absent",
          "revoked",
          "loading",
          "disabled",
          "not-ready",
          "invalid",
        ].map((mode) => (
          <button key={mode} onClick={() => client.change(mode)}>
            {mode}
          </button>
        ))}
        <button onClick={() => rerender((value) => value + 1)}>Rerender</button>
        <button onClick={() => remount((value) => value + 1)}>
          Remount owner
        </button>
        <button
          onClick={() => {
            client.holdNew = true;
          }}
        >
          Hold new evaluations
        </button>
        <button
          onClick={() => {
            client.holdNew = false;
            client.change(client.mode);
          }}
        >
          Release evaluations
        </button>
        <button onClick={() => setScope((value) => !value)}>
          Change scope
        </button>
        <button onClick={() => setAllowed((value) => !value)}>
          Toggle access
        </button>
        <button onClick={() => inspect(client.attempts.size)}>
          Inspect attempts
        </button>
        <button
          onClick={() => {
            client.change("near-expiry");
            setDelayEffect(true);
          }}
        >
          Expire during effects
        </button>
        <output aria-label="Attempt count">{attempts}</output>
      </div>
      <ClubWorkspaceView data={data} pathname="/account/communities/afterhours">
        {kind === "analytics" ? (
          <ClubAnalytics key={ownerKey} />
        ) : (
          <ClubConnection key={ownerKey} />
        )}
      </ClubWorkspaceView>
    </ConvexProvider>
  );
}
export const PopulationFreshness: Story = {
  render: () => <DisplayFreshnessFixture kind="analytics" />,
};
export const AuthorityFreshness: Story = {
  render: () => <DisplayFreshnessFixture kind="connection" />,
};
export const PopulationAged: Story = {
  render: () => <DisplayFreshnessFixture kind="analytics" initial="aged" />,
};
export const AuthorityAged: Story = {
  render: () => <DisplayFreshnessFixture kind="connection" initial="aged" />,
};
export const PopulationAbsent: Story = {
  render: () => <DisplayFreshnessFixture kind="analytics" initial="absent" />,
};
export const AuthorityAbsent: Story = {
  render: () => <DisplayFreshnessFixture kind="connection" initial="absent" />,
};
export const PopulationDelayed: Story = {
  render: () => <DisplayFreshnessFixture kind="analytics" initial="delayed" />,
};
export const AuthorityDelayed: Story = {
  render: () => <DisplayFreshnessFixture kind="connection" initial="delayed" />,
};
