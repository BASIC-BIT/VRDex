import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { PostEditor } from "@/app/account/communities/[slug]/club-posts";
import type { Id } from "../../../../convex/_generated/dataModel";
function Preview() {
  const [status, setStatus] = useState("");
  return (
    <div className="mx-auto max-w-4xl p-5">
      <PostEditor
        initial={{
          title: "Afterhours this Friday",
          text: "Meet us at the Observatory. Doors open at 22:00.\n\nBring your friends and stay for the closing set.",
          visibility: "group",
          sendNotification: false,
        }}
        events={[
          {
            id: "fixture-event" as Id<"events">,
            title: "Friday Afterhours",
            startAt: Date.UTC(2026, 8, 18, 22),
            status: "scheduled",
          },
        ]}
        onSave={async () => setStatus("Draft saved.")}
        onQueue={async (_, schedule) =>
          setStatus(`Post queued: ${schedule.kind}.`)
        }
        onClose={() => setStatus("Closed.")}
      />
      {status ? (
        <p role="status" className="mt-4">
          {status}
        </p>
      ) : null}
    </div>
  );
}
const meta = {
  title: "Clubs/Posts",
  component: Preview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Composer: Story = {};
