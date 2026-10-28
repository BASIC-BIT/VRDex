"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { api } from "@convex-generated-api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { StatisticsAdmissionView } from "../../../../../convex/_groupAdmission";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";

type Admit = FunctionArgs<typeof api.groupObservations.admitStatistics>;
type Attempt = FunctionArgs<typeof api.groupObservations.checkStatisticsAdmission>;
export type AdmissionActions = {
  admit: (args: Admit) => Promise<unknown>;
  check: (args: Attempt) => Promise<unknown>;
  cancel: (args: Attempt) => Promise<unknown>;
  refresh: () => Promise<unknown>;
};

const blocks: Record<string, string> = {
  public_primary_reference_required: "Public primary group required",
  public_request_or_invite_required: "Public request or invite group required",
  metadata_refresh_required: "Refresh metadata required",
  conflicting_integration: "Conflicting connection",
  observation_stopped: "Statistics stopped",
  cleanup_required: "Cleanup required",
  fleet_unavailable: "Collector unavailable",
  automatic_limit: "No capacity",
  managed_priority: "Managed groups waiting",
  account_capacity: "No bot capacity",
};
const phases = {
  pending: "Waiting for approval", active: "Collecting", paused: "Paused", ended: "Ended",
  cleanup_pending: "Cleanup pending", cancelled: "Cancelled",
};
function timestamp(value: number | undefined) {
  return value === undefined ? "Not yet" : new Date(value).toLocaleString();
}

