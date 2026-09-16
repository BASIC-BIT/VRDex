"use client";

import Link from "next/link";
import { useState } from "react";
import { PublicationCard } from "./publication-card";
import { useMutation, useQuery, usePaginatedQuery } from "convex/react";
import { api } from "@convex-generated-api";

import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";

const statusLabel = {
  upload_pending: "Upload pending",
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  superseded: "Superseded",
} as const;

export function MediaContributionsPanel() {
  const access = useQuery(api.profileMediaSubmissions.getReviewAccess);
  const inventory = usePaginatedQuery(
    api.profileMediaSubmissions.listMinePage,
    {},
    { initialNumItems: 20 },
  );
  const submissions = inventory.results;

  return (
    <main className="grid gap-6">
      <SectionTitle>Media contributions</SectionTitle>
      {inventory.status === "LoadingFirstPage" ? (
        <p aria-busy="true" className="text-sm text-muted">
          Loading…
        </p>
      ) : null}
      <div className="grid gap-4">
        {submissions?.map((submission) => (
          <Card key={submission.submissionId}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                {submission.profileIsPublic ? (
                  <Link
                    className="text-lg font-semibold hover:underline"
                    href={`/${submission.profileSlug}`}
                  >
                    {submission.profileDisplayName}
                  </Link>
                ) : (
                  <p className="text-lg font-semibold">
                    {submission.profileDisplayName}
                  </p>
                )}
                <p className="mt-1 text-sm text-muted">
                  {statusLabel[submission.status]}
                </p>
              </div>
              <WithdrawButton
                submissionId={submission.submissionId}
                reviewVersion={submission.reviewVersion}
                available={[
                  "upload_pending",
                  "submitted",
                  "under_review",
                ].includes(submission.status)}
              />
            </div>
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted">Requested use</dt>
                <dd>
                  {submission.requestedPlacement === "profile_image"
                    ? "Profile image"
                    : "Primary logo"}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Credit</dt>
                <dd>{submission.credit}</dd>
              </div>
            </dl>
            {access?.canPublishMedia &&
            submission.publisherTargetAvailable &&
            ["submitted", "under_review"].includes(submission.status) ? (
              <PublicationCard submissionId={submission.submissionId} />
            ) : null}
            {submission.status === "approved" ? (
              <p className="mt-3 text-sm text-muted">
                {submission.publicationMethod === "trusted_publisher"
                  ? "Trusted publication"
                  : submission.publicationMethod === "independent_review"
                    ? "Independent review"
                    : "Legacy approval"}
              </p>
            ) : null}
            {submission.publicDisposition ? (
              <Notice
                className="mt-5"
                variant={submission.status === "rejected" ? "warning" : "info"}
              >
                {submission.publicDisposition}
              </Notice>
            ) : null}
          </Card>
        ))}
      </div>
      {inventory.status === "CanLoadMore" ? (
        <Button onClick={() => inventory.loadMore(20)}>Load more</Button>
      ) : null}
    </main>
  );
}

function WithdrawButton({
  submissionId,
  reviewVersion,
  available,
}: {
  submissionId: import("../../../../../../convex/_generated/dataModel").Id<"profileMediaSubmissions">;
  reviewVersion: string;
  available: boolean;
}) {
  const withdraw = useMutation(api.profileMediaSubmissions.withdrawWithReceipt);
  const [pending, setPending] = useState<{
    submissionId: typeof submissionId;
    expectedReviewVersion: string;
    idempotencyKey: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function run() {
    if (busy || (!pending && !available)) return;
    const command = pending ?? {
      submissionId,
      expectedReviewVersion: reviewVersion,
      idempotencyKey: crypto.randomUUID(),
    };
    setPending(command);
    setBusy(true);
    try {
      const receipt = await withdraw(command);
      if (receipt.operationState !== "in_progress") setPending(null);
      setMessage(
        receipt.operationState === "committed"
          ? "Withdrawn"
          : receipt.operationState === "in_progress"
            ? "Outcome unknown"
            : "Decision refused.",
      );
    } catch {
      setMessage("Outcome unknown");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      {available || pending ? (
        <Button
          disabled={busy}
          onClick={() => void run()}
          type="button"
          variant="ghost"
        >
          {pending ? "Retry" : "Withdraw"}
        </Button>
      ) : null}
      {message ? <Notice>{message}</Notice> : null}
    </div>
  );
}
