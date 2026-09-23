import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReviewDetail } from "@vrdex/api-contracts";
import { PublicationCardView } from "../app/account/media-contributions/publication-card";
import { MediaContributionsPanel } from "../app/account/media-contributions/media-contributions-panel";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
const fixture: ReviewDetail = {
  submissionId: "fixture",
  profileId: "profile",
  profileSlug: "fixture",
  profileDisplayName: "Fixture photographer",
  profileIsPublic: true,
  profileType: "person",
  requestedPlacement: "profile_image",
  status: "submitted",
  sourceKind: "local",
  sourceDescription: "Local image supplied by the photographer.",
  credit: "Fixture photographer",
  expiresAt: 2e12,
  targetProfileUpdatedAt: 1,
  currentProfileUpdatedAt: 1,
  createdAt: 1,
  updatedAt: 1,
  priorProposalCount: 0,
  priorProposalCountTruncated: false,
  canViewCandidate: true,
  canSuppress: false,
  reviewVersion: "v1",
  currentPlacement: null,
  currentAvatarImageUrl: null,
  currentAutomaticImageUrl: null,
  candidate: {
    rendition: { submissionId: "fixture", kind: "stored_candidate" },
    credit: "Fixture photographer",
    contentSha256: "a".repeat(64),
  },
};
function Fixture({ loseResponse = false }: { loseResponse?: boolean }) {
  const [lost, setLost] = useState(false);
  const [version, setVersion] = useState("v1");
  const [calls, setCalls] = useState<string[]>([]);
  return (
    <main className="mx-auto max-w-4xl p-4">
      <h1 className="text-xl font-semibold">Fixture photographer</h1>
      <PublicationCardView
        detail={{ ...fixture, reviewVersion: version }}
        declare={async (input) => {
          setCalls((previous) => [
            ...previous,
            JSON.stringify({ command: "declare", ...input }),
          ]);
          setVersion("v2");
          return { operationId: "declare", operationState: "committed" };
        }}
        publish={async (input) => {
          setCalls((previous) => [
            ...previous,
            JSON.stringify({ command: "publish", ...input }),
          ]);
          if (loseResponse && !lost) {
            setLost(true);
            throw new Error("Lost committed response");
          }
          if (loseResponse)
            return { operationId: "publish", operationState: "committed" };
          return {
            operationId: "publish",
            operationState: "refused",
            code: "independent_review_required",
          };
        }}
      />
      <output data-testid="commands" className="sr-only">
        {JSON.stringify(calls)}
      </output>
    </main>
  );
}
const meta = {
  title: "Account/Trusted publication",
  component: Fixture,
} satisfies Meta<typeof Fixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ExplicitCommands: Story = {};

export const Uncertain: Story = { render: () => <Fixture loseResponse /> };

function ReactiveInventoryFixture() {
  const [calls, setCalls] = useState<unknown[]>([]);
  const [client] = useState(() => {
    const value = new ConvexReactClient("http://127.0.0.1:3210");
    const listeners = new Set<() => void>();
    let approved = false;
    Object.defineProperty(value, "watchQuery", {
      value: (query: FunctionReference<"query">) => ({
        onUpdate: (listener: () => void) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        localQueryLogs: () => [],
        journal: () => undefined,
        localQueryResult: () => {
          const name = getFunctionName(query);
          if (name.endsWith(":getReviewAccess"))
            return { canPublishMedia: true };
          const row = {
            ...fixture,
            status: approved ? "approved" : "submitted",
            reviewVersion: approved ? "v2" : "v1",
            publisherTargetAvailable: true,
            publicationMethod: approved ? "trusted_publisher" : undefined,
          };
          if (name.endsWith(":publisherDetail")) return row;
          return { page: [row], isDone: true, continueCursor: "" };
        },
      }),
    });
    Object.defineProperty(value, "mutation", {
      value: async (_mutation: unknown, input: unknown) => {
        setCalls((previous) => [...previous, input]);
        if (!approved) {
          approved = true;
          listeners.forEach((listener) => listener());
          throw new Error("Publication committed, response lost");
        }
        return {
          operationId: "publish-once",
          operationState: "committed",
          resourceId: "fixture",
        };
      },
    });
    return value;
  });
  return (
    <ConvexProvider client={client}>
      <div className="mx-auto max-w-4xl p-4">
        <MediaContributionsPanel />
        <output className="sr-only" data-testid="inventory-commands">
          {JSON.stringify(calls)}
        </output>
      </div>
    </ConvexProvider>
  );
}
export const ReactiveInventory: Story = {
  render: () => <ReactiveInventoryFixture />,
};
