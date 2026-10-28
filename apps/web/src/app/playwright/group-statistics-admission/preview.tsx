"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ConvexProvider, type ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import type { StatisticsAdmissionView } from "../../../../../../convex/_groupAdmission";
import { type AdmissionActions } from "../../_components/group-statistics-admission";
import { ProfilePublicPage } from "../../_components/profile-public-page";

const profileId = "fixture-profile" as Id<"profiles">;
const accountId = "fixture-account" as Id<"collectorAccounts">;
const integrationId = "fixture-integration" as Id<"communityVrchatIntegrations">;
const initial: StatisticsAdmissionView = { eligible: true, groupName: "Afterglow VRChat Group", vrchatGroupId: "grp_00000000-0000-4000-8000-000000000005", groupMetadata: { visibility: "public", joinPolicy: "request" }, metadataObservedAt: Date.now(), bot: { collectorAccountId: accountId, accountAlias: "Collector One", vrchatUserId: "usr_00000000-0000-4000-8000-000000000005", profileUrl: "https://vrchat.com/home/user/usr_00000000-0000-4000-8000-000000000005" } };
function grant(view: StatisticsAdmissionView, phase: "pending" | "paused" | "ended" = "pending"): StatisticsAdmissionView {
  return { ...view, integrationId, statisticsAdmission: { authorizedAt: Date.now(), actor: { tokenIdentifier: "fixture|admin", issuer: "fixture", subject: "admin" }, reason: "Public aggregate statistics", collectorAccountId: accountId, epochStartedAt: Date.now(), phase, membershipOrigin: "admission", lastCheckedAt: Date.now(), ...(view.groupMetadata?.joinPolicy === "invite" ? { joinPolicy: "invite" } : { joinPolicy: "request", operation: { kind: "request", startedAt: Date.now(), outcome: "confirmed" } }) } };
}
export function AdmissionPreview() {
  const [view, setView] = useState<StatisticsAdmissionView | null>(null);
  const [state, setState] = useState("");
  const [calls, setCalls] = useState<string[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => {
    const state = new URLSearchParams(location.search).get("state") ?? "request"; setState(state);
    let next: StatisticsAdmissionView | null = { ...initial, metadataObservedAt: Date.now() };
    if (state === "non-admin") next = null;
    else if (state === "invite") next = { ...next, groupMetadata: { visibility: "public", joinPolicy: "invite" } };
    else if (state === "stale") next = { ...next, eligible: false, blockReason: "metadata_refresh_required", metadataObservedAt: Date.now() - 7 * 60_000 };
    else if (state === "no-capacity") next = { ...next, eligible: false, blockReason: "account_capacity" };
    else if (state === "paused" || state === "ended") next = grant(next, state);
    else if (sessionStorage.getItem(`admission-${state}`) || state === "cleanup_pending") next = grant(next);
    if (next?.statisticsAdmission && state === "cleanup_pending") next.statisticsAdmission = { ...next.statisticsAdmission, phase: "cleanup_pending", revokedAt: Date.now(), operation: { kind: "withdraw_request", startedAt: Date.now(), outcome: "uncertain" }, joinPolicy: "request" };
    setView(next);
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  const actions: AdmissionActions = {
    admit: async args => {
      setCalls(c => [...c, "admit"]);
      await new Promise(resolve => setTimeout(resolve, 250));
      if (state === "changed") { setView(v => v && { ...v, bot: v.bot && { ...v.bot, accountAlias: "Collector Two", collectorAccountId: "fixture-second-account" as Id<"collectorAccounts"> } }); throw new Error("Refresh required: preview_changed."); }
      if (args.expectedVrchatGroupId !== initial.vrchatGroupId || args.expectedCollectorAccountId !== accountId || !args.reason.trim()) throw new Error("Fixture identity mismatch");
      sessionStorage.setItem(`admission-${state}`, "pending"); setView(v => v && grant(v));
    },
    check: async () => { setCalls(c => [...c, "check"]); },
    cancel: async () => { setCalls(c => [...c, "cancel"]); setView(v => v?.statisticsAdmission ? { ...v, eligible: false, blockReason: "cleanup_required", statisticsAdmission: { ...v.statisticsAdmission, phase: "cleanup_pending", revokedAt: Date.now() } } : v); },
    refresh: async () => { setCalls(c => [...c, "refresh"]); },
  };
  const current = useRef({ view, actions });
  useEffect(() => { current.current = { view, actions }; });
  const listeners = useMemo(() => new Set<() => void>(), []);
  useEffect(() => { for (const listener of listeners) listener(); }, [view, listeners]);
  const client = useMemo(() => ({
    watchQuery(query: FunctionReference<"query">) {
      const name = getFunctionName(query);
      return { localQueryResult: () => {
        if (name === "seedAccess:withheldProfileRecord") return null;
        if (name === "groupObservations:getStatisticsAdmission") return current.current.view;
        throw new Error(`Unexpected fixture query: ${name}`);
      }, onUpdate: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, journal: () => undefined };
    },
    mutation(query: FunctionReference<"mutation">, args: Parameters<AdmissionActions["admit"]>[0]) {
      switch (getFunctionName(query)) {
        case "groupObservations:admitStatistics": return current.current.actions.admit(args);
        case "groupObservations:checkStatisticsAdmission": return current.current.actions.check({ integrationId, admissionAt: current.current.view?.statisticsAdmission?.authorizedAt ?? 0 });
        case "groupObservations:cancelStatisticsAdmission": return current.current.actions.cancel({ integrationId, admissionAt: current.current.view?.statisticsAdmission?.authorizedAt ?? 0 });
        case "groupObservations:refreshStatisticsMetadata": return current.current.actions.refresh();
        default: throw new Error("Unexpected fixture mutation");
      }
    },
  }) as unknown as ConvexReactClient, [listeners]);
  return <ConvexProvider client={client}><ProfilePublicPage mediaKitGalleryEnabled={false} profile={{ id: profileId, slug: "afterglow-social", displayName: "Afterglow Social", profileType: "community", community: { categoryTags: [] }, trustLabel: "unclaimed", aliases: [], tags: [], genres: [], outboundLinks: [], worldCredits: [], upcomingEvents: [], hostedEvents: [] }} /><output data-testid="calls" className="sr-only">{calls.join(",")}</output></ConvexProvider>;
}
