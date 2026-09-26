import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { ClubConnectionView } from "@/app/account/communities/[slug]/club-connection";
import {
  ClubConnectionFeatures,
  type ConnectionFeatures,
} from "@/app/account/communities/[slug]/club-connection-features";
import { useState } from "react";
import {
  CommunityTelemetryDashboard,
  type TelemetryDashboardData,
} from "@/app/account/communities/[slug]/telemetry/community-telemetry-dashboard";
import { ClubStaffView } from "@/app/account/communities/[slug]/club-staff";
import { ClubVisibilityView } from "@/app/account/communities/[slug]/club-visibility";
import {
  ClubWorkspaceView,
  type WorkspaceData,
} from "@/app/account/communities/[slug]/club-workspace";
import { PageContainer, PageShell } from "@/components/ui/page-shell";
import type { Id } from "../../../../convex/_generated/dataModel";

const moderatorId = "fixture-moderator" as Id<"communityRoles">;
const adminId = "fixture-admin" as Id<"communityRoles">;
const subject = {
  tokenIdentifier: "fixture-owner",
  subject: "owner",
  issuer: "fixture",
  displayName: "Club owner",
};
const now = Date.UTC(2026, 8, 12, 21);
const staffVisibility = { audience: "staff" as const, staffRoleIds: null };
const data: WorkspaceData = {
  community: {
    _id: "fixture-club" as Id<"profiles">,
    slug: "afterhours",
    displayName: "Afterhours",
  },
  actor: { kind: "owner", subject, roleIds: [], permissions: [] },
  roles: [
    {
      _id: adminId,
      _creationTime: now,
      communityProfileId: "fixture-club" as Id<"profiles">,
      key: "admin",
      label: "Admin",
      permissions: ["manage_staff", "manage_integrations", "manage_events"],
      assignableRoleIds: [moderatorId],
      presetKey: "admin",
      state: "active",
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: moderatorId,
      _creationTime: now,
      communityProfileId: "fixture-club" as Id<"profiles">,
      key: "moderator",
      label: "Moderator",
      permissions: ["approve_join_requests", "remove_group_members"],
      assignableRoleIds: [],
      presetKey: "moderator",
      state: "active",
      createdAt: now,
      updatedAt: now,
    },
  ],
  assignments: [
    {
      _id: "fixture-assignment" as Id<"communityAuthorities">,
      _creationTime: now,
      communityProfileId: "fixture-club" as Id<"profiles">,
      subjectTokenIdentifier: "fixture-staff",
      subject: {
        ...subject,
        tokenIdentifier: "fixture-staff",
        subject: "staff",
        displayName: "Riley",
      },
      roleId: adminId,
      state: "active",
      grantedAt: now,
      grantedBySubject: subject,
      updatedAt: now,
    },
  ],
  hasMoreAssignments: false,
  actionLog: [],
  integration: null,
  connectionState: "active",
  readableCategories: [],
  visibility: {
    current_population: staffVisibility,
    population_history: staffVisibility,
    group_size: { audience: "public", staffRoleIds: null },
    instance_history: staffVisibility,
    membership_movement: staffVisibility,
    individual_membership_history: { audience: "owner", staffRoleIds: null },
    event_recaps: staffVisibility,
  },
};

