import type { Meta, StoryObj } from "@storybook/nextjs-vite";
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
import { ClubPosts } from "@/app/account/communities/[slug]/club-posts";
import {
  ClubWorkspaceView,
  type WorkspaceData,
} from "@/app/account/communities/[slug]/club-workspace";
import type { Id } from "../../../../convex/_generated/dataModel";
type FixtureDraft = {
  id: string;
  content: Record<string, unknown>;
  revision: number;
  operationId: string | null;
  operationState: string | null;
  queuedRevision: number | null;
  updatedAt: number;
};
class PostsFixtureClient extends ConvexReactClient {
  private cache = new Map<string, unknown>();
  private fixtureListeners = new Set<() => void>();
  private drafts: FixtureDraft[] = [];
  private lostQueueResponse = false;
  constructor(private readonly loseQueueResponse = false) {
    super("https://fixture.invalid");
  }
  result(name: string, args: Record<string, unknown>) {
    const key = JSON.stringify([name, args]);
    if (this.cache.has(key)) return this.cache.get(key);
    let result: unknown;
    if (name === "clubProviderReads:context")
      result = {
        enabledFeatures: ["posts"],
        permittedProviderRoleIds: [],
        protectedUserIds: [],
      };
    else if (name === "clubProviderReads:listEvents")
      result = { page: [], isDone: true, continueCursor: "" };
    else if (name === "clubPosts:list")
      result = { page: this.drafts, isDone: true, continueCursor: "" };
    else if (name === "clubProviderReads:get")
      result = {
        state: "succeeded",
        fresh: true,
        remainingFreshMs: 60_000,
        errorCode: null,
        result: {
          items: [
            {
              id: "not_11111111-1111-1111-1111-111111111111",
              title: "Welcome to Afterhours",
              text: "Our next gathering is Friday.",
              visibility: "group",
            },
          ],
          nextOffset: null,
          observedAt: Date.now(),
        },
      };
    else throw new Error(`Unmocked Posts query ${name}`);
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
    const value = args[0] as Record<string, unknown>,
      name = getFunctionName(mutation);
    let result: unknown = null;
    if (name === "clubProviderReads:request") result = "read-posts";
    else if (name === "clubPosts:save") {
      const existing = this.drafts.find((d) => d.id === value.draftId);
      if (existing?.operationId)
        throw new Error(
          "This draft has been queued. Manage its scheduled action instead.",
        );
      const d: FixtureDraft = {
        id: existing?.id ?? `draft-${this.drafts.length}`,
        content: value.content as Record<string, unknown>,
        revision: (existing?.revision ?? 0) + 1,
        operationId: null,
        operationState: null,
        queuedRevision: null,
        updatedAt: Date.now(),
      };
      this.drafts = [d, ...this.drafts.filter((old) => old.id !== d.id)];
      result = d;
    } else if (name === "clubPosts:queue") {
      if ((value.schedule as { kind: string }).kind !== "immediate")
        throw new Error("Expected immediate schedule");
      const draft = this.drafts.find((d) => d.id === value.draftId);
      if (draft?.revision !== value.expectedRevision)
        throw new Error("Draft revision changed");
      this.drafts = this.drafts.map((d) =>
        d.id === value.draftId
          ? {
              ...d,
              operationId: "operation-post",
              operationState: "pending",
              queuedRevision: d.revision,
            }
          : d,
      );
      result = "operation-post";
      if (this.loseQueueResponse && !this.lostQueueResponse) {
        this.lostQueueResponse = true;
        throw new Error("Queue response lost");
      }
    } else if (name === "clubPosts:remove")
      this.drafts = this.drafts.filter((d) => d.id !== value.draftId);
    else if (name === "clubOperations:enqueue") {
      if ((value.schedule as { kind: string }).kind !== "immediate")
        throw new Error("Expected immediate schedule");
      result = ["operation-delete"];
    } else throw new Error(`Unmocked Posts mutation ${name}`);
    this.cache.clear();
    this.fixtureListeners.forEach((callback) => callback());
    return result as FunctionReturnType<Mutation>;
  }
}
function Workspace({
  loseQueueResponse = false,
}: {
  loseQueueResponse?: boolean;
}) {
  const [client] = useState(() => new PostsFixtureClient(loseQueueResponse));
  const data: WorkspaceData = {
    community: {
      _id: "fixture-club" as Id<"profiles">,
      slug: "afterhours",
      displayName: "Afterhours",
    },
    actor: { kind: "owner", roleIds: [], permissions: [] },
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
      <div className="mx-auto max-w-6xl p-5">
        <ClubWorkspaceView
          data={data}
          pathname="/account/communities/afterhours/posts"
        >
          <ClubPosts />
        </ClubWorkspaceView>
      </div>
    </ConvexProvider>
  );
}
const meta = {
  title: "Clubs/Posts workspace",
  component: Workspace,
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
} satisfies Meta<typeof Workspace>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Owner: Story = {};

export const LostQueueResponse: Story = { args: { loseQueueResponse: true } };
