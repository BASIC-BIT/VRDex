"use client";

import Link from "next/link";
import {
  decideSelectedReviews,
  reviewDecisionSchema,
  type ReviewDecision,
  type ReviewDetail,
  type CommandReceipt,
} from "@vrdex/api-contracts";
import { useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex-generated-api";

import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { MediaReviewComparison } from "@/components/media-review-comparison";
import {
  reviewDecisionMessage,
  reviewPlacementImage,
} from "./media-review-view";

type ReviewRow = FunctionReturnType<
  typeof api.profileMediaSubmissions.listForReview
>["page"][number];

function ReviewCard({
  row,
  select,
  selected,
}: {
  row: ReviewRow;
  select: (decision: ReviewDecision) => void;
  selected?: ReviewDecision;
}) {
  const detail = useQuery(api.profileMediaSubmissions.reviewDetail, {
    submissionId: row.submissionId,
  });
  const decide = useMutation(api.profileMediaSubmissions.decideWithReceipt);
  const rebase = useMutation(api.profileMediaSubmissions.rebase);
  const suppress = useMutation(
    api.profileMediaSubmissions.suppressApprovedAsset,
  );
  return (
    <ReviewCardView
      row={row}
      detail={detail}
      decide={(input) => decide({ ...input, submissionId: row.submissionId })}
      rebase={(input) => rebase({ ...input, submissionId: row.submissionId })}
      suppress={suppress}
      select={select}
      selected={selected}
    />
  );
}
export function ReviewCardView({
  row,
  detail,
  decide,
  rebase,
  suppress,
  select,
  selected,
}: {
  row: ReviewRow;
  detail: ReviewDetail | null | undefined;
  decide: (input: ReviewDecision) => Promise<CommandReceipt>;
  rebase: (input: {
    submissionId: string;
    expectedReviewVersion: string;
    idempotencyKey: string;
  }) => Promise<CommandReceipt>;
  suppress: (input: {
    submissionId: Id<"profileMediaSubmissions">;
    reason: string;
  }) => Promise<{ suppressed: boolean }>;
  select: (decision: ReviewDecision) => void;
  selected?: ReviewDecision;
}) {
  const [busy, setBusy] = useState(false);
  const [publicDisposition, setPublicDisposition] = useState("");
  const [privateReason, setPrivateReason] = useState("");
  const [suppressionReason, setSuppressionReason] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  async function submit(decision: "approve" | "reject") {
    setBusy(true);
    setStatus(null);
    setConflict(false);
    try {
      if (detail === undefined || detail === null) {
        setStatus("Review detail is unavailable.");
        return;
      }
      const receipt = await decide({
        submissionId: row.submissionId,
        expectedReviewVersion: detail.reviewVersion,
        decision,
        idempotencyKey: crypto.randomUUID(),
        publicReason: publicDisposition.trim() || undefined,
        privateReason,
      });
      const result = reviewDecisionMessage(receipt, decision);
      setStatus(result.message);
      setConflict(result.conflict);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message.split("\n")[0]
          : "Decision failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  function selectDecision(decision: "approve" | "reject") {
    if (!detail) return;
    select({
      submissionId: row.submissionId,
      expectedReviewVersion: detail.reviewVersion,
      decision,
      privateReason,
      publicReason: publicDisposition.trim() || undefined,
      idempotencyKey: crypto.randomUUID(),
    });
  }
  async function rebaseCandidate() {
    if (!detail) return;
    setBusy(true);
    try {
      const receipt = await rebase({
        submissionId: row.submissionId,
        expectedReviewVersion: detail.reviewVersion,
        idempotencyKey: crypto.randomUUID(),
      });
      setStatus(
        receipt.operationState === "committed"
          ? "Rebased"
          : reviewDecisionMessage(receipt).message,
      );
      setConflict(receipt.operationState !== "committed");
    } catch {
      setStatus("Decision refused.");
    } finally {
      setBusy(false);
    }
  }
  async function suppressAsset() {
    if (!window.confirm("Suppress media")) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await suppress({
        submissionId: row.submissionId,
        reason: suppressionReason,
      });
      setStatus(result.suppressed ? "Suppressed." : "Already suppressed.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message.split("\n")[0]
          : "Suppression failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {row.profileIsPublic ? (
            <Link
              className="text-xl font-semibold hover:underline"
              href={`/${row.profileSlug}`}
            >
              {row.profileDisplayName}
            </Link>
          ) : (
            <p className="text-xl font-semibold">{row.profileDisplayName}</p>
          )}
          <p className="mt-1 text-sm text-muted">
            {row.requestedPlacement === "profile_image"
              ? "Profile image"
              : "Primary logo"}
          </p>
        </div>
        {row.sourceUrl ? (
          <a
            className="text-sm underline"
            href={row.sourceUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open source
          </a>
        ) : (
          <span className="max-w-full break-words text-sm [overflow-wrap:anywhere]">
            {row.sourceDescription}
          </span>
        )}
      </div>
      {detail === undefined ? (
        <p aria-busy="true" className="mt-5 text-sm text-muted">
          Loading…
        </p>
      ) : null}
      {detail ? (
        <div className="mt-5">
          <MediaReviewComparison
            candidateAlt={
              row.altText || `Candidate for ${row.profileDisplayName}`
            }
            candidateSrc={
              detail.candidate.rendition
                ? `/api/account/media-review/submissions/${row.submissionId}/file`
                : null
            }
            currentAlt={`Current image for ${row.profileDisplayName}`}
            currentSrc={reviewPlacementImage(detail)}
          />
        </div>
      ) : null}
      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">Credit</dt>
          <dd>{row.credit}</dd>
        </div>
        <div>
          <dt className="text-muted">Alt text</dt>
          <dd>{row.altText || "Not provided"}</dd>
        </div>
        <div>
          <dt className="text-muted">Prior matching proposals</dt>
          <dd>
            {row.priorProposalCount}
            {row.priorProposalCountTruncated ? "+" : ""}
          </dd>
        </div>
        {row.submitterDisplayName || row.submitterEmail ? (
          <div>
            <dt className="text-muted">Submitter</dt>
            <dd>{row.submitterDisplayName || row.submitterEmail}</dd>
            {row.submitterDisplayName && row.submitterEmail ? (
              <dd className="text-xs text-muted">{row.submitterEmail}</dd>
            ) : null}
          </div>
        ) : null}
      </dl>
      {row.contributorNote ? (
        <Notice className="mt-5">{row.contributorNote}</Notice>
      ) : null}
      {detail &&
      (detail.targetProfileUpdatedAt !== detail.currentProfileUpdatedAt ||
        conflict ||
        (selected &&
          selected.expectedReviewVersion !== detail.reviewVersion)) ? (
        <Notice className="mt-5" variant="warning">
          Review changed. Inspect the current images before deciding again.
        </Notice>
      ) : null}
      {row.status === "approved" && row.canSuppress ? (
        <div className="mt-5 grid gap-4">
          <Field>
            Suppression reason
            <Textarea
              maxLength={1000}
              onChange={(event) => setSuppressionReason(event.target.value)}
              required
              rows={3}
              value={suppressionReason}
            />
          </Field>
          <Button
            disabled={busy || suppressionReason.trim() === ""}
            onClick={() => void suppressAsset()}
            type="button"
            variant="dangerGhost"
          >
            Suppress media
          </Button>
          {status ? <Notice role="status">{status}</Notice> : null}
        </div>
      ) : row.status === "submitted" || row.status === "under_review" ? (
        <div className="mt-5 grid gap-4">
          <Field>
            Public rejection reason
            <Textarea
              maxLength={240}
              onChange={(event) => setPublicDisposition(event.target.value)}
              rows={2}
              value={publicDisposition}
            />
          </Field>
          <Field>
            Private review reason
            <Textarea
              maxLength={1000}
              onChange={(event) => setPrivateReason(event.target.value)}
              required
              rows={3}
              value={privateReason}
            />
          </Field>
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={busy || !detail}
              onClick={() => void rebaseCandidate()}
              type="button"
              variant="ghost"
            >
              Rebase
            </Button>
            <Button
              disabled={busy || !detail || !privateReason.trim()}
              onClick={() => selectDecision("approve")}
              type="button"
              variant="ghost"
            >
              Select approval
            </Button>
            <Button
              disabled={
                busy ||
                !detail ||
                !privateReason.trim() ||
                !publicDisposition.trim()
              }
              onClick={() => selectDecision("reject")}
              type="button"
              variant="ghost"
            >
              Select rejection
            </Button>
            <Button
              disabled={
                busy ||
                detail === undefined ||
                detail === null ||
                privateReason.trim() === ""
              }
              onClick={() => void submit("approve")}
              type="button"
              variant="primary"
            >
              Approve
            </Button>
            <Button
              disabled={
                busy ||
                privateReason.trim() === "" ||
                publicDisposition.trim() === ""
              }
              onClick={() => void submit("reject")}
              type="button"
              variant="dangerGhost"
            >
              Reject
            </Button>
          </div>
          {status ? <Notice role="status">{status}</Notice> : null}
        </div>
      ) : null}
    </Card>
  );
}

export function MediaReviewPanel({
  runSelected = decideSelectedReviews,
}: { runSelected?: typeof decideSelectedReviews } = {}) {
  const access = useQuery(api.profileMediaSubmissions.getReviewAccess);
  const [profileId, setProfileId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [selected, setSelected] = useState<ReviewDecision[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [receipts, setReceipts] = useState<
    Array<CommandReceipt & { decision?: "approve" | "reject" }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const decide = useMutation(api.profileMediaSubmissions.decideWithReceipt);
  const assignments = usePaginatedQuery(
    api.profileMediaSubmissions.assignedReviewBatches,
    access?.canReviewMedia ? {} : "skip",
    { initialNumItems: 40 },
  );
  function select(input: ReviewDecision) {
    const parsed = reviewDecisionSchema.safeParse({
      ...input,
      publicReason: input.publicReason?.trim() || undefined,
    });
    if (!parsed.success) {
      setSelectionError("Decision failed.");
      return;
    }
    input = parsed.data;
    setSelectionError(null);
    setReceipts((previous) =>
      previous.filter((receipt) => receipt.resourceId !== input.submissionId),
    );
    setLabels((previous) => ({
      ...previous,
      [input.submissionId]:
        submissions.find((row) => row.submissionId === input.submissionId)
          ?.profileDisplayName ?? "Media",
    }));
    setSelected((previous) =>
      previous.some((p) => p.submissionId === input.submissionId)
        ? previous.map((p) =>
            p.submissionId === input.submissionId ? input : p,
          )
        : previous.length < 20
          ? [...previous, input]
          : previous,
    );
  }
  async function submitSelected() {
    setBusy(true);
    setSelectionError(null);
    try {
      const result = await runSelected({ decisions: selected }, (input) =>
        decide({
          ...input,
          submissionId: input.submissionId as Id<"profileMediaSubmissions">,
        }),
      );
      setReceipts(
        result.receipts.map((receipt, index) => ({
          ...receipt,
          decision: selected[index]!.decision,
        })),
      );
      const committed = new Set(
        result.receipts.flatMap((r, i) =>
          r.operationState === "committed" ? [selected[i]!.idempotencyKey] : [],
        ),
      );
      setSelected((previous) =>
        previous.filter((p) => !committed.has(p.idempotencyKey)),
      );
    } catch {
      setSelectionError("Decision failed.");
    } finally {
      setBusy(false);
    }
  }
  const [queueStatus, setQueueStatus] = useState<
    "submitted" | "under_review" | "approved" | "rejected"
  >("submitted");
  const [cleanupStatus, setCleanupStatus] = useState<string | null>(null);
  const effectiveProfileId =
    profileId ||
    (access && !access.superAdmin ? (access.profiles[0]?.profileId ?? "") : "");
  const reviewQueryArgs =
    access === undefined
      ? "skip"
      : batchId
        ? { batchId: batchId as Id<"contributionBatches">, status: queueStatus }
        : access.superAdmin && profileId === ""
          ? { status: queueStatus }
          : effectiveProfileId
            ? {
                profileId: effectiveProfileId as Id<"profiles">,
                status: queueStatus,
              }
            : "skip";
  const {
    results: submissions,
    status: paginationStatus,
    loadMore,
  } = usePaginatedQuery(
    api.profileMediaSubmissions.listForReview,
    reviewQueryArgs,
    { initialNumItems: 40 },
  );

  async function cleanDueFiles() {
    setCleanupStatus(null);
    const response = await fetch("/api/account/media-review/cleanup", {
      method: "POST",
    });
    const result = (await response.json().catch(() => null)) as {
      completed?: number;
      error?: string;
    } | null;
    setCleanupStatus(
      response.ok
        ? `${result?.completed ?? 0} candidate files deleted.`
        : (result?.error ?? "Cleanup failed."),
    );
  }

  return (
    <main className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle>Media review</SectionTitle>
        <div className="flex flex-wrap items-end gap-3">
          {access?.canReviewMedia ? (
            <Field>
              Collection
              <Select
                value={batchId}
                onChange={(event) => setBatchId(event.target.value)}
              >
                <option value="">None</option>
                {assignments.results.map((batch) => (
                  <option key={batch.batchId} value={batch.batchId}>
                    {batch.label}
                  </option>
                ))}
              </Select>
              {assignments.status === "CanLoadMore" ? (
                <Button
                  onClick={() => assignments.loadMore(40)}
                  type="button"
                  variant="ghost"
                >
                  Load more
                </Button>
              ) : null}
            </Field>
          ) : null}
          {access && (access.superAdmin || access.profiles.length > 1) ? (
            <Field className="min-w-64">
              Queue
              <Select
                onChange={(event) => setProfileId(event.target.value)}
                value={effectiveProfileId}
              >
                {access.superAdmin ? (
                  <option value="">All profiles</option>
                ) : null}
                {access.profiles.map((profile) => (
                  <option key={profile.profileId} value={profile.profileId}>
                    {profile.displayName}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field>
            Status
            <Select
              onChange={(event) =>
                setQueueStatus(
                  event.target.value as
                    | "submitted"
                    | "under_review"
                    | "approved"
                    | "rejected",
                )
              }
              value={queueStatus}
            >
              <option value="submitted">Submitted</option>
              <option value="under_review">Under review</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </Select>
          </Field>
          {access?.superAdmin ? (
            <Button
              onClick={() => void cleanDueFiles()}
              type="button"
              variant="ghost"
            >
              Clean due files
            </Button>
          ) : null}
        </div>
      </div>
      {cleanupStatus ? <Notice role="status">{cleanupStatus}</Notice> : null}
      {access === undefined || paginationStatus === "LoadingFirstPage" ? (
        <p aria-busy="true" className="text-sm text-muted">
          Loading…
        </p>
      ) : null}
      {access &&
      !access.superAdmin &&
      !access.canReviewMedia &&
      access.profiles.length === 0 ? (
        <Notice variant="warning">
          Profile media review access is required.
        </Notice>
      ) : null}
      {submissions.length === 0 && paginationStatus === "Exhausted" ? (
        <Notice>No results</Notice>
      ) : null}
      {selectionError ? (
        <Notice role="status" variant="warning">
          {selectionError}
        </Notice>
      ) : null}
      <ReviewSelection
        labels={labels}
        selected={selected}
        receipts={receipts}
        busy={busy}
        submit={() => void submitSelected()}
        remove={(id) =>
          setSelected((previous) =>
            previous.filter((p) => p.submissionId !== id),
          )
        }
      />
      <div className="grid gap-4">
        {submissions.map((row) => (
          <ReviewCard
            key={row.submissionId}
            row={row}
            select={select}
            selected={selected.find((p) => p.submissionId === row.submissionId)}
          />
        ))}
      </div>
      {paginationStatus === "CanLoadMore" ? (
        <Button onClick={() => loadMore(40)} type="button" variant="ghost">
          Load more
        </Button>
      ) : null}
    </main>
  );
}

export function ReviewSelection({
  labels,
  selected,
  receipts,
  busy,
  submit,
  remove,
}: {
  labels: Record<string, string>;
  selected: ReviewDecision[];
  receipts: Array<CommandReceipt & { decision?: "approve" | "reject" }>;
  busy: boolean;
  submit: () => void;
  remove: (id: string) => void;
}) {
  if (!selected.length && !receipts.length) return null;
  return (
    <Card>
      <SectionTitle>Selected ({selected.length}/20)</SectionTitle>
      <ul className="mt-4 grid gap-3">
        {selected.map((input) => (
          <li
            className="flex min-w-0 flex-wrap items-center gap-3 text-sm"
            key={input.submissionId}
          >
            <span className="break-all">
              {labels[input.submissionId] ?? "Media"}
            </span>
            <span>{input.decision === "approve" ? "Approve" : "Reject"}</span>
            <Button
              disabled={busy}
              onClick={() => remove(input.submissionId)}
              type="button"
              variant="ghost"
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <Button
        className="mt-4"
        disabled={busy || !selected.length}
        onClick={submit}
        type="button"
        variant="primary"
      >
        Decide selected
      </Button>
      {receipts.map((receipt) => (
        <p
          role="status"
          className="mt-3 break-words text-sm"
          key={receipt.operationId}
        >
          {labels[receipt.resourceId ?? ""] ?? "Media"}:{" "}
          {reviewDecisionMessage(receipt, receipt.decision).message}
        </p>
      ))}
    </Card>
  );
}
