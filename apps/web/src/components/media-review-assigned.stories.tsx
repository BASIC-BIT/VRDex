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

// Mount the full production panel and its Convex hooks. Only I/O and the
// exceptional runner response are controlled; selection/submission state is real.
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { decideSelectedReviews } from "@vrdex/api-contracts";
import { MediaReviewPanel } from "../app/account/media-review/media-review-panel";
function ProductionPanelFixture({
  failFirst = false,
  loseResponse = false,
}: {
  failFirst?: boolean;
  loseResponse?: boolean;
}) {
  const [calls, setCalls] = useState<unknown[]>([]);
  const [runner] = useState(() => {
    let fail = failFirst;
    return async (...args: Parameters<typeof decideSelectedReviews>) => {
      if (fail) {
        fail = false;
        throw new Error("Injected selection validation failure");
      }
      return await decideSelectedReviews(...args);
    };
  });
  const [client] = useState(() => {
    const value = new ConvexReactClient("http://127.0.0.1:3210");
    const listeners = new Set<() => void>();
    let removed = false;
    let responseLost = loseResponse;
    const detail = {
      ...row,
      targetProfileUpdatedAt: 2,
      reviewVersion: "v2",
      currentPlacement: null,
      currentAvatarImageUrl: null,
      currentAutomaticImageUrl: null,
      candidate: {
        rendition: { submissionId: "fixture", kind: "stored_candidate" },
        credit: row.credit,
        contentSha256: null,
      },
    };
    Object.defineProperty(value, "watchQuery", {
      value: (query: FunctionReference<"query">) => ({
        onUpdate: (listener: () => void) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        localQueryResult: () => {
          const name = getFunctionName(query);
          if (name.endsWith(":getReviewAccess"))
            return {
              superAdmin: false,
              canReviewMedia: false,
              profiles: [
                {
                  profileId: row.profileId,
                  slug: row.profileSlug,
                  displayName: row.profileDisplayName,
                  profileType: row.profileType,
                },
              ],
            };
          if (name.endsWith(":reviewDetail")) return detail;
          return {
            page: removed ? [] : [row],
            isDone: true,
            continueCursor: "",
          };
        },
        localQueryLogs: () => [],
        journal: () => undefined,
      }),
    });
    Object.defineProperty(value, "mutation", {
      value: async (_mutation: unknown, args: unknown) => {
        setCalls((previous) => [...previous, args]);
        if (responseLost) {
          responseLost = false;
          if ((args as { decision?: string }).decision) {
            removed = true;
            listeners.forEach((listener) => listener());
          }
          throw new Error("Response lost after commit");
        }
        return {
          operationId: "fixture-commit",
          resourceId: row.submissionId,
          operationState: "committed",
        };
      },
    });
    return value;
  });
  return (
    <ConvexProvider client={client}>
      <div className="mx-auto max-w-5xl p-4">
        <MediaReviewPanel runSelected={runner} />
        <output className="block break-all" data-testid="panel-mutations">
          {JSON.stringify(calls)}
        </output>
      </div>
    </ConvexProvider>
  );
}
export const ProductionWhitespace: Story = {
  render: () => <ProductionPanelFixture />,
};
export const ProductionFailure: Story = {
  render: () => <ProductionPanelFixture failFirst />,
};
export const ProductionUncertain: Story = {
  render: () => <ProductionPanelFixture loseResponse />,
};

import { MediaContributionsPanel } from "../app/account/media-contributions/media-contributions-panel";
function OwnInventoryFixture() {
  const [client] = useState(() => {
    const value = new ConvexReactClient("http://127.0.0.1:3210");
    Object.defineProperty(value, "watchQuery", {
      value: (
        query: FunctionReference<"query">,
        args: { paginationOpts?: { cursor: string | null } },
      ) => ({
        onUpdate: () => () => {},
        localQueryLogs: () => [],
        journal: () => undefined,
        localQueryResult: () => {
          if (getFunctionName(query).endsWith(":getReviewAccess"))
            return { canPublishMedia: false };
          const older = args.paginationOpts?.cursor === "older";
          return {
            page: Array.from({ length: older ? 1 : 20 }, (_, index) => ({
              ...row,
              submissionId: older ? "older" : `recent-${index}`,
              profileDisplayName: older
                ? "Older photographer"
                : `Recent photographer ${index}`,
              status: "rejected",
              reviewVersion: "v1",
              publisherTargetAvailable: false,
              publicDisposition: older ? "Older decision" : undefined,
            })),
            isDone: older,
            continueCursor: older ? "" : "older",
          };
        },
      }),
    });
    return value;
  });
  return (
    <ConvexProvider client={client}>
      <div className="mx-auto max-w-5xl p-4">
        <MediaContributionsPanel />
      </div>
    </ConvexProvider>
  );
}
export const OwnInventory: Story = { render: () => <OwnInventoryFixture /> };
