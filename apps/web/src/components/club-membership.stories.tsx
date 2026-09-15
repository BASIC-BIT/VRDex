import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  MembershipMovementView,
  MembershipActivityView,
} from "@/app/account/communities/[slug]/club-membership";

const start = Date.UTC(2026, 7, 1);
function Preview() {
  return (
    <div className="mx-auto grid max-w-5xl gap-6 p-5">
      <MembershipMovementView
        points={Array.from({ length: 14 }, (_, i) => ({
          at: start + i * 86400000,
          label: `Aug ${i + 1}`,
          joins: i === 4 ? null : [12, 8, 3, 21, 0, 5, 7][i % 7]!,
          departures: i === 4 ? null : [2, 0, 1, 3, 0, 2, 1][i % 7]!,
        }))}
        onSelect={() => {}}
      />
      <MembershipActivityView
        events={[
          {
            auditId: "a",
            eventType: "group.member.join",
            occurredAt: start + 3600000,
            targetDisplayName: "Nightbird",
            targetUserId: "usr_example_nightbird",
          },
          {
            auditId: "b",
            eventType: "group.member.leave",
            occurredAt: start,
            targetUserId: "usr_example_aurora",
          },
          {
            auditId: "c",
            eventType: "group.member.remove",
            occurredAt: start - 3600000,
            targetDisplayName: "Echo",
            targetUserId: "usr_example_echo",
          },
        ]}
        canLoadMore
        onLoadMore={() => {}}
      />
    </div>
  );
}
const meta = {
  title: "Clubs/Membership",
  component: Preview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const MovementAndActivity: Story = {};
export const Unknown: Story = {
  render: () => (
    <div className="p-5">
      <MembershipMovementView
        points={[{ at: start, label: "Aug 1", joins: null, departures: null }]}
      />
    </div>
  ),
};
