import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReviewDetail } from "@vrdex/api-contracts";
import { PublicationCardView } from "../app/account/media-contributions/publication-card";
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
