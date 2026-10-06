"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex-generated-api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { publishedContributionDetailSchema, contributionManageCommandSchema, contributionPlacementCommandSchema, contributionCommandBaseSchema, type PublishedContributionDetail, type CommandReceipt, type ContributionManageCommand, type ContributionPlacementCommand, type ContributionCommandBase } from "@vrdex/api-contracts";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { reviewDecisionMessage } from "../media-review/media-review-view";

type Pending = { kind: "manage"; input: ContributionManageCommand } | { kind: "place"; input: ContributionPlacementCommand } | { kind: "propose"; input: ContributionCommandBase };
export function PublishedContributionCard({ submissionId }: { submissionId: Id<"profileMediaSubmissions"> }) {
  const detail = useQuery(api.profileMediaSubmissions.contributionDetail, { submissionId });
  const manage = useMutation(api.profileMediaSubmissions.manageContribution);
  const place = useMutation(api.profileMediaSubmissions.placeContribution);
  const propose = useMutation(api.profileMediaSubmissions.proposePlacement);
  return <PublishedContributionCardView submissionId={submissionId} detail={detail} manage={input => manage({ ...input, submissionId })} place={input => place({ ...input, submissionId })} propose={input => propose({ ...input, submissionId })} />;
}
export function PublishedContributionCardView({ submissionId, detail, manage, place, propose }: {
  submissionId: string;
  detail: PublishedContributionDetail | null | undefined;
  manage: (input: ContributionManageCommand) => Promise<CommandReceipt>;
  place: (input: ContributionPlacementCommand) => Promise<CommandReceipt>;
  propose: (input: ContributionCommandBase) => Promise<CommandReceipt>;
}) {
  const storageKey = `vrdex:contribution:${submissionId}`;
  const draftKey = `${storageKey}:draft`;
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PublishedContributionDetail["metadata"] | null>(null);
  const [removed, setRemoved] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as Pending | null;
      const parsed = saved?.kind === "manage" ? contributionManageCommandSchema.safeParse(saved.input) : saved?.kind === "place" ? contributionPlacementCommandSchema.safeParse(saved.input) : saved?.kind === "propose" ? contributionCommandBaseSchema.safeParse(saved.input) : null;
      const savedDraft = publishedContributionDetailSchema.shape.metadata.safeParse(JSON.parse(sessionStorage.getItem(draftKey) ?? "null"));
      queueMicrotask(() => {
        if (parsed?.success && parsed.data.submissionId === submissionId) { setPending(saved); setMessage("Outcome unknown"); }
        if (savedDraft.success) { setDraft(savedDraft.data); setEditing(true); }
      });
    } catch { /* Corrupt local state cannot authorize a command. */ }
    queueMicrotask(() => setReady(true));
  }, [storageKey, draftKey, submissionId]);
  async function run(command: Pending) {
    if (!ready || busy) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify(command)); } catch { setMessage("Submission failed"); return; }
    setPending(command);
    setBusy(true);
    try {
      const receipt = command.kind === "manage" ? await manage(command.input) : command.kind === "place" ? await place(command.input) : await propose(command.input);
      setMessage(receipt.operationState === "committed" ? command.kind === "propose" ? "Submitted" : command.kind === "manage" ? command.input.action === "remove" ? "Removed" : "Saved" : command.input.action === "clear_primary" ? "Cleared" : "Selected" : reviewDecisionMessage(receipt).message);
      if (receipt.operationState !== "in_progress") { sessionStorage.removeItem(storageKey); setPending(null); }
      if (receipt.operationState === "committed" && command.kind === "manage") {
        sessionStorage.removeItem(draftKey);
        setDraft(null);
        setEditing(false);
        if (command.input.action === "remove") setRemoved(true);
      }
    } catch { setMessage("Outcome unknown"); }
    finally { setBusy(false); }
  }
  function base() { return { submissionId, expectedContributionVersion: detail!.contributionVersion, idempotencyKey: crypto.randomUUID() }; }
  function update(name: keyof PublishedContributionDetail["metadata"], value: string) {
    const next = { ...(draft ?? detail!.metadata), [name]: value };
    setDraft(next);
    try { sessionStorage.setItem(draftKey, JSON.stringify(next)); } catch { setMessage("Submission failed"); }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!detail || !draft || pending || busy || !detail.canEditMetadata) return;
    const metadata = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value?.trim() || null]));
    void run({ kind: "manage", input: { ...base(), action: "update_metadata", metadata } });
  }
  const locked = !ready || busy || pending !== null;
  if (removed) return <Notice role="status">Removed</Notice>;
  if (detail === undefined) return <p className="mt-5 text-sm text-muted" aria-busy="true">Loading…</p>;
  if (!detail && !pending) return null;
  return <div className="mt-5 grid gap-4">
    {detail ? <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="h-64 w-full rounded-card bg-surface-raised object-contain" src={`/api/v0/profiles/${encodeURIComponent(detail.profileSlug)}/assets/${encodeURIComponent(detail.assetId)}/file`} alt={detail.metadata.altText || detail.metadata.label} />
      <h3 className="font-medium">{detail.metadata.label}</h3>
      <p className="break-words text-sm">{detail.metadata.credit}</p>
      {detail.metadata.sourceUrl ? <a className="w-fit break-words text-sm underline [overflow-wrap:anywhere]" href={detail.metadata.sourceUrl} target="_blank" rel="noreferrer">{detail.metadata.sourceDescription || "Open source"}</a> : <p className="break-words text-sm text-muted [overflow-wrap:anywhere]">{detail.metadata.sourceDescription}</p>}
      <div className="flex flex-wrap gap-2">
        {detail.canSelectPrimary ? <Button type="button" disabled={locked} onClick={() => void run({ kind: "place", input: { ...base(), action: "select_primary" } })}>Select picture</Button> : null}
        {detail.canClearPrimary ? <Button type="button" variant="ghost" disabled={locked} onClick={() => void run({ kind: "place", input: { ...base(), action: "clear_primary" } })}>Clear picture</Button> : null}
        {detail.canProposePlacement ? <Button type="button" variant="ghost" disabled={locked} onClick={() => void run({ kind: "propose", input: base() })}>Request replacement</Button> : null}
        {detail.canEditMetadata ? <Button type="button" variant="ghost" disabled={locked} onClick={() => { setDraft(draft ?? detail.metadata); setEditing(true); }}>Edit metadata</Button> : null}
        {detail.canRemove ? <Button type="button" variant="dangerGhost" disabled={locked} onClick={() => void run({ kind: "manage", input: { ...base(), action: "remove" } })}>Remove</Button> : null}
      </div>
      {editing && draft ? <form className="grid gap-4" onSubmit={save}>
        <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
          <Field>Title<Input required maxLength={80} value={draft.label} onChange={e => update("label", e.target.value)} /></Field>
          <Field>Credit<Input required maxLength={120} value={draft.credit} onChange={e => update("credit", e.target.value)} /></Field>
          <Field>Credit URL<Input type="url" maxLength={4096} value={draft.creditUrl ?? ""} onChange={e => update("creditUrl", e.target.value)} /></Field>
          <Field>Source URL<Input type="url" maxLength={4096} value={draft.sourceUrl ?? ""} onChange={e => update("sourceUrl", e.target.value)} /></Field>
          <Field>Alt text<Input maxLength={180} value={draft.altText ?? ""} onChange={e => update("altText", e.target.value)} /></Field>
          <Field>Source description<Textarea maxLength={1000} rows={3} value={draft.sourceDescription ?? ""} onChange={e => update("sourceDescription", e.target.value)} /></Field>
        </fieldset>
        <div className="flex gap-2"><Button type="submit" disabled={locked || !detail.canEditMetadata}>Save</Button><Button type="button" variant="ghost" disabled={locked} onClick={() => { setEditing(false); setDraft(null); sessionStorage.removeItem(draftKey); }}>Cancel</Button></div>
      </form> : null}
    </> : null}
    {message ? <Notice role="status">{message}</Notice> : null}
    {pending ? <Button className="w-fit" type="button" disabled={busy} onClick={() => void run(pending)}>Retry</Button> : null}
  </div>;
}
