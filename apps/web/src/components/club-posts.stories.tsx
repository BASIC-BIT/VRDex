import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { PostEditor } from "@/app/account/communities/[slug]/club-posts";
import type { Id } from "../../../../convex/_generated/dataModel";
function Preview({ liveClock = false }: { liveClock?: boolean }) {
  const [status, setStatus] = useState("");
  const [eventStartAt, setEventStartAt] = useState(Date.UTC(2026, 8, 18, 22));
  return (
    <div className="mx-auto max-w-4xl p-5">
      {liveClock ? <button onClick={() => setEventStartAt(eventStartAt + 3600_000)}>Move event start</button> : null}
      <PostEditor
        getServerNow={async () => liveClock ? Date.now() : Date.UTC(2026, 8, 14, 20)}
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
            startAt: eventStartAt,
            status: "scheduled",
            vrchatWorldId: null,
          },
        ]}
        onSave={async () => setStatus("Draft saved.")}
        onQueue={async (_, schedule, reviewedDueAt) => {
          if (schedule.kind === "event_relative" &&
              reviewedDueAt !== eventStartAt + schedule.offsetMs)
            throw new Error("Reviewed time missing.");
          setStatus(`Post queued: ${schedule.kind}.`);
        }}
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
export const LiveClock: Story = { args: { liveClock: true } };
