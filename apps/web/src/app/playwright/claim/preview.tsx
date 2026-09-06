"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useState } from "react";
import type { Id } from "../../../../../../convex/_generated/dataModel";

import { ClaimFlowContent } from "@/app/claim/[slug]/claim-flow";

const previewClient = new ConvexReactClient("https://playwright-preview.convex.cloud");
const completionPreviewClient = new ConvexReactClient("https://playwright-preview.convex.cloud");
// This gated fixture replaces only the external action result. The actual
// claim component handles the queued response and subsequent context update.
completionPreviewClient.action = async () => ({ state: "queued" } as never);

export function ClaimFlowPreview({
  discordLinked = true,
  privateProfile = false,
  vrclinkingConfigured = true,
  completionScenario,
}: {
  discordLinked?: boolean;
  privateProfile?: boolean;
  vrclinkingConfigured?: boolean;
  completionScenario?: string;
}) {
  const [completed, setCompleted] = useState(completionScenario === "returned");
  const completionDemo = completionScenario === "background" || completionScenario === "returned" || completionScenario === "remaining";
  return (
    <ConvexProvider client={completionDemo ? completionPreviewClient : previewClient}>
      {completionDemo ? <button type="button" onClick={() => setCompleted(true)}>Simulate collector completion</button> : null}
      <ClaimFlowContent
        initialAnalyticsJourneyId="00000000-0000-4000-8000-000000000001"
        reservedAnalyticsJourneyId="00000000-0000-4000-8000-000000000002"
        previewContext={{
          hasVerifiedVrchatConnection: completionScenario === "connected-unverified",
          viewerContextKey: "preview",
          emailVerified: true,
          // `hasDiscord` is a VRDex verification watermark, and only the
          // purpose-scoped OAuth round-trip writes one. Its false state is what
          // blocks the Discord and VRCLinking cards and surfaces the verify
          // affordance, so it needs to be reachable here.
          hasDiscord: discordLinked,
          // The visual route is the only place the method picker is
          // screenshotted, and the VRCLinking card renders on this flag alone.
          // Left out, the diff loop would keep asserting the pre-existing VRChat
          // UI and never see a change to the card that was added here.
          //
          // Toggleable because false is the repository default, and an owner on
          // a deployment without the adapter is the state where a Discord
          // affordance would unlock nothing visible.
          vrclinkingConfigured,
          ownership: privateProfile || completionDemo || completionScenario === "connected-unverified" ? "viewer" : "available",
          verified: privateProfile || completionDemo,
          pendingClaimRequest: null,
          pendingProof: completionDemo && (!completed || completionScenario === "remaining") ? {
            id: "fixture-proof" as Id<"profileVerificationAttempts">,
            targetType: "vrchat_user",
            targetExternalId: "usr_fixture",
            proofCode: "VRDEX-AAAAAAAAAAAA",
            expiresAt: 4_000_000_000_000,
            expired: false,
            analyticsJourneyId: "00000000-0000-4000-8000-000000000001",
          } : null,
          lastVerifiedProof: completed ? { at: 1, connectionOnly: true, targetType: "vrchat_user" } : null,
        }}
        profile={{
          displayName: "BASICBIT",
          hasPublicProfile: !privateProfile,
          profileId: "playwright-profile",
          profileType: "person",
          slug: "basicbit",
        }}
        source="profile"
      />
    </ConvexProvider>
  );
}
