"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex-generated-api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { mediaPublicationSchema, type CommandReceipt, type MediaPublication, type ReviewDetail } from "@vrdex/api-contracts";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { reviewDecisionMessage } from "../media-review/media-review-view";

export function PublicationCard({ submissionId, onPendingChange }: {
  submissionId: Id<"profileMediaSubmissions">;
  onPendingChange?: (pending: boolean) => void;
}) {
  const detail = useQuery(api.profileMediaSubmissions.publisherDetail, { submissionId });
  const publish = useMutation(api.profileMediaSubmissions.publish);
  return <PublicationCardView submissionId={submissionId} detail={detail} publish={input => publish({ ...input, submissionId })} onPendingChange={onPendingChange} />;
}

export function PublicationCardView({ detail, submissionId = detail?.submissionId, publish, onPendingChange }: {
  detail: ReviewDetail | null | undefined;
  submissionId?: string;
  publish: (input: MediaPublication) => Promise<CommandReceipt>;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [reviewOnly, setReviewOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<MediaPublication | null>(null);
  const storageKey = `vrdex:publication:${submissionId}`;
  useEffect(() => {
    let recovered: MediaPublication | null = null;
    try {
      const value = mediaPublicationSchema.safeParse(JSON.parse(sessionStorage.getItem(storageKey) ?? "null"));
      if (value.success && value.data.submissionId === submissionId) recovered = value.data;
    } catch { /* A new decision is safe only when no command was stored. */ }
    queueMicrotask(() => { if (recovered) { setPending(recovered); setMessage("Outcome unknown"); } setReady(true); });
  }, [storageKey, submissionId]);

  async function command() {
    if (!ready || busy || (!pending && !detail)) return;
    const input = pending ?? { submissionId: detail!.submissionId, expectedReviewVersion: detail!.reviewVersion, idempotencyKey: crypto.randomUUID() };
    // Store before sending, so reload and a lost response replay this exact command.
    try { sessionStorage.setItem(storageKey, JSON.stringify(input)); } catch { setMessage("Submission failed"); return; }
    setPending(input);
    onPendingChange?.(true);
    setBusy(true);
    try {
      const receipt = await publish(input);
      setMessage(receipt.operationState === "committed" ? "Published" : receipt.code === "independent_review_required" ? "Independent review required" : reviewDecisionMessage(receipt).message);
      if (receipt.operationState !== "in_progress") {
        sessionStorage.removeItem(storageKey);
        setPending(null);
        onPendingChange?.(false);
      }
    } catch { setMessage("Outcome unknown"); }
    finally { setBusy(false); }
  }
  if (!detail) return null;
  if (reviewOnly) return <div className="mt-5 flex items-center gap-3"><span className="text-sm text-muted">Independent review</span><Button type="button" variant="ghost" onClick={() => setReviewOnly(false)}>Inspect</Button></div>;
  return <div className="mt-5 grid gap-4">
    {detail.candidate.rendition ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img className="h-64 w-full rounded-card bg-surface-raised object-contain" alt={detail.altText || "Candidate"} src={`/api/account/media-contributions/submissions/${encodeURIComponent(detail.submissionId)}/file?version=${encodeURIComponent(detail.reviewVersion)}`} />
    ) : <Notice>Unavailable</Notice>}
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div><dt className="text-muted">Destination</dt><dd>Media kit</dd></div>
      <div><dt className="text-muted">Credit</dt><dd className="break-words">{detail.credit}</dd></div>
      <div className="min-w-0 sm:col-span-2"><dt className="text-muted">Source</dt><dd className="break-words [overflow-wrap:anywhere]">{detail.sourceUrl ? <a href={detail.sourceUrl} rel="noreferrer" target="_blank" className="underline">{detail.sourceDescription || "Open source"}</a> : detail.sourceDescription}</dd></div>
    </dl>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="primary" disabled={!ready || busy || pending !== null} onClick={() => void command()}>Publish</Button>
      <Button type="button" variant="ghost" disabled={!ready || busy || pending !== null} onClick={() => setReviewOnly(true)}>Independent review</Button>
    </div>
    {message ? <Notice role="status">{message}</Notice> : null}
    {pending ? <Button className="w-fit" type="button" disabled={busy} onClick={() => void command()}>Retry</Button> : null}
  </div>;
}
