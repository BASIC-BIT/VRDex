import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { ProfilePublicPage, type PublicProfile } from "@/app/_components/profile-public-page";

const client = new ConvexReactClient("http://127.0.0.1:1", { skipConvexDeploymentUrlCheck: true });
const useAuth = () => ({ isLoading: false, isAuthenticated: false, fetchAccessToken: async () => null });

const profile: PublicProfile = {
  profileType: "community", slug: "afterglow", displayName: "Afterglow Social",
  aliases: [], tags: [], genres: [], trustLabel: "claimed_verified",
  community: { categoryTags: [] }, outboundLinks: [], worldCredits: [],
  upcomingEvents: [], hostedEvents: [],
  groupMembership: {
    groupCreatedAt: Date.UTC(2026, 8, 21),
    latest: { observedAt: Date.UTC(2026, 8, 28), value: 1234 },
    points: [
      { observedAt: Date.UTC(2026, 8, 24), value: 975 },
      { observedAt: Date.UTC(2026, 8, 25), value: 1040 },
      { observedAt: Date.UTC(2026, 8, 26), value: 1120 },
      { observedAt: Date.UTC(2026, 8, 27), value: 1185 },
      { observedAt: Date.UTC(2026, 8, 28), value: 1234 },
    ],
  },
};

const meta = { title: "Profiles/Public group membership", parameters: { layout: "padded" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function Preview({ value }: { value: PublicProfile }) {
  return <ConvexProviderWithAuth client={client} useAuth={useAuth}>
    <ProfilePublicPage embedded mediaKitGalleryEnabled profile={value} />
  </ConvexProviderWithAuth>;
}

export const Both: Story = { render: () => <Preview value={profile} /> };
export const CountOnly: Story = { render: () => <Preview value={{ ...profile, appearance: { sectionOrder: [], showMemberCount: true, showMemberHistory: false } }} /> };
export const GraphOnly: Story = { render: () => <Preview value={{ ...profile, appearance: { sectionOrder: [], showMemberCount: false, showMemberHistory: true } }} /> };
export const Neither: Story = { render: () => <Preview value={{ ...profile, telemetry: { freshness: "stale", groupMemberCount: { observedAt: Date.UTC(2026, 8, 28), value: 1234 }, groupMemberGrowth: { value: 20, startAt: Date.UTC(2026, 8, 20), endAt: Date.UTC(2026, 8, 28) } }, appearance: { sectionOrder: [], showMemberCount: false, showMemberHistory: false } }} /> };
export const SingleObservation: Story = { render: () => <Preview value={{ ...profile, groupMembership: { ...profile.groupMembership!, points: [profile.groupMembership!.latest] } }} /> };
export const UnknownCreation: Story = { render: () => <Preview value={{ ...profile, groupMembership: { ...profile.groupMembership!, groupCreatedAt: undefined } }} /> };
export const MissingDays: Story = { render: () => <Preview value={{ ...profile, groupMembership: {
  latest: { observedAt: Date.UTC(2026, 8, 16), value: 1040 },
  points: [
    { observedAt: Date.UTC(2026, 8, 10), value: 975 },
    { observedAt: Date.UTC(2026, 8, 11), value: 990 },
    { observedAt: Date.UTC(2026, 8, 16), value: 1040 },
  ],
} }} /> };
