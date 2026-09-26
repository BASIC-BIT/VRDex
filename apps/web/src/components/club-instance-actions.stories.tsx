import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { InstanceCreateForm } from "@/app/account/communities/[slug]/club-instance-actions";
import { Card, SectionTitle } from "@/components/ui/card";
import { PageContainer, PageShell } from "@/components/ui/page-shell";
import type { Id } from "../../../../convex/_generated/dataModel";
function FormFixture() {
  const [payload, setPayload] = useState("");
  const [eventStartAt] = useState(() => Date.now() + 7 * 86400_000);
  return (
    <PageShell>
      <PageContainer max="3xl">
        <Card padding="lg" className="grid gap-5">
          <SectionTitle>New instance</SectionTitle>
          <InstanceCreateForm
            getServerNow={async () => Date.UTC(2026, 8, 14, 20)}
            events={[
              {
                id: "fixture-event" as Id<"events">,
                title: "Afterhours Friday",
                startAt: eventStartAt,
                status: "scheduled",
                vrchatWorldId: "wrld_11111111-1111-1111-1111-111111111111",
              },
              {
                id: "second-event" as Id<"events">,
                title: "Saturday session",
                startAt: eventStartAt + 86400_000,
                status: "scheduled",
                vrchatWorldId: "wrld_22222222-2222-2222-2222-222222222222",
              },
              {
                id: "missing-world" as Id<"events">,
                title: "World pending",
                startAt: eventStartAt,
                status: "scheduled",
                vrchatWorldId: null,
              },
              {
                id: "ambiguous-world" as Id<"events">,
                title: "Multiple worlds",
                startAt: eventStartAt,
                status: "scheduled",
                vrchatWorldId: null,
              },
            ]}
            roles={[
              {
                id: "grol_22222222-2222-2222-2222-222222222222",
                name: "Club staff",
              },
              {
                id: "grol_33333333-3333-3333-3333-333333333333",
                name: "Performers",
              },
            ]}
            rolesReady
            onLoadRoles={() => {}}
            onSubmit={async (value, schedule) => {
              setPayload(JSON.stringify({ value, schedule }));
            }}
          />
          <output data-testid="submitted-payload" hidden>
            {payload}
          </output>
        </Card>
      </PageContainer>
    </PageShell>
  );
}
const meta = {
  title: "Clubs/Instance actions",
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Create: Story = { render: () => <FormFixture /> };
