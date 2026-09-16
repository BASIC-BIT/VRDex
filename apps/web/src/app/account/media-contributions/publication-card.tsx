"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex-generated-api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import type {
  CommandReceipt,
  MediaPublication,
  PublicationEvidence,
  ReviewDetail,
} from "@vrdex/api-contracts";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { MediaReviewComparison } from "@/components/media-review-comparison";
import {
  reviewDecisionMessage,
  reviewPlacementImage,
} from "../media-review/media-review-view";

export function PublicationCard({
  submissionId,
  onPendingChange,
}: {
  submissionId: Id<"profileMediaSubmissions">;
  onPendingChange?: (pending: boolean) => void;
}) {
  const detail = useQuery(api.profileMediaSubmissions.publisherDetail, {
    submissionId,
  });
  const declare = useMutation(
    api.profileMediaSubmissions.declarePublicationEvidence,
  );
  const publish = useMutation(api.profileMediaSubmissions.publish);
  return (
    <PublicationCardView
      detail={detail}
      declare={(input) => declare({ ...input, submissionId })}
      publish={(input) => publish({ ...input, submissionId })}
      onPendingChange={onPendingChange}
    />
  );
}
const declarations = {
  identityConfirmed: "Identity confirmed",
  attributionConfirmed: "Attribution confirmed",
  publicationPermitted: "Publication permitted",
  noKnownRestrictions: "No known restrictions",
} as const;
export function PublicationCardView({
  detail,
  declare,
  publish,
  onPendingChange,
}: {
  detail: ReviewDetail | null | undefined;
  declare: (input: PublicationEvidence) => Promise<CommandReceipt>;
  publish: (input: MediaPublication) => Promise<CommandReceipt>;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [confirmed, setConfirmed] = useState({
    identityConfirmed: false,
    attributionConfirmed: false,
    publicationPermitted: false,
    noKnownRestrictions: false,
  });
  const [reviewOnly, setReviewOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    kind: "declare" | "publish";
    input: PublicationEvidence | MediaPublication;
  } | null>(null);
  if (!detail) return null;
  const current = detail;
  async function command(kind: "declare" | "publish") {
    setBusy(true);
    const input =
      pending?.kind === kind
        ? pending.input
        : {
            submissionId: current.submissionId,
            expectedReviewVersion: current.reviewVersion,
            idempotencyKey: crypto.randomUUID(),
            ...(kind === "declare" ? confirmed : {}),
          };
    setPending({ kind, input });
    onPendingChange?.(true);
    try {
      const receipt =
        kind === "declare"
          ? await declare(input as PublicationEvidence)
          : await publish(input);
      setMessage(
        receipt.operationState === "committed"
          ? kind === "declare"
            ? "Confirmed"
            : "Published"
          : receipt.code === "independent_review_required"
            ? "Independent review required"
            : reviewDecisionMessage(receipt).message,
      );
      if (receipt.operationState !== "in_progress") {
        setPending(null);
        onPendingChange?.(false);
      }
    } catch {
      setMessage("Outcome unknown");
    } finally {
      setBusy(false);
    }
  }
  if (reviewOnly)
    return (
      <div className="mt-5 flex items-center gap-3">
        <span className="text-sm text-muted">Independent review</span>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setReviewOnly(false)}
        >
          Inspect
        </Button>
      </div>
    );
  return (
    <div className="mt-5 grid gap-4">
      <MediaReviewComparison
        candidateAlt={current.altText ?? "Candidate"}
        currentAlt="Current image"
        currentSrc={reviewPlacementImage(current)}
        candidateSrc={
          current.candidate.rendition
            ? `/api/account/media-contributions/submissions/${encodeURIComponent(current.submissionId)}/file?version=${encodeURIComponent(current.reviewVersion)}`
            : null
        }
      />
      <p className="break-words text-sm text-muted">
        {current.sourceDescription ?? current.sourceUrl}
      </p>
      <fieldset
        className="grid gap-2 text-sm"
        disabled={busy || pending !== null}
      >
        {Object.entries(declarations).map(([name, label]) => (
          <label key={name} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={confirmed[name as keyof typeof confirmed]}
              onChange={(event) =>
                setConfirmed({ ...confirmed, [name]: event.target.checked })
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={
            busy || pending !== null || !Object.values(confirmed).every(Boolean)
          }
          onClick={() => void command("declare")}
        >
          Confirm evidence
        </Button>
        <Button
          type="button"
          disabled={busy || pending !== null}
          onClick={() => void command("publish")}
        >
          Publish
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy || pending !== null}
          onClick={() => setReviewOnly(true)}
        >
          Independent review
        </Button>
      </div>
      {message ? <Notice>{message}</Notice> : null}
      {pending ? (
        <Button
          disabled={busy}
          type="button"
          onClick={() => void command(pending.kind)}
        >
          Retry
        </Button>
      ) : null}
    </div>
  );
}
