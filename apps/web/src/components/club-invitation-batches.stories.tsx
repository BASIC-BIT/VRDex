import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex-generated-api";
import { InvitationComposer } from "@/app/account/communities/[slug]/club-invitation-batches";
import type { Id } from "../../../../convex/_generated/dataModel";

const alice = "usr_11111111-1111-1111-1111-111111111111";
const bob = "usr_22222222-2222-2222-2222-222222222222";
type List = FunctionReturnType<
  typeof api.clubInvitations.lists
>["page"][number];
function Fixture({ instanceOnly = false, mutableCreation = false }: { instanceOnly?: boolean; mutableCreation?: boolean }) {
  const [lists, setLists] = useState<List[]>([
    {
      _id: "list-one" as Id<"clubRecipientLists">,
      name: "Friday regulars",
      recipients: [alice, bob],
      revision: 1,
    },
  ]);
  const [queued, setQueued] = useState("");
  const [queuedRevision, setQueuedRevision] = useState<number>();
  const [creationRevision, setCreationRevision] = useState(7);
  return (
    <main className="mx-auto max-w-3xl p-5">
      <h1 className="mb-6 text-3xl font-semibold">Invitations</h1>
      <InvitationComposer
        lists={lists}
        canGroup={!instanceOnly}
        canInstance
        events={[
          {
            id: "event-one" as Id<"events">,
            title: "Friday Afterhours",
            startAt: Date.UTC(2030, 8, 20, 22),
            status: "scheduled",
          },
        ]}
        instances={[
          {
            id: "visible-instance",
            name: "The Observatory",
            worldId: "wrld_33333333-3333-3333-3333-333333333333",
            instanceId: "123~group(grp_44444444-4444-4444-4444-444444444444)",
          },
        ]}
        creations={[
          {
            id: "creation-one" as Id<"clubOperations">,
            revision: creationRevision,
            payload: {
              kind: "create_instance",
              worldId: creationRevision === 7
                ? "wrld_33333333-3333-3333-3333-333333333333"
                : "wrld_55555555-5555-5555-5555-555555555555",
              region: "us",
              access: "members",
              ageGated: false,
            },
            dueAt: Date.UTC(2030, 8, 20, 21, 30),
            schedule: { kind: "fixed", dueAt: Date.UTC(2030, 8, 20, 21, 30) },
            state: "pending",
            actor: {
              tokenIdentifier: "fixture|owner",
              issuer: "fixture",
              subject: "owner",
            },
            batchId: "creation",
            code: null,
          },
        ]}
        botUrl={`https://vrchat.com/home/user/${alice}`}
        onPreview={async (recipients) => {
          if (
            !recipients.length ||
            recipients.length > 100 ||
            recipients.some((id) => !/^usr_[0-9a-f-]{36}$/i.test(id))
          )
            throw new Error("Use 1 to 100 VRChat user IDs.");
          const distinct = [...new Set(recipients)];
          return {
            recipients: distinct,
            removedDuplicates: recipients.length - distinct.length,
          };
        }}
        onSaveList={async (input) => {
          setLists((prior) =>
            input.listId
              ? prior.map((list) =>
                  list._id === input.listId
                    ? {
                        ...list,
                        name: input.name,
                        recipients: input.recipients,
                        revision: list.revision + 1,
                      }
                    : list,
                )
              : [
                  ...prior,
                  {
                    _id: `list-${prior.length + 1}` as Id<"clubRecipientLists">,
                    name: input.name,
                    recipients: input.recipients,
                    revision: 1,
                  },
                ],
          );
        }}
        onRemoveList={async (id) =>
          setLists((prior) => prior.filter((list) => list._id !== id))
        }
        onEnqueue={async (review) => {
          if (review.destination.kind === "scheduled_instance") {
            if (review.destination.creationRevision !== creationRevision)
              throw new Error("Instance creation is unavailable.");
            if (review.schedule.kind === "immediate")
              throw new Error("Invitations cannot run before instance creation.");
            setQueuedRevision(review.destination.creationRevision);
          }
          setQueued(
            `${review.reviewedRecipients.length} recipients · ${review.destination.kind} · ${review.schedule.kind}`,
          );
        }}
      />
      {mutableCreation ? (
        <button onClick={() => setCreationRevision((revision) => revision + 1)}>
          Change creation
        </button>
      ) : null}
      {queued ? (
        <p data-testid="queued-review" data-creation-revision={queuedRevision} className="mt-5">
          {queued}
        </p>
      ) : null}
    </main>
  );
}
const meta = {
  title: "Clubs/Invitation batches",
  component: Fixture,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Fixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Composer: Story = {};
export const InstanceStaff: Story = { args: { instanceOnly: true } };

export const ChangedCreation: Story = { args: { instanceOnly: true, mutableCreation: true } };
