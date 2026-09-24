import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ConvexProvider, ConvexReactClient, type Watch, type WatchQueryOptions, type MutationOptions } from "convex/react";
import { getFunctionName, type ArgsAndOptions, type FunctionReference, type FunctionArgs, type FunctionReturnType } from "convex/server";
import { ClubInstanceList, ClubInstanceDetail } from "@/app/account/communities/[slug]/club-instances";
import { ClubWorkspaceView, type WorkspaceData } from "@/app/account/communities/[slug]/club-workspace";
import { Card, SectionTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Id } from "../../../../convex/_generated/dataModel";

const SERVER_START = 1_800_000_000_000;
// Only synthetic Convex transport. The real list, detail, metrics and action
// components consume these responses, including nonce-keyed held evaluations.
class SessionFixtureClient extends ConvexReactClient {
  private startedAt = performance.now();
  private observation = SERVER_START;
  private cache = new Map<string, unknown>();
  private clocks = new Map<string, number>();
  private listNonces = { live: new Set<string>(), history: new Set<string>() };
  private callbacks = new Set<() => void>();
  private held = false;
  private eligible = true;
  private empty: boolean;
  private addedObservation: number | null = null;
  constructor(private record: (value: unknown) => void, private variant = "normal") {
    super("https://fixture.invalid");
    this.empty = variant === "empty";
  }
  update(mode: string) {
    if (mode === "Hold evaluations") { this.held = true; return; }
    if (mode === "Release evaluations") {
      this.held = false;
      if (this.variant === "delayed-clock") this.variant = "normal";
    }
    if (mode === "Disconnect") this.eligible = false;
    if (mode === "Add fresh row") {
      this.empty = false;
      this.addedObservation = this.now();
    }
    if (mode === "Replace observation") {
      this.observation = this.now();
      this.eligible = true;
    }
    this.cache.clear();
    this.callbacks.forEach(callback => callback());
  }
  private now() { return SERVER_START + performance.now() - this.startedAt; }
  attempts() { return { live: this.listNonces.live.size, history: this.listNonces.history.size, clocks: this.clocks.size }; }
  private result(name: string, args: Record<string, unknown>) {
    if (name === "clubAnalytics:getInstanceListClock") {
      const nonce = String(args.freshnessNonce);
      if (this.clocks.has(nonce)) return this.clocks.get(nonce);
      if (this.held || this.variant === "delayed-clock") return undefined;
      this.clocks.set(nonce, this.now());
      return this.clocks.get(nonce);
    }
    const key = JSON.stringify([name, args]);
    if (this.cache.has(key)) return this.cache.get(key);
    const temporal = name === "clubAnalytics:listInstances" || name === "clubAnalytics:getInstance";
    if (temporal && this.held) return undefined;
    const now = this.now();
    const row = {
      id: "session-one", worldId: "wrld_33333333-3333-3333-3333-333333333333",
      worldName: "The Observatory", providerInstanceId: "123~group(grp_fixture)",
      openedAt: SERVER_START - 240_000, lastObservedAt: this.observation,
      closedAt: null, state: "open", now,
      liveObservedAt: this.eligible && now - this.observation <= 360_000 ? this.observation : null,
    };
    const page = (values: unknown[]) => ({ page: values, isDone: true, continueCursor: "", before: null, after: null });
    let result: unknown;
    if (name === "clubAnalytics:listInstances") {
      this.listNonces[args.kind as "live" | "history"].add(String(args.freshnessNonce));
      const cursor = (args.paginationOpts as { cursor: string | null }).cursor;
      const observation = this.addedObservation ?? now;
      const added = { ...row, id: "session-two", worldName: "New arrival", openedAt: observation - 60_000, lastObservedAt: observation, liveObservedAt: observation };
      if (this.variant === "paginated" || this.variant === "filtered-pages")
        result = cursor ? page([added]) : { ...page(this.variant === "filtered-pages" ? [] : [row]), isDone: false, continueCursor: "next" };
      else result = page(this.empty ? [] : [
        ...(args.kind === "live" && row.liveObservedAt === null ? [] : [row]),
        ...(this.addedObservation !== null ? [added] : []),
      ]);
    }
    else if (name === "clubAnalytics:getInstance") result = row;
    else if (name === "clubAnalytics:getInstanceSeries") result = page([
      { at: row.openedAt, value: 50, coverage: "observed" },
      { at: SERVER_START, value: 100, coverage: "observed" },
    ]);
    else if (name === "clubAnalytics:getInstanceSummaryPage") {
      const duration = Number(args.endAt) - Number(args.startAt);
      result = page([{ peak: 100, area: 75 * duration, observedDuration: duration, first: null, last: null }]);
    } else if (name === "clubProviderReads:context") result = { enabledFeatures: ["instances"], permittedProviderRoleIds: [], protectedUserIds: [] };
    else if (name === "clubProviderReads:listEvents") result = page([]);
    else if (name === "communityTelemetry:getInstanceEventAssociation") result = null;
    else throw new Error(`Unmocked session query ${name}`);
    this.cache.set(key, result);
    return result;
  }
  override watchQuery<Query extends FunctionReference<"query">>(query: Query, ...args: ArgsAndOptions<Query, WatchQueryOptions>): Watch<FunctionReturnType<Query>> {
    return {
      onUpdate: callback => { this.callbacks.add(callback); return () => this.callbacks.delete(callback); },
      localQueryResult: () => this.result(getFunctionName(query), args[0] ?? {}) as FunctionReturnType<Query>,
      journal: () => undefined,
    };
  }
  override async mutation<Mutation extends FunctionReference<"mutation">>(mutation: Mutation, ...args: ArgsAndOptions<Mutation, MutationOptions<FunctionArgs<Mutation>>>): Promise<FunctionReturnType<Mutation>> {
    if (getFunctionName(mutation) !== "clubOperations:enqueue") throw new Error("Unexpected session mutation");
    this.record(args[0]);
    return ["queued"] as FunctionReturnType<Mutation>;
  }
}
function SessionFixture({ mode = "owner", variant = "normal" }: { mode?: "owner" | "staff" | "history"; variant?: string }) {
  const [submissions, setSubmissions] = useState<unknown[]>([]);
  const [client] = useState(() => new SessionFixtureClient(value => setSubmissions(previous => [...previous, value]), variant));
  const [mount, setMount] = useState(0);
  const [detail, setDetail] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [attempts, setAttempts] = useState<ReturnType<SessionFixtureClient["attempts"]> | null>(null);
  const data: WorkspaceData = {
    community: { _id: "club-one" as Id<"profiles">, slug: "afterhours", displayName: "Afterhours" },
    actor: { kind: mode === "owner" && !revoked ? "owner" : "staff", roleIds: [], permissions: mode !== "history" && !revoked ? ["manage_instances"] : [] },
    roles: [], assignments: [], hasMoreAssignments: false, invitations: [], actionLog: [], visibility: null,
    integration: null, connectionState: "active", readableCategories: ["instance_history"],
  };
  return <ConvexProvider client={client}>
    <div className="mx-auto max-w-6xl p-5">
      <div className="mb-4 flex flex-wrap gap-2">
        {["Reactive evaluation", "Replace observation", "Disconnect", "Hold evaluations", "Release evaluations", "Add fresh row"].map(mode => <Button key={mode} onClick={() => client.update(mode)}>{mode}</Button>)}
        <Button onClick={() => setMount(value => value + 1)}>Remount owner</Button>
        <Button onClick={() => setDetail(true)}>Open detail</Button>
        <Button onClick={() => setRevoked(true)}>Revoke management</Button>
        <Button onClick={() => setAttempts(client.attempts())}>Inspect attempts</Button>
      </div>
      <ClubWorkspaceView data={data} pathname="/account/communities/afterhours/instances">
        <div key={mount} className="grid gap-6">
          {detail ? <ClubInstanceDetail communitySlug="afterhours" sessionId="session-one" onBack={() => setDetail(false)} /> : <>
            <Card padding="lg" aria-label="Telemetry live"><SectionTitle>Live instances</SectionTitle><ClubInstanceList communitySlug="afterhours" kind="live" onSelect={() => setDetail(true)} /></Card>
            <Card padding="lg" aria-label="Complete history"><SectionTitle>Instance history</SectionTitle><ClubInstanceList communitySlug="afterhours" kind="history" onSelect={() => setDetail(true)} /></Card>
          </>}
        </div>
      </ClubWorkspaceView>
      <output data-testid="session-submissions">{JSON.stringify(submissions)}</output>
      <output data-testid="session-attempts">{JSON.stringify(attempts)}</output>
    </div>
  </ConvexProvider>;
}
const meta = { title: "Clubs/Instance freshness", parameters: { layout: "fullscreen", nextjs: { appDirectory: true } } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Owner: Story = { render: () => <SessionFixture /> };
export const Staff: Story = { render: () => <SessionFixture mode="staff" /> };
export const HistoryOnly: Story = { render: () => <SessionFixture mode="history" /> };
export const Empty: Story = { render: () => <SessionFixture variant="empty" /> };
export const Paginated: Story = { render: () => <SessionFixture variant="paginated" /> };
export const FilteredPages: Story = { render: () => <SessionFixture variant="filtered-pages" /> };
export const DelayedClock: Story = { render: () => <SessionFixture variant="delayed-clock" /> };
