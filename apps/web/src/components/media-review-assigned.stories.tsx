import { useState, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  ReviewCardView,
  ReviewSelection,
} from "../app/account/media-review/media-review-panel";
import type { ReviewDecision, CommandReceipt } from "@vrdex/api-contracts";
const description = "Local press-kit portrait supplied by the photographer. "
  .repeat(20)
  .slice(0, 1000);
const image =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='640'%3E%3Crect width='640' height='640' fill='%2325384d'/%3E%3Ccircle cx='320' cy='320' r='180' fill='%2389a9c8'/%3E%3C/svg%3E";
type Props = ComponentProps<typeof ReviewCardView>;
const row: Props["row"] = {
  submissionId: "fixture" as Props["row"]["submissionId"],
  profileId: "profile" as Props["row"]["profileId"],
  profileSlug: "fixture",
  profileDisplayName: "Local photographer",
  profileType: "person",
  profileIsPublic: true,
  requestedPlacement: "profile_image",
  status: "submitted",
  sourceKind: "local",
  sourceDescription: description,
  credit: "Fixture photographer",
  expiresAt: 2000000000000,
  targetProfileUpdatedAt: 1,
  currentProfileUpdatedAt: 2,
  createdAt: 1,
  updatedAt: 2,
  priorProposalCount: 0,
  priorProposalCountTruncated: false,
  canViewCandidate: true,
  canSuppress: false,
  sourceUrl: undefined,
  label: undefined,
  altText: undefined,
  creditUrl: undefined,
  contributorNote: undefined,
  publicDisposition: undefined,
  approvedAssetId: undefined,
};
function Fixture() {
  const [selected, setSelected] = useState<ReviewDecision[]>([]);
  const [receipts, setReceipts] = useState<CommandReceipt[]>([]);
  const [revision, setRevision] = useState(1);
  const detail: Props["detail"] = {
    ...row,
    reviewVersion: String(revision),
    currentProfileUpdatedAt: 2,
    targetProfileUpdatedAt: revision,
    currentAvatarImageUrl: image,
    currentAutomaticImageUrl: null,
    currentPlacement: null,
    candidate: {
      rendition: { submissionId: "fixture", kind: "stored_candidate" },
      sourceKind: "local",
      sourceDescription: description,
      credit: "Fixture photographer",
      contentSha256: "a".repeat(64),
    },
  };
  return (
    <main className="mx-auto grid max-w-5xl gap-5 p-4 sm:p-6">
      <ReviewSelection
        labels={{ fixture: "Local photographer" }}
        selected={selected}
        receipts={receipts}
        busy={false}
        remove={() => setSelected([])}
        submit={() =>
          setReceipts([
            {
              operationId: "fixture-refusal",
              resourceId: "fixture",
              operationState: "refused",
              code: "review_changed",
            },
          ])
        }
      />
      <ReviewCardView
        row={row}
        detail={detail}
        selected={selected[0]}
        select={(input) => {
          setSelected([input]);
          setReceipts([]);
        }}
        decide={async () => ({
          operationId: "fixture",
          operationState: "refused",
          code: "review_changed",
        })}
        rebase={async () => {
          setRevision(2);
          return { operationId: "rebase", operationState: "committed" };
        }}
        suppress={async () => ({ suppressed: false })}
      />
    </main>
  );
}
const meta = {
  title: "Account/Assigned media review",
  component: Fixture,
} satisfies Meta<typeof Fixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const LocalProvenance: Story = {};
