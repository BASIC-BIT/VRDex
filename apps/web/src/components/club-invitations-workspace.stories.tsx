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
import { ClubInvitationBatches } from "@/app/account/communities/[slug]/club-invitation-batches";
import {
  ClubWorkspaceView,
  type WorkspaceData,
} from "@/app/account/communities/[slug]/club-workspace";
import type { Id } from "../../../../convex/_generated/dataModel";
const alice = "usr_11111111-1111-1111-1111-111111111111";
const bob = "usr_22222222-2222-2222-2222-222222222222";
class InvitationFixtureClient extends ConvexReactClient {
  private reads = new Map<string, Record<string, unknown>>();
  private cache = new Map<string, unknown>();
  private fixtureListeners = new Set<() => void>();
  private lists = [
    {
      _id: "list-one",
      name: "Friday guests",
      recipients: [alice, bob],
      revision: 1,
    },
  ];
  private batches: {
    id: string;
    createdAt: number;
    recipientCount: number;
    destinationKind: string;
  }[] = [];
  private outcomes = new Map<
    string,
    {
      userId: string;
      reviewedUserId: string;
      operationId: string;
      state: string;
      code: string | null;
      dueAt: number;
    }[]
  >();
  constructor() {
    super("https://fixture.invalid");
  }
  result(name: string, args: Record<string, unknown>) {
    const key = JSON.stringify([name, args]);
    if (this.cache.has(key)) return this.cache.get(key);
    let result: unknown;
    if (name === "clubProviderReads:context")
      result = {
        enabledFeatures: ["membership_management", "instances"],
        permittedProviderRoleIds: [],
        protectedUserIds: [],
        assignedBot: {
          userId: alice,
          profileUrl: `https://vrchat.com/home/user/${alice}`,
        },
      };
    else if (name === "clubInvitations:lists")
      result = { page: this.lists, isDone: true, continueCursor: "" };
    else if (name === "clubInvitations:batches")
      result = { page: this.batches, isDone: true, continueCursor: "" };
    else if (name === "clubInvitations:outcomes")
      result = {
        recipients: this.outcomes.get(String(args.batchId)) ?? [],
        canCancel: true,
      };
    else if (
      name === "clubOperations:list" ||
      name === "clubProviderReads:listEvents"
    )
      result = { page: [], isDone: true, continueCursor: "" };
    else if (
      name === "clubProviderReads:get" &&
      this.reads.get(String(args.requestId))?.kind === "invitation_eligibility"
    ) {
      const request = this.reads.get(String(args.requestId))!;
      result = {
        state: "succeeded",
        result: {
          items: [
            {
              id: request.userId,
              userId: request.userId,
              friendship: request.userId === alice ? "friend" : "not_friend",
              destinationState: request.worldId ? "open" : "pending",
              invitationEligibility:
                request.userId !== alice
                  ? "not_friend"
                  : request.worldId
                    ? "eligible"
                    : "destination_pending",
            },
          ],
          nextOffset: null,
          observedAt: Date.now(),
        },
        errorCode: null,
      };
    } else if (name === "clubProviderReads:get")
      result = {
        state: "succeeded",
        result: {
          items: [
            {
              id: "instance-one",
              name: "Observatory",
              worldId: "wrld_33333333-3333-3333-3333-333333333333",
              instanceId: "123~group(grp_44444444-4444-4444-4444-444444444444)",
            },
          ],
          nextOffset: null,
          observedAt: Date.now(),
        },
        errorCode: null,
      };
    else if (name === "clubInvitations:preview") {
      const recipients = args.recipients as string[];
      const unique = [...new Set(recipients)];
      result = {
        recipients: unique,
        removedDuplicates: recipients.length - unique.length,
      };
    } else throw new Error(`Unmocked invitation query: ${name}`);
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
  override async query<Query extends FunctionReference<"query">>(
    query: Query,
    ...args: ArgsAndOptions<Query, object>
  ): Promise<FunctionReturnType<Query>> {
    return this.result(
      getFunctionName(query),
      args[0] ?? {},
    ) as FunctionReturnType<Query>;
  }
  override async mutation<Mutation extends FunctionReference<"mutation">>(
    mutation: Mutation,
    ...args: ArgsAndOptions<Mutation, MutationOptions<FunctionArgs<Mutation>>>
  ): Promise<FunctionReturnType<Mutation>> {
    const name = getFunctionName(mutation),
      value = args[0] as Record<string, unknown>;
    let result: unknown = null;
    if (name === "clubProviderReads:request") {
      const params = value.params as Record<string, unknown>;
      const id = `read-${params.kind}-${params.userId ?? "instances"}`;
      this.reads.set(id, params);
      result = id;
    } else if (name === "clubInvitations:saveList") {
      const prior = this.lists.find((list) => list._id === value.listId);
      const list = {
        _id: prior?._id ?? `list-${this.lists.length + 1}`,
        name: String(value.name),
        recipients: value.recipients as string[],
        revision: (prior?.revision ?? 0) + 1,
      };
      this.lists = [
        ...this.lists.filter((item) => item._id !== list._id),
        list,
      ];
      result = list._id;
    } else if (name === "clubInvitations:removeList")
      this.lists = this.lists.filter((list) => list._id !== value.listId);
    else if (name === "clubInvitations:enqueue") {
      const recipients = value.reviewedRecipients as string[];
      const id = `batch-${this.batches.length + 1}`;
      this.batches = [
        {
          id,
          createdAt: Date.now(),
          recipientCount: recipients.length,
          destinationKind: (value.destination as { kind: string }).kind,
        },
        ...this.batches,
      ];
      this.outcomes.set(
        id,
        recipients.map((userId, index) => ({
          userId,
          reviewedUserId: userId,
          operationId: `op-${index}`,
          state: index === 0 ? "submitted" : "pending",
          code: null,
          dueAt: Date.now(),
        })),
      );
      result = id;
    } else if (name === "clubInvitations:cancel") {
      const id = String(value.batchId);
      this.outcomes.set(
        id,
        (this.outcomes.get(id) ?? []).map((item) =>
          item.state === "pending" ? { ...item, state: "cancelled" } : item,
        ),
      );
    } else throw new Error(`Unmocked invitation mutation: ${name}`);
    this.cache.clear();
    this.fixtureListeners.forEach((listener) => listener());
    return result as FunctionReturnType<Mutation>;
  }
}
function Workspace() {
  const [client] = useState(() => new InvitationFixtureClient());
  const data: WorkspaceData = {
    community: {
      _id: "club-one" as Id<"profiles">,
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
    readableCategories: [],
  };
  return (
    <ConvexProvider client={client}>
      <div className="mx-auto max-w-6xl p-5">
        <ClubWorkspaceView
          data={data}
          pathname="/account/communities/afterhours/invitations"
        >
          <ClubInvitationBatches />
        </ClubWorkspaceView>
      </div>
    </ConvexProvider>
  );
}
const meta = {
  title: "Clubs/Invitations workspace",
  component: Workspace,
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
} satisfies Meta<typeof Workspace>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Owner: Story = {};