const meta = {
  title: "Clubs/Workspace",
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const noop = async () => undefined;
const fixtureClient = new ConvexReactClient("https://fixture.invalid");
const fixtureAuth = {
  isLoading: false,
  isAuthenticated: false,
  fetchAccessToken: async () => null,
};
function useFixtureAuth() {
  return fixtureAuth;
}
const telemetry: TelemetryDashboardData = {
  community: data.community,
  integration: {
    state: "active",
    freshness: "current",
    lastSuccessfulObservationAt: now,
  },
  summary: {
    currentPopulation: 72,
    activeInstanceCount: 2,
    peakConcurrency: 124,
    playerHours: 482,
    coverageRatio: 0.99,
    groupMemberCount: 2430,
    groupMemberGrowth: 24,
    worlds: [],
  },
  population: Array.from({ length: 24 }, (_, index) => ({
    observedAt: now - (23 - index) * 5 * 60_000,
    totalPopulation: 45 + Math.round(30 * Math.sin(index / 5) ** 2),
    activeInstanceCount: 2,
    coverageState: "observed",
  })),
  instancePopulation: [],
  memberCounts: [
    { observedAt: now - 3600_000, memberCount: 2406 },
    { observedAt: now, memberCount: 2430 },
  ],
  rollups: [],
  coverage: [],
  sessions: [],
  associations: [],
  events: [],
};

export const Home: Story = {
  render: () => (
    <ConvexProviderWithAuth client={fixtureClient} useAuth={useFixtureAuth}>
      <PageShell>
        <PageContainer max="7xl">
          <ClubWorkspaceView
            data={data}
            pathname="/account/communities/afterhours"
          >
            <CommunityTelemetryDashboard
              communitySlug="afterhours"
              fixtureData={telemetry}
              canManageIntegrations
              canManageEvents
            />
          </ClubWorkspaceView>
        </PageContainer>
      </PageShell>
    </ConvexProviderWithAuth>
  ),
};
export const Connection: Story = {
  render: () => (
    <PageShell>
      <PageContainer max="7xl">
        <ClubWorkspaceView
          data={{ ...data, connectionState: null }}
          pathname="/account/communities/afterhours/connection"
        >
          <ClubConnectionView data={data} connect={noop} disconnect={noop} />
        </ClubWorkspaceView>
      </PageContainer>
    </PageShell>
  ),
};

function ReconnectFixture() {
  const [submitted, setSubmitted] = useState("");
  const disconnected: WorkspaceData = {
    ...data,
    connectionState: "disconnected",
    integration: {
      _id: "fixture-integration" as Id<"communityVrchatIntegrations">,
      _creationTime: now,
      communityProfileId: data.community._id,
      vrchatGroupId: "grp_saved",
      collector: null,
      groupVisibility: "public",
      joinPolicy: "free",
      state: "disconnected",
      killSwitchEnabled: false,
      requestsPerMinute: 10,
      leaseGeneration: 1,
      publicMetrics: {
        currentPopulation: false,
        populationHistory: false,
        groupMemberCount: false,
        groupMemberGrowth: false,
        eventRecaps: false,
      },
      consecutiveFailures: 0,
      createdAt: now,
      updatedAt: now,
    },
  };
  return (
    <>
      <ClubConnectionView
        data={disconnected}
        connect={async (input) => { setSubmitted(JSON.stringify(input)); }}
        disconnect={noop}
      />
      <output aria-label="Submitted connection">{submitted}</output>
    </>
  );
}
export const Reconnect: Story = { render: () => <ReconnectFixture /> };

function ConnectionFeatureFixture({
  staff = false,
  expired = false,
  staleRole = false,
}: {
  staff?: boolean;
  expired?: boolean;
  staleRole?: boolean;
}) {
  const [connection, setConnection] = useState<ConnectionFeatures>(() => ({
    now: Date.now(),
    integrationId: "fixture-integration" as Id<"communityVrchatIntegrations">,
    enabledFeatures: [
      "analytics",
      "membership_management",
      "posts",
      "instances",
    ],
    authority: {
      groupId: "grp_fixture",
      userId: "usr_fixture",
      membershipStatus: "member",
      permissions: ["group-members-manage", "group-instance-open-create"],
      observedAt: Date.now() - (expired ? 61_000 : 0),
    },
    features: [
      {
        feature: "analytics",
        enabled: true,
        ready: true,
        missingPermissions: [],
      },
      {
        feature: "membership_management",
        enabled: true,
        ready: true,
        missingPermissions: [],
      },
      {
        feature: "posts",
        enabled: true,
        ready: false,
        missingPermissions: ["group-announcement-manage"],
      },
      {
        feature: "instances",
        enabled: true,
        ready: true,
        missingPermissions: [],
      },
    ],
    roles: [
      { roleId: adminId, label: "Admin", providerRoleIds: staleRole ? ["grol_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"] : [], updatedAt: now },
      { roleId: moderatorId, label: "Moderator", providerRoleIds: [], updatedAt: now },
    ],
  }));
  const [submittedRoleToken, setSubmittedRoleToken] = useState<number | null>(null);
  const viewData: WorkspaceData = staff
    ? {
        ...data,
        actor: {
          ...data.actor,
          kind: "staff",
          permissions: ["manage_integrations"],
        },
      }
    : data;
  return (
    <PageShell>
      <PageContainer max="7xl">
        <ClubWorkspaceView
          data={viewData}
          pathname="/account/communities/afterhours/connection"
        >
          <div className="grid gap-6">
            <h1 className="text-3xl font-semibold">Group connection</h1>
            {staleRole ? <>
              <button type="button" onClick={() => setConnection(previous => ({
                ...previous,
                roles: previous.roles.map(role => role.roleId === adminId ? {
                  ...role, providerRoleIds: [], updatedAt: role.updatedAt + 1,
                } : role),
              }))}>Simulate other tab</button>
              <output aria-label="Stored provider roles">{connection.roles[0]?.providerRoleIds.join(", ")}</output>
              <output aria-label="Submitted role token">{submittedRoleToken ?? "none"}</output>
            </> : null}
            <ClubConnectionFeatures
              data={viewData}
              connection={connection}
              authorityFresh={!expired}
              actions={{
                setFeatures: async (args) => {
                  setConnection((previous) => ({
                    ...previous,
                    enabledFeatures: args.enabledFeatures,
                    features: previous.features.map((feature) => ({
                      ...feature,
                      enabled: args.enabledFeatures.includes(feature.feature),
                    })),
                  }));
                },
                setRoles: async (args) => {
                  setSubmittedRoleToken(args.expectedUpdatedAt);
                  const currentRole = connection.roles.find(role => role.roleId === args.roleId);
                  if (staleRole && args.expectedUpdatedAt !== currentRole?.updatedAt)
                    throw new Error("Refresh to continue.");
                  const updatedAt = args.expectedUpdatedAt + 1;
                  setConnection((previous) => ({
                    ...previous,
                    roles: previous.roles.map((role) =>
                      role.roleId === args.roleId
                        ? { ...role, providerRoleIds: args.providerRoleIds, updatedAt }
                        : role,
                    ),
                  }));
                  return updatedAt;
                },
              }}
            />
          </div>
        </ClubWorkspaceView>
      </PageContainer>
    </PageShell>
  );
}
export const ConnectionFeaturesOwner: Story = {
  render: () => <ConnectionFeatureFixture />,
};
export const ConnectionFeaturesStaff: Story = {
  render: () => <ConnectionFeatureFixture staff />,
};
export const ConnectionFeaturesExpired: Story = {
  render: () => <ConnectionFeatureFixture expired />,
};
export const ConnectionFeaturesStaleRole: Story = {
  render: () => <ConnectionFeatureFixture staleRole />,
};

export const Staff: Story = {
  render: () => (
    <PageShell>
      <PageContainer max="7xl">
        <ClubWorkspaceView
          data={data}
          pathname="/account/communities/afterhours/staff"
        >
          <ClubStaffView
            data={data}
            invitations={{ results: [], status: "Exhausted", loadMore: () => undefined }}
            actions={{
              seed: noop,
              save: noop,
              delete: async () => ["population_history"],
              invite: async () => ({ token: "fixture-invitation" }),
              revokeInvite: noop,
              revokeAssignment: noop,
            }}
          />
        </ClubWorkspaceView>
      </PageContainer>
    </PageShell>
  ),
};
function StaffStaleRoleFixture({ deleting = false }: { deleting?: boolean }) {
  const [workspace, setWorkspace] = useState<WorkspaceData>(data);
  const [submittedToken, setSubmittedToken] = useState<number | null>(null);
  const [submittedDeletionToken, setSubmittedDeletionToken] = useState<number | null>(null);
  const role = workspace.roles[0]!;
  return (
    <PageShell><PageContainer max="7xl">
      <button type="button" onClick={() => setWorkspace(previous => ({
        ...previous,
        roles: previous.roles.map(item => item._id === adminId ? {
          ...item,
          permissions: item.permissions.filter(permission => permission !== "manage_staff"),
          assignableRoleIds: [],
          updatedAt: item.updatedAt + 1,
        } : item),
      }))}>Simulate other tab</button>
      <output aria-label="Stored role permissions">{role.permissions.join(", ")}</output>
      <output aria-label="Submitted role token">{submittedToken ?? "none"}</output>
      {deleting ? <output aria-label="Submitted deletion token">{submittedDeletionToken ?? "none"}</output> : null}
      <ClubWorkspaceView data={workspace} pathname="/account/communities/afterhours/staff">
        <ClubStaffView
          data={workspace}
          invitations={{ results: [], status: "Exhausted", loadMore: () => undefined }}
          actions={{
            seed: noop,
            save: async input => {
              setSubmittedToken(input.expectedUpdatedAt ?? null);
              if (input.expectedUpdatedAt !== role.updatedAt)
                throw new Error("Refresh to continue.");
            },
            delete: async (_roleId, expectedUpdatedAt) => {
              setSubmittedDeletionToken(expectedUpdatedAt);
              if (expectedUpdatedAt !== role.updatedAt)
                throw new Error("Refresh to continue.");
              return [];
            },
            invite: async () => ({ token: "fixture-invitation" }),
            revokeInvite: noop,
            revokeAssignment: noop,
          }}
        />
      </ClubWorkspaceView>
    </PageContainer></PageShell>
  );
}
export const StaffStaleRole: Story = { render: () => <StaffStaleRoleFixture /> };
export const StaffStaleDeletion: Story = { render: () => <StaffStaleRoleFixture deleting /> };
const staffInvitations = Array.from({ length: 101 }, (_, index) => ({
  _id: `fixture-invite-${index}` as Id<"communityStaffInvitations">,
  roleIds: [adminId],
  createdAt: now - index * 1000,
  expiresAt: Date.now() + 7 * 86400_000,
  state: "pending" as const,
  createdBySubject: subject,
}));
function StaffInvitationsFixture() {
  const [count, setCount] = useState(50);
  return (
    <PageShell><PageContainer max="7xl">
      <ClubWorkspaceView data={data} pathname="/account/communities/afterhours/staff">
        <ClubStaffView
          data={data}
          actions={{ seed: noop, save: noop, delete: async () => [], invite: async () => ({ token: "fixture-invitation" }), revokeInvite: noop, revokeAssignment: noop }}
          invitations={{
            results: staffInvitations.slice(0, count),
            status: count < staffInvitations.length ? "CanLoadMore" : "Exhausted",
            loadMore: (more) => setCount(previous => Math.min(staffInvitations.length, previous + more)),
          }}
        />
      </ClubWorkspaceView>
    </PageContainer></PageShell>
  );
}
export const StaffInvitations: Story = { render: () => <StaffInvitationsFixture /> };
export const Visibility: Story = {
  render: () => (
    <PageShell>
      <PageContainer max="7xl">
        <ClubWorkspaceView
          data={data}
          pathname="/account/communities/afterhours/visibility"
        >
          <ClubVisibilityView data={data} save={noop} />
        </ClubWorkspaceView>
      </PageContainer>
    </PageShell>
  ),
};
