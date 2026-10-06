import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReviewDetail, PublishedContributionDetail } from "@vrdex/api-contracts";
import { PublishedContributionCardView } from "../app/account/media-contributions/published-contribution-card";
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
  requestedPlacement: "gallery",
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

  const [calls, setCalls] = useState<string[]>([]);
  return (
    <main className="mx-auto max-w-4xl p-4">
      <h1 className="text-xl font-semibold">Fixture photographer</h1>
      <PublicationCardView
        detail={fixture}
        publish={async (input) => {
          setCalls((previous) => [
            ...previous,
            JSON.stringify({ command: "publish", ...input }),
          ]);
          if (loseResponse && !lost && !sessionStorage.getItem("fixture:lost")) {
            sessionStorage.setItem("fixture:lost", "true");
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
          if (name.endsWith(":contributionDetail")) return null;
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
const publishedFixture: PublishedContributionDetail = {
  submissionId: "published-fixture", assetId: "fixture-asset", profileId: "profile", profileSlug: "fixture",
  contributionVersion: "c1", metadata: { label: "Photographer portrait", credit: "Fixture photographer", sourceDescription: "Local image supplied by the photographer. ".repeat(8) },
  canSelectPrimary: true, canClearPrimary: false, canProposePlacement: false, canEditMetadata: true, canRemove: true,
};
function PublishedFixture({ protectedSelection = false, loseResponse = false }: { protectedSelection?: boolean; loseResponse?: boolean }) {
  const [detail, setDetail] = useState<PublishedContributionDetail>(() => ({ ...publishedFixture, ...(protectedSelection ? { canSelectPrimary: false, canClearPrimary: false, canProposePlacement: true, canEditMetadata: false, canRemove: false } : {}) }));
  const [calls, setCalls] = useState<unknown[]>([]);
  const [conflicted, setConflicted] = useState(false);
  return <main className="mx-auto max-w-4xl p-4"><h1 className="text-xl font-semibold">Fixture photographer</h1>
    <PublishedContributionCardView submissionId={detail.submissionId} detail={detail}
      place={async input => {
        setCalls(previous => [...previous, { kind: "place", input }]);
        const selected = input.action === "select_primary";
        setDetail(previous => ({ ...previous, contributionVersion: selected ? "c2" : "c3", canSelectPrimary: !selected, canClearPrimary: selected, canEditMetadata: !selected, canRemove: !selected }));
        return { operationId: "placement", operationState: "committed" };
      }}
      propose={async input => { setCalls(previous => [...previous, { kind: "propose", input }]); return { operationId: "proposed", operationState: "committed" }; }}
      manage={async input => {
        setCalls(previous => [...previous, { kind: "manage", input }]);
        if (loseResponse && !sessionStorage.getItem("fixture:published-lost")) {
          sessionStorage.setItem("fixture:published-lost", "true");
          setDetail(previous => ({ ...previous, contributionVersion: "committed-version" }));
          throw new Error("Lost committed response");
        }
        if (!loseResponse && input.action === "update_metadata" && !conflicted) {
          setConflicted(true);
          setDetail(previous => ({ ...previous, contributionVersion: "conflict-version" }));
          return { operationId: "stale", operationState: "refused", code: "contribution_changed" };
        }
        if (input.action === "update_metadata") setDetail(previous => ({ ...previous, metadata: { ...previous.metadata, ...Object.fromEntries(Object.entries(input.metadata).filter(([, value]) => value !== null)) }, contributionVersion: "c4" }));
        return { operationId: "managed", operationState: "committed" };
      }} />
    <output className="sr-only" data-testid="published-commands">{JSON.stringify(calls)}</output>
  </main>;
}
export const Published: Story = { render: () => <PublishedFixture /> };
export const Protected: Story = { render: () => <PublishedFixture protectedSelection /> };
export const PublishedUncertain: Story = { render: () => <PublishedFixture loseResponse /> };
function RemovedUncertainFixture() {
  const [detail, setDetail] = useState<PublishedContributionDetail | null>(() => sessionStorage.getItem("fixture:removed") ? null : publishedFixture);
  const [calls, setCalls] = useState<unknown[]>([]);
  return <main className="mx-auto max-w-4xl p-4"><PublishedContributionCardView submissionId={publishedFixture.submissionId} detail={detail}
    place={async () => ({ operationId: "unused", operationState: "refused" })}
    propose={async () => ({ operationId: "unused", operationState: "refused" })}
    manage={async input => {
      setCalls(previous => [...previous, input]);
      if (!sessionStorage.getItem("fixture:removed")) {
        sessionStorage.setItem("fixture:removed", "true");
        setDetail(null);
        throw new Error("Removal committed, response lost");
      }
      return { operationId: "removed", operationState: "committed" };
    }} /><output className="sr-only" data-testid="removal-commands">{JSON.stringify(calls)}</output></main>;
}
export const RemovedUncertain: Story = { render: () => <RemovedUncertainFixture /> };