export function GroupStatisticsAdmissionPanel({ profileId, view, actions }: {
  profileId: Id<"profiles">;
  view: StatisticsAdmissionView | null | undefined;
  actions: AdmissionActions;
}) {
  const [review, setReview] = useState<StatisticsAdmissionView | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const section = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const title = useId();
  useEffect(() => {
    if (review && !dialog.current?.open) dialog.current?.showModal();
    else if (!review && dialog.current?.open) {
      const previousTrigger = trigger.current;
      dialog.current.close();
      // The subscribed view may replace the trigger after the mutation resolves.
      const frame = requestAnimationFrame(() => {
        if (document.activeElement === document.body || document.activeElement === previousTrigger || dialog.current?.contains(document.activeElement)) {
          (trigger.current ?? section.current?.querySelector<HTMLButtonElement>("[data-admission-check]"))?.focus();
        }
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [review]);
  if (!view) return null;
  const grant = view.statisticsAdmission;
  const bot = view.bot;
  const ongoing = grant && grant.phase !== "cancelled";
  const stale = view.metadataObservedAt === undefined || now - view.metadataObservedAt > 6 * 60_000 || view.metadataObservedAt > now + 30_000;
  const changed = review && (review.vrchatGroupId !== view.vrchatGroupId || review.bot?.collectorAccountId !== bot?.collectorAccountId || review.metadataObservedAt !== view.metadataObservedAt || !view.eligible || stale);
  async function run(action: () => Promise<unknown>, close = false) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try { await action(); if (close) { setReview(null); setReason(""); } }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save admission.");
      if (close) setReview(null);
    } finally { locked.current = false; setBusy(false); }
  }
  function confirm() {
    if (!review?.bot || !review.vrchatGroupId || review.metadataObservedAt === undefined || !reason.trim()) return;
    if (changed) { setReview(null); setError("Refresh required. Review the current group and bot."); return; }
    const selectedBot = review.bot;
    const selectedGroup = review.vrchatGroupId;
    const observedAt = review.metadataObservedAt;
    void run(() => actions.admit({ profileId, expectedVrchatGroupId: selectedGroup, expectedCollectorAccountId: selectedBot.collectorAccountId, expectedMetadataObservedAt: observedAt, reason: reason.trim() }), true);
  }
  const attempt = grant && view.integrationId ? { integrationId: view.integrationId, admissionAt: grant.authorizedAt } : null;
  const status = grant?.phase === "pending" && grant.joinPolicy === "invite" ? "Waiting for invitation" : grant ? phases[grant.phase] : "Not admitted";
  return <section ref={section} aria-label="Operator view: Group statistics" className="ph-no-capture border-t border-border py-8" data-ph-no-capture>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Group statistics</h2><span className="text-sm text-muted" role="status">{status}</span></div>
    <dl className="mt-5 grid min-w-0 gap-3 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
      <dt className="text-muted">Group</dt><dd className="min-w-0"><span>{view.groupName ?? "Unavailable"}</span><code className="mt-1 block break-all text-xs">{view.vrchatGroupId ?? "Unavailable"}</code></dd>
      <dt className="text-muted">Join policy</dt><dd className="capitalize">{view.groupMetadata?.joinPolicy ?? "Unknown"}</dd>
      <dt className="text-muted">Metadata checked</dt><dd>{timestamp(view.metadataObservedAt)}{view.metadataObservedAt !== undefined ? <span className="ml-2 text-muted">({Math.max(0, Math.floor((now - view.metadataObservedAt) / 60_000))} min)</span> : null}</dd>
      {bot ? <><dt className="text-muted">Assigned bot</dt><dd className="min-w-0"><span>{bot.accountAlias}</span><code className="mt-1 block break-all text-xs">{bot.vrchatUserId}</code><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => {
        void (async () => { try { await navigator.clipboard.writeText(bot.vrchatUserId); setCopied(true); setError(""); } catch { setCopied(false); setError("Could not copy bot ID."); } })();
      }}>{copied ? "Bot ID copied" : "Copy bot ID"}</Button><a className={buttonVariants({ size: "sm", variant: "secondary" })} href={`https://vrchat.com/home/user/${encodeURIComponent(bot.vrchatUserId)}`} target="_blank" rel="noreferrer">Open bot profile</a></div></dd></> : null}
      {grant ? <><dt className="text-muted">Authorized</dt><dd>{timestamp(grant.authorizedAt)}</dd><dt className="text-muted">Last inspection</dt><dd>{timestamp(grant.lastCheckedAt)}</dd><dt className="text-muted">Reason</dt><dd className="break-words">{grant.reason}</dd></> : null}
    </dl>
    {grant?.phase === "pending" && grant.joinPolicy === "invite" ? <p className="mt-4 text-sm">Ask a group admin to invite the displayed bot as an ordinary member.</p> : null}
    {ongoing ? <p className="mt-4 text-sm text-muted">{grant.phase === "cleanup_pending" ? "Statistics are hidden. Capacity stays reserved until cleanup is confirmed." : grant.phase === "pending" ? "Collection starts after membership is confirmed." : "Aggregate statistics only."}</p> : null}
    {grant?.phase === "cleanup_pending" && (grant.operation?.outcome === "uncertain" || grant.operation?.kind === "request") ? <p className="mt-3 text-sm">Inspect the assigned bot in VRChat. Withdraw a remaining request manually. Cleanup requires operator reconciliation before capacity can be released.</p> : null}
    {!ongoing && view.blockReason ? <p className="mt-4 text-sm text-muted">{blocks[view.blockReason] ?? "Admission unavailable"}</p> : null}
    <div className="mt-5 flex flex-wrap gap-2">
      {!ongoing ? <><button ref={trigger} className={buttonVariants()} disabled={!view.eligible || stale || !bot || busy} onClick={() => { setReview(view); setError(""); }}>{view.groupMetadata?.joinPolicy === "invite" ? "Assign bot" : "Request to join"}</button><Button variant="secondary" disabled={busy} onClick={() => void run(actions.refresh)}>Refresh metadata</Button></> : null}
      {attempt && grant?.phase !== "cancelled" ? <Button data-admission-check variant="secondary" disabled={busy} onClick={() => void run(() => actions.check(attempt))}>Check status</Button> : null}
      {attempt && grant?.revokedAt === undefined ? <Button variant="dangerGhost" disabled={busy} onClick={() => void run(() => actions.cancel(attempt))}>Cancel admission</Button> : null}
    </div>
    {error ? <p role="alert" className="mt-3 text-sm text-danger-strong">{error}</p> : null}
    <dialog ref={dialog} aria-labelledby={title} onCancel={event => { event.preventDefault(); if (!busy) setReview(null); }} onClose={() => setReview(null)} className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-panel border border-border bg-surface-strong p-5 text-foreground shadow-panel backdrop:bg-black/65 sm:p-6">
      <h2 id={title} className="text-xl font-semibold">{review?.groupMetadata?.joinPolicy === "invite" ? "Assign bot" : "Request to join"}</h2>
      <dl className="my-5 grid gap-2 text-sm"><dt className="text-muted">Group</dt><dd>{review?.groupName ?? "Unavailable"}</dd><dd className="break-all font-mono text-xs">{review?.vrchatGroupId}</dd><dt className="text-muted">Visibility / join policy</dt><dd className="capitalize">{review?.groupMetadata?.visibility} / {review?.groupMetadata?.joinPolicy}</dd><dt className="text-muted">Metadata checked</dt><dd>{timestamp(review?.metadataObservedAt)}</dd><dt className="text-muted">Bot</dt><dd>{review?.bot?.accountAlias}</dd><dd className="break-all font-mono text-xs">{review?.bot?.vrchatUserId}</dd></dl>
      <Field>Reason<Textarea maxLength={500} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} /></Field>
      {changed ? <p className="mt-3 text-sm" role="alert">Refresh required. Review the current group and bot.</p> : null}
      <div className="mt-5 flex flex-wrap justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={() => setReview(null)}>Back</Button><Button disabled={busy || !reason.trim() || !!changed} onClick={confirm}>{review?.groupMetadata?.joinPolicy === "invite" ? "Confirm assignment" : "Confirm request"}</Button></div>
    </dialog>
  </section>;
}

export function GroupStatisticsAdmission({ profileId }: { profileId: Id<"profiles"> }) {
  const { isAuthenticated } = useConvexAuth();
  const view = useQuery(api.groupObservations.getStatisticsAdmission, isAuthenticated ? { profileId } : "skip");
  const admit = useMutation(api.groupObservations.admitStatistics);
  const cancel = useMutation(api.groupObservations.cancelStatisticsAdmission);
  const check = useMutation(api.groupObservations.checkStatisticsAdmission);
  const refresh = useMutation(api.groupObservations.refreshStatisticsMetadata);
  return <GroupStatisticsAdmissionPanel profileId={profileId} view={view} actions={{ admit, cancel, check, refresh: () => refresh({ profileId }) }} />;
}
