import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
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
  type FunctionReference,
  type FunctionArgs,
  type FunctionReturnType,
} from "convex/server";
import { ClubInstances } from "@/app/account/communities/[slug]/club-instances";
import {
  ClubWorkspaceView,
  type WorkspaceData,
} from "@/app/account/communities/[slug]/club-workspace";
import type { Id } from "../../../../convex/_generated/dataModel";

type Mode =
  | "owner"
  | "staff"
  | "denied"
  | "disabled"
  | "read-error"
  | "enqueue-error-once";
// Storybook-only transport. Unexpected calls fail instead of contacting a provider.
class InstanceFixtureClient extends ConvexReactClient {
  private cache = new Map<string, unknown>();
  private reads = new Map<string, { offset: number }>();
  private requestCount = 0;
  private enqueueCount = 0;
  constructor(
    private mode: Mode,
    private record: (value: unknown) => void,
  ) {
    super("https://fixture.invalid");
  }
  private result(name: string, args: Record<string, unknown>) {
    const key = JSON.stringify([name, args]);
    if (this.cache.has(key)) return this.cache.get(key);
    let result: unknown;
    if (this.mode === "denied") throw new Error(`Denied staff queried ${name}`);
    if (name === "clubProviderReads:context")
      result = {
        enabledFeatures: this.mode === "disabled" ? [] : ["instances"],
        permittedProviderRoleIds: [],
        protectedUserIds: [],
      };
    else if (
      name === "clubOperations:list" ||
      name === "clubProviderReads:listEvents" ||
      (name === "clubAnalytics:listInstances" && this.mode === "owner")
    )
      result = { page: [], isDone: true, continueCursor: "" };
    else if (name === "clubProviderReads:get") {
      const read = this.reads.get(String(args.requestId));
      if (!read) throw new Error("Missing live instance request");
      result = {
        state: "succeeded",
        fresh: true,
        remainingFreshMs: 60_000,
        errorCode: null,
        result: {
          items: [
            {
              id: `instance-${read.offset}`,
              name: read.offset === 0 ? "The Observatory" : "Midnight Atrium",
              worldId: "wrld_33333333-3333-3333-3333-333333333333",
              instanceId: `${123 + read.offset}~group(grp_44444444-4444-4444-4444-444444444444)~region(use)`,
            },
          ],
          nextOffset: read.offset === 0 ? 100 : null,
          observedAt: Date.now(),
        },
      };
    } else throw new Error(`Unmocked instance query: ${name}`);
    this.cache.set(key, result);
    return result;
  }
  override watchQuery<Query extends FunctionReference<"query">>(
    query: Query,
    ...args: ArgsAndOptions<Query, WatchQueryOptions>
  ): Watch<FunctionReturnType<Query>> {
    return {
      onUpdate: () => () => {},
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
    const name = getFunctionName(mutation);
    if (this.mode === "denied" || this.mode === "disabled")
      throw new Error(`Unavailable management called ${name}`);
    const value = args[0] as Record<string, unknown>;
    if (name === "clubProviderReads:request") {
      const params = value.params as { kind: string; offset: number };
      if (params.kind !== "instances")
        throw new Error(`Unexpected read ${params.kind}`);
      this.requestCount++;
      if (this.mode === "read-error" && this.requestCount === 1)
        throw new Error("Unable to load data. Try refreshing.");
      const id = `read-${this.requestCount}`;
      this.reads.set(id, params);
      return id as FunctionReturnType<Mutation>;
    }
    if (name === "clubOperations:enqueue") {
      this.record(value);
      this.enqueueCount++;
      if (this.mode === "enqueue-error-once" && this.enqueueCount === 1)
        throw new Error("Ambiguous enqueue failure");
      return ["operation-one"] as FunctionReturnType<Mutation>;
    }
    throw new Error(`Unmocked instance mutation: ${name}`);
  }
}
function Workspace({ mode }: { mode: Mode }) {
  const [submissions, setSubmissions] = useState<unknown[]>([]);
  const [client] = useState(
    () =>
      new InstanceFixtureClient(mode, (value) =>
        setSubmissions((previous) => [...previous, value]),
      ),
  );
  const data: WorkspaceData = {
    community: {
      _id: "club-one" as Id<"profiles">,
      slug: "afterhours",
      displayName: "Afterhours",
    },
    actor: {
      kind: mode === "owner" ? "owner" : "staff",
      roleIds: [],
      permissions: mode === "denied" ? [] : ["manage_instances"],
    },
    roles: [],
    assignments: [],
    hasMoreAssignments: false,
    invitations: [],
    actionLog: [],
    visibility: null,
    integration: null,
    connectionState: "active",
    readableCategories: mode === "owner" ? ["instance_history"] : [],
  };
  return (
    <ConvexProvider client={client}>
      <div className="mx-auto max-w-6xl p-5">
        <ClubWorkspaceView
          data={data}
          pathname="/account/communities/afterhours/instances"
        >
          <ClubInstances />
          <output hidden data-testid="submitted-close">
            {JSON.stringify(submissions.at(-1) ?? null)}
          </output>
          <output hidden data-testid="submitted-close-attempts">
            {JSON.stringify(submissions)}
          </output>
        </ClubWorkspaceView>
      </div>
    </ConvexProvider>
  );
}
const meta = {
  title: "Clubs/Live instance management",
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const OwnerAnalyticsOff: Story = {
  render: () => <Workspace mode="owner" />,
};
export const ManagementOnlyStaff: Story = {
  render: () => <Workspace mode="staff" />,
};
export const DeniedStaff: Story = { render: () => <Workspace mode="denied" /> };
export const InstancesDisabled: Story = {
  render: () => <Workspace mode="disabled" />,
};
export const ReadError: Story = {
  render: () => <Workspace mode="read-error" />,
};
export const EnqueueErrorOnce: Story = {
  render: () => <Workspace mode="enqueue-error-once" />,
};
