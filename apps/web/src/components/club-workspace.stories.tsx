import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { ClubConnectionView } from "@/app/account/communities/[slug]/club-connection";
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
  invitations: [],
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
