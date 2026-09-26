import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useLayoutEffect, useMemo, useState } from "react";
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
import { ClubMembers } from "@/app/account/communities/[slug]/club-members";
import {
  ClubWorkspaceView,
  type WorkspaceData,
} from "@/app/account/communities/[slug]/club-workspace";
import { PageContainer, PageShell } from "@/components/ui/page-shell";
import { Button } from "@/components/ui/button";
import type { Id } from "../../../../convex/_generated/dataModel";
import type {
  ProviderReadParams,
  ProviderItem,
} from "@/app/account/communities/[slug]/club-provider-read";

const user = (index: number) =>
  `usr_00000000-0000-0000-0000-${String(index).padStart(12, "0")}`;
const djRole = "grol_00000000-0000-0000-0000-000000000001";
const adminRole = "grol_00000000-0000-0000-0000-000000000002";
class MembersFixtureClient extends ConvexReactClient {
  private readonly fixtureListeners = new Set<() => void>();
  private readonly cache = new Map<string, unknown>();
  private readonly requests = new Map<string, ProviderReadParams>();
  private readonly jobs: Array<Record<string, unknown>> = [];
  constructor(
    private readonly staff: boolean,
    private readonly readFailure: boolean,
    private permissions: WorkspaceData["actor"]["permissions"],
  ) {
    super("https://fixture.invalid");
  }
  setPermissions(permissions: WorkspaceData["actor"]["permissions"]) {
    this.permissions = permissions;
  }
  private result(name: string, args: Record<string, unknown>) {
    const key = JSON.stringify([name, args]);
    if (this.cache.has(key)) return this.cache.get(key);
    let result: unknown;
    if (name === "clubProviderReads:context") {
      if (this.staff && this.permissions.length === 0)
        throw new Error("Unauthorized context read");
      result = {
        enabledFeatures: ["membership_management"],
        permittedProviderRoleIds: [djRole],
        protectedUserIds: [user(99)],
        assignedBot: {
          userId: user(99),
          profileUrl: `https://vrchat.com/home/user/${user(99)}`,
        },
      };
    }
    else if (name === "clubOperations:list")
      result = { page: this.jobs, isDone: true, continueCursor: "" };
    else if (name === "clubProviderReads:get") {
      const params = this.requests.get(String(args.requestId));
      if (!params) throw new Error("Missing fixture request");
      let items: ProviderItem[] = [];
      if (params.kind === "roles")
        items = [
          { id: djRole, name: "DJ" },
          { id: adminRole, name: "Group admin" },
        ];
      else if (params.kind === "member")
        items = [
          {
            id: params.userId!,
            userId: params.userId,
            displayName: params.userId === user(99) ? "Club bot" : "Riley",
            roleIds: [djRole],
            joinedAt: "2026-08-01T18:00:00Z",
          },
        ];
      else
        items = (params.offset > 0 ? [4, 5] : [1, 2, 3]).map((id, index) => ({
          id: user(id),
          userId: user(id),
          displayName:
            params.offset > 0
              ? ["Morgan", "Eli"][index]
              : ["Riley", "Nova", "Ash"][index],
          roleIds: [djRole],
          joinedAt: "2026-08-01T18:00:00Z",
        }));
      if (params.kind === "search")
        items = items.filter((item) =>
          item.displayName
            ?.toLowerCase()
            .includes(params.search!.toLowerCase()),
        );
      result = this.readFailure
        ? {
            state: "failed",
            result: null,
            errorCode: "provider_read_failed",
            fresh: false,
            remainingFreshMs: 0,
          }
        : {
            state: "succeeded",
            result: {
              items,
              nextOffset:
                params.kind === "members" && params.offset === 0 ? 25 : null,
              observedAt: Date.now(),
            },
            errorCode: null,
            fresh: true,
            remainingFreshMs: 60_000,
          };
    } else throw new Error(`Unmocked ${name}`);
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
    const value = args[0] as Record<string, unknown>;
    const name = getFunctionName(mutation);
    let result: unknown = null;
    if (name === "clubProviderReads:request") {
      if (
        this.staff &&
        !this.permissions.includes("view_members") &&
        ["members", "search", "member"].includes((value.params as ProviderReadParams).kind)
      ) throw new Error("Unauthorized directory read");
      const id = `fixture-read-${this.requests.size}`;
      this.requests.set(id, value.params as ProviderReadParams);
      result = id;
    } else if (name === "clubOperations:enqueue") {
      if ((value.schedule as {kind: string}).kind !== "immediate") throw new Error("Expected immediate schedule");
      const ids: string[] = [];
      for (const payload of value.payloads as Array<Record<string, unknown>>) {
        const id = `fixture-operation-${this.jobs.length}`;
        ids.push(id);
        this.jobs.unshift({
          id,
          payload,
          schedule: value.schedule,
          dueAt: Date.now(),
          state: "pending",
          actor: {
            tokenIdentifier: "fixture",
            subject: "fixture",
            issuer: "fixture",
          },
          batchId: value.requestId,
          code: null,
        });
      }
      result = ids;
    } else if (name === "clubOperations:cancel") {
      const job = this.jobs.find((job) => job.id === value.operationId);
      if (job) job.state = "cancelled";
    } else throw new Error(`Unmocked mutation ${name}`);
    this.cache.clear();
    this.fixtureListeners.forEach((callback) => callback());
    return result as FunctionReturnType<Mutation>;
  }
}
function MembersFixture({
  staff = false,
  readFailure = false,
  permissions,
  permissionSwitch = false,
}: {
  staff?: boolean;
  readFailure?: boolean;
  permissions?: WorkspaceData["actor"]["permissions"];
  permissionSwitch?: boolean;
}) {
  const [limited, setLimited] = useState(false);
  const actorPermissions = useMemo<WorkspaceData["actor"]["permissions"]>(
    () => permissions ?? (staff
      ? limited ? ["assign_vrchat_roles"] : ["view_members", "assign_vrchat_roles"]
      : []),
    [permissions, staff, limited],
  );
  const [client] = useState(() => new MembersFixtureClient(staff, readFailure, actorPermissions));
  useLayoutEffect(() => client.setPermissions(actorPermissions), [client, actorPermissions]);
  const data: WorkspaceData = {
    community: {
      _id: "fixture-club" as Id<"profiles">,
      slug: "afterhours",
      displayName: "Afterhours",
    },
    actor: {
      kind: staff ? "staff" : "owner",
      roleIds: [],
      permissions: actorPermissions,
    },
    roles: [],
    assignments: [],
    hasMoreAssignments: false,
    actionLog: [],
    visibility: null,
    integration: null,
    connectionState: "active",
    readableCategories: [],
  };
  return (
    <ConvexProvider client={client}>
      <PageShell>
        <PageContainer max="7xl">
          {permissionSwitch ? (
            <Button className="mb-4" onClick={() => setLimited((current) => !current)}>
              Switch permissions
            </Button>
          ) : null}
          <ClubWorkspaceView
            data={data}
            pathname="/account/communities/afterhours/members"
          >
            <ClubMembers />
          </ClubWorkspaceView>
        </PageContainer>
      </PageShell>
    </ConvexProvider>
  );
}
const meta = {
  title: "Clubs/Members",
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Owner: Story = { render: () => <MembersFixture /> };
export const Staff: Story = { render: () => <MembersFixture staff /> };
export const RoleOnly: Story = {
  render: () => <MembersFixture staff permissions={["assign_vrchat_roles"]} />,
};
export const RemoveOnly: Story = {
  render: () => <MembersFixture staff permissions={["remove_group_members"]} />,
};
export const NoAccess: Story = {
  render: () => <MembersFixture staff permissions={[]} />,
};
export const LivePermissions: Story = {
  render: () => <MembersFixture staff permissionSwitch />,
};
export const ReadFailure: Story = {
  render: () => <MembersFixture readFailure />,
};
