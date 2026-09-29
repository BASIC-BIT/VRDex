import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Card, SectionTitle } from "@/components/ui/card";
import { ClubChart } from "@/app/account/communities/[slug]/club-chart";
import { markMembershipMilestones } from "@/app/account/communities/[slug]/club-analytics-model";

const now = Date.UTC(2026, 8, 29, 12);
const observations = [
  { at: Date.UTC(2026, 8, 24, 12), value: 975, label: "Sep 24" },
  { at: Date.UTC(2026, 8, 26, 12), value: 1120, label: "Sep 26" },
  { at: Date.UTC(2026, 8, 28, 12), value: 1234, label: "Sep 28" },
];
const points = markMembershipMilestones(observations, {
  groupCreatedAt: Date.UTC(2026, 8, 21, 12),
  latestObservedAt: observations.at(-1)!.at,
  startAt: Date.UTC(2026, 8, 20),
  endAt: Date.UTC(2026, 8, 30),
  now,
});

const meta = { title: "Clubs/Membership milestones", parameters: { layout: "padded" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Range: Story = {
  render: () => <Card padding="lg" className="max-w-4xl">
    <SectionTitle>Total group membership</SectionTitle>
    <div className="mt-5"><ClubChart points={points} label="Group members" showIsolatedPoints /></div>
  </Card>,
};
