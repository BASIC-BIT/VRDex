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
  type FunctionReference,
  type FunctionReturnType,
  type FunctionArgs,
  type ArgsAndOptions,
} from "convex/server";
import { ClubScheduled } from "@/app/account/communities/[slug]/club-scheduled";
import {
  ClubWorkspaceView,
  type WorkspaceData,
} from "@/app/account/communities/[slug]/club-workspace";
import { PageContainer, PageShell } from "@/components/ui/page-shell";
import type { Id } from "../../../../convex/_generated/dataModel";

const subject = (token: string) => ({
  tokenIdentifier: token,
  subject: token,
  issuer: "fixture",
  displayName: token === "fixture" ? "Riley" : "Morgan",
});
class ScheduledFixtureClient extends ConvexReactClient {
  private readonly fixtureListeners = new Set<() => void>();
  private readonly cache = new Map<string, unknown>();
  private eventStartAt = Date.now() + 86400_000;
  private jobs = (
    ["pending", "pending", "indeterminate", "missed"] as const
  ).map((state, index) => ({
    id: `fixture-operation-${index}`,
    payload: {
      kind: "publish_post",
      title: ["Doors open", "Tomorrow night", "Last call", "Afterhours recap"][
        index
      ],
      text: "Friday at Afterhours",
      visibility: "group",
      sendNotification: false,
    },
    schedule: { kind: "fixed", dueAt: Date.now() + 86400_000 },
    dueAt: Date.now() + 86400_000,
    actor: subject(index === 0 ? "fixture" : "other"),
    batchId: `batch-${index}`,
    revision: 1,
    state: state as string,
    code: null,
  }));
  private notifications = [
    {
      id: "fixture-notification",
      kind: "publish_post",
      outcome: "indeterminate",
      read: false,
    },
  ];
  constructor(
    private readonly pagedNotifications = false,
    immediate = false,
    private readonly clockAhead = false,
    private readonly roleEdit = false,
    private readonly onRoleSubmitted: (roleId: string) => void = () => undefined,
  ) {
    super("https://fixture.invalid");
    if (immediate)
      Object.assign(this.jobs[0], {
        schedule: { kind: "immediate" },
        dueAt: Date.now(),
      });
    if (roleEdit)
      Object.assign(this.jobs[0], {
        payload: {
          kind: "assign_role",
          targetUserId: "usr_00000000-0000-0000-0000-000000000001",
          roleId: "grol_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        },
      });
  }
  simulateOtherEditor() {
    this.jobs = this.jobs.map((job, index) =>
      index === 0
        ? {
            ...job,
            revision: job.revision + 1,
            payload: { ...job.payload, title: "Updated by Morgan" },
          }
        : job,
    );
    this.cache.clear();
    this.fixtureListeners.forEach((callback) => callback());
  }
  simulateEventMove() {
    // Keep the subscribed picker snapshot unchanged to model a move during submit.
    this.eventStartAt += 86400_000;
  }
  private result(name: string, args?: unknown) {
    const key = name + JSON.stringify(args);
    if (this.cache.has(key)) return this.cache.get(key);
    let result: unknown;
    if (name === "clubOperations:list")
      result = { page: this.jobs, isDone: true, continueCursor: "" };
    else if (name === "clubProviderReads:context")
      result = { permittedProviderRoleIds: ["grol_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"] };
    else if (name === "clubProviderReads:get")
      result = {
        state: "succeeded",
        result: {
          items: [{ id: "grol_AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA", name: "DJ" }],
          nextOffset: null,
          observedAt: Date.now(),
        },
        errorCode: null,
        fresh: true,
        remainingFreshMs: 60_000,
      };
    else if (name === "clubProviderReads:listEvents")
      result = {
        page: [
          {
            id: "fixture-event",
            title: "Afterhours Friday",
            startAt: this.eventStartAt,
            status: "scheduled",
          },
        ],
        isDone: true,
        continueCursor: "",
      };
    else if (name === "clubNotifications:list") {
      const cursor = (args as { paginationOpts?: { cursor?: string } })
        ?.paginationOpts?.cursor;
      result =
        this.pagedNotifications && cursor !== "older-notifications-2"
          ? {
              page: [],
              isDone: false,
              continueCursor: cursor
                ? "older-notifications-2"
                : "older-notifications-1",
            }
          : { page: this.notifications, isDone: true, continueCursor: "" };
    } else throw new Error(`Unmocked ${name}`);
    this.cache.set(key, result);
    return result;
  }
  override watchQuery<Query extends FunctionReference<"query">>(
    query: Query,
    ..._args: ArgsAndOptions<Query, WatchQueryOptions>
  ): Watch<FunctionReturnType<Query>> {
    void _args;
    return {
      onUpdate: (callback) => {
        this.fixtureListeners.add(callback);
        return () => this.fixtureListeners.delete(callback);
      },
      localQueryResult: () =>
        this.result(
          getFunctionName(query),
          _args[0],
        ) as FunctionReturnType<Query>,
      journal: () => undefined,
    };
  }
  override async query<Query extends FunctionReference<"query">>(
    query: Query,
    ..._args: ArgsAndOptions<Query, object>
  ): Promise<FunctionReturnType<Query>> {
    void _args;
    if (getFunctionName(query) !== "clubOperations:getScheduleClock")
      throw new Error(`Unmocked query ${getFunctionName(query)}`);
    return (Date.now() + (this.clockAhead ? 2 * 86400_000 : 0)) as FunctionReturnType<Query>;
  }
  override async mutation<Mutation extends FunctionReference<"mutation">>(
    mutation: Mutation,
    ...args: ArgsAndOptions<Mutation, MutationOptions<FunctionArgs<Mutation>>>
  ): Promise<FunctionReturnType<Mutation>> {
    const name = getFunctionName(mutation);
    const value = args[0] as Record<string, unknown>;
    if (name === "clubProviderReads:request")
      return "fixture-role-read" as FunctionReturnType<Mutation>;
    if (name === "clubOperations:edit") {
      if (this.roleEdit && typeof (value.payload as { roleId?: unknown }).roleId === "string")
        this.onRoleSubmitted((value.payload as { roleId: string }).roleId);
      const job = this.jobs.find((job) => job.id === value.operationId);
      if (job) {
        if (job.revision !== value.expectedRevision)
          throw new Error("Refresh to continue.");
        const schedule = value.schedule as { kind: string; offsetMs?: number };
        if (schedule.kind === "event_relative" &&
            value.reviewedDueAt !== this.eventStartAt + (schedule.offsetMs ?? 0))
          throw new Error("Refresh to continue.");
        Object.assign(job, {
          revision: job.revision + 1,
          payload: value.payload,
          schedule: value.schedule,
          actor: subject("fixture"),
        });
      }
    } else if (name === "clubOperations:cancel") {
      const job = this.jobs.find((job) => job.id === value.operationId);
      if (job) job.state = "cancelled";
    } else if (name === "clubNotifications:markRead")
      this.notifications = this.notifications.map((item) => ({
        ...item,
        read: true,
      }));
    else throw new Error(`Unmocked mutation ${name}`);
    this.cache.clear();
    this.fixtureListeners.forEach((callback) => callback());
    return null as FunctionReturnType<Mutation>;
  }
}
function ScheduledFixture({
  staff = false,
  pagedNotifications = false,
  immediate = false,
  conflict = false,
  clockAhead = false,
  mutableEvent = false,
  roleEdit = false,
}: {
  staff?: boolean;
  pagedNotifications?: boolean;
  immediate?: boolean;
  conflict?: boolean;
  clockAhead?: boolean;
  mutableEvent?: boolean;
  roleEdit?: boolean;
}) {
  const [submittedRoleId, setSubmittedRoleId] = useState("");
  const [client] = useState(
    () => new ScheduledFixtureClient(pagedNotifications, immediate, clockAhead, roleEdit, setSubmittedRoleId),
  );
  const data: WorkspaceData = {
    community: {
      _id: "fixture-club" as Id<"profiles">,
      slug: "afterhours",
      displayName: "Afterhours",
    },
    actor: {
      kind: staff || roleEdit ? "staff" : "owner",
      subject: subject("fixture"),
      roleIds: [],
      permissions: roleEdit ? ["assign_vrchat_roles"] : staff ? ["publish_posts"] : [],
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
          <ClubWorkspaceView
            data={data}
            pathname="/account/communities/afterhours/scheduled"
          >
            {conflict ? (
              <button onClick={() => client.simulateOtherEditor()}>
                Simulate other editor
              </button>
            ) : null}
            {mutableEvent ? (
              <button onClick={() => client.simulateEventMove()}>
                Move event during submit
              </button>
            ) : null}
            {roleEdit ? <output aria-label="Submitted role ID">{submittedRoleId || "none"}</output> : null}
            <ClubScheduled />
          </ClubWorkspaceView>
        </PageContainer>
      </PageShell>
    </ConvexProvider>
  );
}
const meta = {
  title: "Clubs/Scheduled",
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Owner: Story = { render: () => <ScheduledFixture /> };
export const Staff: Story = { render: () => <ScheduledFixture staff /> };
export const OlderNotifications: Story = {
  render: () => <ScheduledFixture pagedNotifications />,
};

export const Immediate: Story = {
  render: () => <ScheduledFixture immediate />,
};

export const ConcurrentEdit: Story = {
  render: () => <ScheduledFixture conflict />,
};
export const ClockAhead: Story = {
  render: () => <ScheduledFixture clockAhead />,
};
export const MovedEvent: Story = {
  render: () => <ScheduledFixture mutableEvent />,
};
export const MixedCaseRoleEdit: Story = {
  render: () => <ScheduledFixture roleEdit />,
};
