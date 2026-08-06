"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { usePostHog } from "posthog-js/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { BadgeCheck, Building2, Link2, ShieldCheck, UserRound } from "lucide-react";

import { api } from "@convex-generated-api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { buttonVariants, Button } from "@/components/ui/button";
import { CopyValueRow } from "@/components/ui/copy-value-row";
import { ProfileAvatarImage } from "@/components/ui/profile-avatar-image";
import { Field, FieldText, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import type { AvatarAppearance } from "@/lib/avatar-appearance";
import { captureProductEvent, type ClaimAnalyticsMethod } from "@/lib/posthog";
import { claimErrorMessage, claimFailureOutcome } from "@/lib/claim-errors";
import { cn } from "@/lib/cn";
import {
  ownerProfileDestinationPath,
  profileClaimPath,
  type ClaimEntrySource,
  type DiscordVerifyStatus,
} from "@/lib/profile-claim";

type ProfileType = "person" | "community";
/**
 * `vrclinking` is person-only: it attests that the claimant's Discord identity
 * is linked to the VRChat account being claimed, which is a statement about a
 * person rather than about a community. `requireCompatibleProofTarget` enforces
 * the same rule server-side.
 */
type ClaimMethod = "discord" | "vrchat" | "vrclinking";
type ClaimProfile = {
  avatarImageUrl?: string;
  avatarAppearance?: AvatarAppearance;
  displayName: string;
  hasPublicProfile: boolean;
  profileId?: string;
  profileType: ProfileType;
  slug: string;
};
type Status =
  | { kind: "idle" }
  | { kind: "working"; message: string }
  | { kind: "notice"; message: string }
  | { kind: "error"; message: string }
  | { kind: "complete"; message: string; verified: boolean };

// Claim failures arrive as structured ConvexError codes; matching on message
// text no longer works because Convex redacts plain Error messages in
// production. See apps/web/src/lib/claim-errors.ts.
const errorMessage = claimErrorMessage;
const outcomeForError = claimFailureOutcome;

function MethodCard({
  active,
  children,
  disabled,
  title,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  disabled?: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-disabled={disabled || undefined}
      aria-pressed={active}
      className={cn(
        "min-h-28 rounded-card border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
        active ? "border-accent bg-accent/8" : "border-border bg-surface hover:border-border-strong",
        disabled ? "cursor-not-allowed opacity-55" : undefined,
      )}
      type="button"
      onClick={() => {
        if (!disabled) onClick();
      }}
    >
      <span className="block font-semibold">{title}</span>
      <span className="mt-2 block text-sm leading-6 text-muted">{children}</span>
    </button>
  );
}

const CONTROL_LEVEL_LABELS: Record<string, string> = {
  owner: "Owner",
  administrator: "Administrator",
  manager: "Manage Server",
  self: "You",
};

export function ClaimFlow({
  discordVerify = null,
  previewContext,
  profile,
  source,
}: {
  discordVerify?: DiscordVerifyStatus;
  previewContext?: {
    emailVerified: boolean;
    hasDiscord: boolean;
    vrclinkingConfigured?: boolean;
    ownership: "available" | "viewer" | "other";
    verified: boolean;
    pendingClaimRequest: null;
    pendingProof: null;
    lastVerifiedProof?: {
      at: number;
      connectionOnly: boolean;
      targetType: "vrclinking" | "vrchat_user" | "vrchat_group";
    } | null;
  };
  profile: ClaimProfile;
  source: ClaimEntrySource;
}) {
  const queriedContext = useQuery(
    api.profileClaims.getClaimJourneyContext,
    previewContext ? "skip" : { profileSlug: profile.slug },
  );
  const context = previewContext ?? queriedContext;
  const manageableGuilds = useQuery(
    api.discordVerification.getManageableGuilds,
    previewContext ? "skip" : {},
  );
  const claimPerson = useMutation(api.profileClaims.claimExistingPersonWithDiscord);
  const claimWithVerifiedGuild = useMutation(
    api.profileConnections.claimCommunityWithVerifiedGuild,
  );
  const startVrchatProof = useMutation(api.profileClaims.startVrchatProof);
  const cancelPending = useMutation(api.profileClaims.cancelClaimJourneyPending);
  const verifyDiscord = useAction(api.profileClaims.verifyDiscordCommunityAdminClaim);
  const verifyVrchat = useAction(api.profileClaims.verifyVrchatProofViaAdapter);
  const posthog = usePostHog();
  const [selectedMethod, setMethod] = useState<ClaimMethod | null>(
    previewContext
      ? profile.profileType === "community"
        ? "discord"
        : "vrchat"
      : null,
  );
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const statusRef = useRef<HTMLDivElement>(null);
  const completionRef = useRef<HTMLDivElement>(null);
  // A claim can complete without any handler running: the collector resolves a
  // VRChat attempt on its own schedule and the reactive context updates under a
  // user who never clicks again. Tracking completion only in the click handlers
  // therefore dropped the successful claims on the default production path.
  // `undefined` means no snapshot has been observed yet, which is a different
  // thing from `null` ("observed, and this account has no verified proof").
  // Collapsing the two suppressed the announcement for the case that matters
  // most: an account whose *first* collector proof resolves goes null → stamp.
  const [seenVerifiedProofAt, setSeenVerifiedProofAt] = useState<number | null | undefined>(
    undefined,
  );
  const [collectorCompletion, setCollectorCompletion] = useState<
    { verified: boolean; connectionOnly: boolean; method: ClaimAnalyticsMethod } | null
  >(null);
  // Only the person quick-claim needs Discord as a linked sign-in provider.
  // The community path claims against a control proof recorded by the
  // purpose-scoped OAuth round-trip, which a Google or email/password account
  // can complete just as well — gating it on `hasDiscord` let such a user
  // verify a server, see it in the picker, and then be unable to submit.
  const discordNeedsLinkedAccount = profile.profileType === "person";
  const discordMethodBlocked = discordNeedsLinkedAccount && !context?.hasDiscord;
  // VRCLinking answers from the claimant's Discord identity, so a linked
  // Discord account is not optional here the way it is for the community path.
  const vrclinkingMethodBlocked = !context?.hasDiscord;
  // Hidden, not disabled, where the deployment has no adapter: a disabled card
  // reads as "you are missing something" when the answer is that this
  // environment cannot consult VRCLinking at all.
  const vrclinkingAvailable =
    profile.profileType === "person" && context?.vrclinkingConfigured === true;
  const verifiedGuilds = manageableGuilds ?? [];
  const discordVerifyState = discordVerify;
  const discordVerifyHref = `/api/discord/verify/start?returnTo=${encodeURIComponent(
    profileClaimPath(profile.slug, source),
  )}`;
  const publicProfilePath = `/${profile.profileType === "community" ? "c" : "p"}/${profile.slug}`;
  const backPath = ownerProfileDestinationPath(profile, "/account");
  const appearancePath = profile.profileId
    ? `/account/appearance?profileId=${encodeURIComponent(profile.profileId)}`
    : "/account/appearance";
  const completionPath = ownerProfileDestinationPath(profile, appearancePath);
  const isUnverifiedViewer = context?.ownership === "viewer" && !context.verified;
  // A verified owner still needs this journey: it is the only surface that
  // creates a control proof, and `/account/connections` sends them here to make
  // one for a second VRChat group or account. Excluding them left that
  // instruction pointing at a page that rendered nothing but "already managed".
  const isVerifiedViewer = context?.ownership === "viewer" && context.verified;
  // The existing-owner upgrade branch renders VRChat and, when configured,
  // VRCLinking — never the Discord quick-claim, which has nothing to offer
  // someone who already owns the profile. The card grid below keys off the same
  // condition, so it also decides whether a Discord affordance is reachable.
  const isOwnerUpgradeBranch =
    (isUnverifiedViewer || isVerifiedViewer) && profile.profileType === "person";
  const canUseClaimJourney =
    context?.ownership === "available" || isUnverifiedViewer || isVerifiedViewer;
  // The OAuth round-trip remounts this component with no selection, so the
  // fallback is what an owner returning from Discord verification lands on. An
  // existing unverified owner picked Discord to get here; dropping them back on
  // the VRChat proof hides the server picker they just verified a server for.
  const method: ClaimMethod =
    selectedMethod ??
    (profile.profileType === "community" &&
    (context?.ownership === "available" || discordVerify === "verified")
      ? "discord"
      : "vrchat");

  useEffect(() => {
    captureProductEvent(posthog, "claim_journey_viewed", {
      profile_type: profile.profileType,
      source,
    });
  }, [posthog, profile.profileType, source]);

  useEffect(() => {
    if (status.kind === "error") statusRef.current?.focus();
    if (status.kind === "complete") completionRef.current?.focus();
  }, [status]);

  const observedContext = context ?? null;

  // The backend reports the verification as a fact; this only notices that it
  // is new. Inferring it from ownership, `verified`, and the pending row
  // disappearing was wrong four different ways — see `lastVerifiedProof` in
  // `getClaimJourneyContext`. Adjusting state during render is React's
  // supported way to react to a changed query value; an effect would mean a
  // synchronous setState and a cascading render.
  // A loading or skipped query is not a snapshot. Reading it as "no verified
  // proof" would make the first loaded value look like an advance and replay
  // the announcement for a proof that completed before this page opened.
  const verifiedProofAt =
    observedContext === null ? undefined : (observedContext.lastVerifiedProof?.at ?? null);

  if (verifiedProofAt !== seenVerifiedProofAt) {
    const previous = seenVerifiedProofAt;

    setSeenVerifiedProofAt(verifiedProofAt);

    // Only an advance counts, and only one observed on this page: arriving at a
    // profile whose proof completed earlier must not replay the announcement.
    if (
      previous !== undefined &&
      verifiedProofAt !== undefined &&
      verifiedProofAt !== null &&
      (previous === null || verifiedProofAt > previous)
    ) {
      setCollectorCompletion({
        verified: observedContext?.verified === true,
        connectionOnly: observedContext?.lastVerifiedProof?.connectionOnly === true,
        method:
          observedContext?.lastVerifiedProof?.targetType === "vrclinking" ? "vrclinking" : "vrchat",
      });
    }
  }

  useEffect(() => {
    if (collectorCompletion === null || collectorCompletion.connectionOnly) {
      // A connection-only proof changed no ownership, so counting it as a
      // completed claim would inflate the funnel with connection additions.
      return;
    }

    captureProductEvent(posthog, "claim_completed", {
      method: collectorCompletion.method,
      outcome: collectorCompletion.verified ? "claimed_verified" : "claimed_unverified",
      profile_type: profile.profileType,
    });
  }, [collectorCompletion, posthog, profile.profileType]);

  function selectMethod(nextMethod: ClaimMethod) {
    setMethod(nextMethod);
    setStatus({ kind: "idle" });
    // The form stays mounted after a collector-resolved completion, so without
    // this the latch from the first proof rejects every later transition: a
    // second proof would keep showing the first result and emit no event.
    setCollectorCompletion(null);
    captureProductEvent(posthog, "claim_method_selected", {
      method: nextMethod,
      profile_type: profile.profileType,
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    captureProductEvent(posthog, "claim_submitted", {
      method,
      profile_type: profile.profileType,
    });
    setCollectorCompletion(null);
    setStatus({
      kind: "working",
      message:
        method === "vrchat"
          ? "Creating your code…"
          : method === "vrclinking"
            ? "Asking VRCLinking…"
            : "Checking Discord access…",
    });

    try {
      // No code to post: the answer comes from a community's delegated key, so
      // the attempt is opened and consulted in one step rather than handing the
      // claimant something to go and do.
      if (method === "vrclinking") {
        const started = await startVrchatProof({
          profileSlug: profile.slug,
          targetType: "vrclinking",
          targetExternalId: String(form.get("targetExternalId") ?? ""),
        });

        await checkProof(started.attemptId, "vrclinking");
        return;
      }

      if (method === "vrchat") {
        await startVrchatProof({
          profileSlug: profile.slug,
          targetType: profile.profileType === "person" ? "vrchat_user" : "vrchat_group",
          targetExternalId: String(form.get("targetExternalId") ?? ""),
        });
        setStatus({ kind: "notice", message: "Your code is ready. Add it to VRChat below." });
        return;
      }

      if (profile.profileType === "person") {
        const result = await claimPerson({ profileSlug: profile.slug });
        const alreadyOwned = "state" in result && result.state === "already_owned";
        setStatus({
          kind: "complete",
          message: alreadyOwned ? "This profile is already yours." : "Done. This profile is yours to manage.",
          verified: false,
        });
      captureProductEvent(posthog, "claim_completed", {
          method,
          outcome: alreadyOwned ? "already_owned" : "claimed_unverified",
          profile_type: profile.profileType,
        });
        return;
      }

      // Control was already proved during the Discord OAuth round-trip, so
      // claiming is a single step: pair the existing proof with this profile.
      const result = await claimWithVerifiedGuild({
        profileSlug: profile.slug,
        guildId: String(form.get("discordGuildId") ?? ""),
      });
      // Server control is proved either way. Whether it verifies *this listing*
      // depends on the server already being on record for it, so report what the
      // claim actually produced rather than assuming the stronger outcome.
      const verified = result.claimState === "claimed_verified";
      // A null claim request means the mutation attached the server and changed
      // no ownership — this caller already owned the profile. Counting that as a
      // completed claim inflates the funnel with connection additions.
      const connectionOnly = result.claimRequestId === null;

      setStatus({
        kind: "complete",
        message: connectionOnly
          ? "That server is now connected to this profile."
          : verified
            ? "Verified. This community is yours."
            : "This community is yours. You can manage it now.",
        verified,
      });

      if (!connectionOnly) {
        captureProductEvent(posthog, "claim_completed", {
          method,
          outcome: verified ? "claimed_verified" : "claimed_unverified",
          profile_type: profile.profileType,
        });
      }
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
      captureProductEvent(posthog, "claim_failed", {
        method,
        outcome: outcomeForError(error),
        profile_type: profile.profileType,
      });
    }
  }

  // `proofMethod`, not the `method` state: this runs from the pending panel
  // after a reload, where nothing has been selected, and it settles the same
  // journey whose selected/submitted events already carry a method. Reporting
  // every terminal event as `vrchat` split each VRCLinking journey across two
  // methods and made method-level funnels wrong for both.
  async function checkProof(
    attemptId: Id<"profileVerificationAttempts">,
    proofMethod: ClaimAnalyticsMethod = "vrchat",
  ) {
    const viaVrclinking = proofMethod === "vrclinking";

    setStatus({
      kind: "working",
      message: viaVrclinking ? "Asking VRCLinking…" : "Looking for your code…",
    });
    try {
      const result = await verifyVrchat({ attemptId });
      if ("claimState" in result) {
        // Proving control of the target does not by itself establish that the
        // target is the one this listing represents, so report the state the
        // claim actually reached.
        const verified = result.claimState === "claimed_verified";
        // The backend classifies a proof that changed no ownership — an existing
        // owner proving another account or group — as connection-only. Reading
        // it as a fresh claim announced ownership the profile never changed
        // hands over, and counted a connection addition in the claim funnel.
        const connectionOnly = result.connectionOnly === true;

        setStatus({
          kind: "complete",
          message: connectionOnly
            ? "That account is now connected to this profile."
            : verified
              ? "Verified. This profile is yours."
              : "This profile is yours. You can manage it now.",
          verified,
        });
        // No `claim_completed` here. This same verification advances
        // `lastVerifiedProof`, so the observer below emits it — from the
        // backend's own classification, and for background collector
        // resolutions too. Emitting in both places counted every
        // adapter-resolved claim twice, and PostHog has no dedupe key to
        // collapse them.
      } else if (result.state === "verified") {
        // The collector fleet resolves attempts on its own schedule, so it may
        // have landed the verdict between render and this click. Reporting the
        // stale "we could not find the code yet" for an attempt that already
        // succeeded told users their completed claim had failed.
        //
        // Deliberately no `complete` status here: the action returns only the
        // attempt state, so this branch cannot tell a verified listing from one
        // the backend left `claimed_unverified`, and a `complete` status takes
        // precedence over the observer that does know. Clear the working state
        // and let `lastVerifiedProof` report the real outcome.
        setStatus({ kind: "idle" });
      } else if (result.state === "failed") {
        // A lost ownership race and a listing that stopped being claimable both
        // settle as `failed`, and neither is a negative attestation — the match
        // may have been found and the listing simply moved underneath it.
        // Reporting them as "no server confirmed your account" blamed the
        // claimant's linkage for something it had nothing to do with.
        const raced =
          "reason" in result && (result.reason === "already_owned" || result.reason === "not_claimable");

        setStatus({
          kind: "error",
          message: raced
            ? result.reason === "already_owned"
              ? "This profile already has an active owner."
              : "This listing is no longer available to claim."
            : viaVrclinking
              ? "No server we asked has your Discord linked to that VRChat account. Start over to try another method."
              : "That check did not pass. Start over to get a new code.",
        });
        captureProductEvent(posthog, "claim_failed", {
          method: proofMethod,
          // A lost race is a conflict, not a failed attestation. Counting it as
          // `not_verified` would read as VRCLinking rejecting claimants it
          // never actually rejected.
          outcome: raced ? "conflict" : "not_verified",
          profile_type: profile.profileType,
        });
      } else {
        const outcome =
          result.state === "expired"
            ? "expired"
            : result.state === "unavailable"
              ? "unavailable"
              : null;
        // `queued` means nothing was checked just now — VRDex reads VRChat on
        // its own schedule — so telling the user to go re-check where they put
        // the code would be wrong.
        setStatus(
          result.state === "queued"
            ? {
                kind: "notice",
                message:
                  "We are checking VRChat for your code. This page updates on its own, so you can leave and come back.",
              }
            : {
                kind: "error",
                message: result.state === "expired"
                  ? "That code expired. Start over to get a new one."
                  : result.state === "unavailable"
                    ? viaVrclinking
                      ? "We could not reach VRCLinking. Your attempt is still good. Try again in a minute."
                      : "We could not reach VRChat. Your code is still good. Try again in a minute."
                    : viaVrclinking
                      ? "No server we asked has your Discord linked to that VRChat account yet. Try again shortly, or use another method."
                      : "We have not found the code yet. Check that it is saved and visible to everyone, then check again.",
              },
        );
        if (outcome !== null) {
          captureProductEvent(posthog, "claim_failed", {
            method: proofMethod,
            outcome,
            profile_type: profile.profileType,
          });
        }
      }
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
      captureProductEvent(posthog, "claim_failed", {
        method: proofMethod,
        outcome: outcomeForError(error),
        profile_type: profile.profileType,
      });
    }
  }

  async function checkDiscord(requestId: Id<"profileClaimRequests">) {
    setStatus({ kind: "working", message: "Checking your Discord server permissions…" });
    try {
      const result = await verifyDiscord({ claimRequestId: requestId });
      if ("claimState" in result) {
        const verified = result.claimState === "claimed_verified";
        setStatus({
          kind: "complete",
          message: verified
            ? "Verified. This community is yours."
            : "This community is yours. You can manage it now.",
          verified,
        });
      captureProductEvent(posthog, "claim_completed", {
          method: "discord",
          outcome: verified ? "claimed_verified" : "claimed_unverified",
          profile_type: profile.profileType,
        });
      } else {
        setStatus({
          kind: "error",
          message:
            result.reason === "already_owned"
              ? "Someone else claimed this community while the check was running."
              : result.reason === "not_claimable"
                ? "This listing is no longer available to claim."
                : "We did not find Administrator access for you in that server. Check your role, then start over.",
        });
        if (result.state === "rejected") {
          captureProductEvent(posthog, "claim_failed", {
            method: "discord",
            outcome: "not_verified",
            profile_type: profile.profileType,
          });
        }
      }
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
      captureProductEvent(posthog, "claim_failed", {
        method: "discord",
        outcome: outcomeForError(error),
        profile_type: profile.profileType,
      });
    }
  }

  async function startOver(pendingType: "claim_request" | "proof") {
    setCollectorCompletion(null);
    setStatus({ kind: "working", message: "Canceling…" });
    try {
      const result = await cancelPending({ profileSlug: profile.slug, pendingType });

      // Nothing was cancelled, so the collector resolved the proof between the
      // click and this mutation. Say nothing and let the completion observer
      // report the real outcome; "Attempt canceled" would assert something that
      // did not happen.
      if (!result.canceled) {
        setStatus({ kind: "idle" });

        return;
      }

      setStatus({ kind: "notice", message: "Canceled. Pick a method to start again." });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  const vrchatMethodCard = (
    <MethodCard active={method === "vrchat"} title="Verify with VRChat" onClick={() => selectMethod("vrchat")}>
      <ShieldCheck aria-hidden="true" className="mb-2 size-5 text-accent" />
      Post a one-time code on your VRChat {profile.profileType === "person" ? "profile" : "group"}. Gives you ownership.
    </MethodCard>
  );
  const vrclinkingMethodCard = (
    <MethodCard
      active={method === "vrclinking"}
      disabled={vrclinkingMethodBlocked}
      title="Use VRCLinking"
      onClick={() => {
        if (!vrclinkingMethodBlocked) selectMethod("vrclinking");
      }}
    >
      <Link2 aria-hidden="true" className="mb-2 size-5 text-accent" />
      Ask a community that already links your Discord and VRChat accounts, instead of posting a
      code. Gives you ownership.
      {vrclinkingMethodBlocked ? " Verify your Discord account first." : ""}
    </MethodCard>
  );
  const discordMethodCard = (
    <MethodCard
      active={method === "discord"}
      disabled={discordMethodBlocked}
      title={profile.profileType === "person" ? "Use linked Discord" : "Verify Discord admin"}
      onClick={() => {
        if (!discordMethodBlocked) selectMethod("discord");
      }}
    >
      {profile.profileType === "person" ? <UserRound aria-hidden="true" className="mb-2 size-5 text-accent" /> : <Building2 aria-hidden="true" className="mb-2 size-5 text-accent" />}
      {profile.profileType === "person"
        ? "Quick access with your linked Discord. Claims the profile, but does not prove it is you."
        : "Confirm you own or manage the community’s Discord server. Gives you ownership."}
      {discordMethodBlocked ? " Verify your Discord account first." : ""}
    </MethodCard>
  );

  return (
    // The whole page, not the claim section alone. A claim page carries the
    // proof code, the target ids, and — for a draft, opted-out, or suppressed
    // profile — an identity nobody outside the account can see. Blocking one
    // region left the summary aside recording that identity, and the next
    // surface added outside the region would have leaked the same way.
    <div
      className="grid gap-8 py-4 ph-no-capture sm:py-8 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-12"
      data-ph-no-capture
    >
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <Link className="text-sm text-muted underline underline-offset-4" href={backPath}>
          {profile.hasPublicProfile ? "Back to profile" : "Back to account"}
        </Link>
        <div className="mt-5 rounded-card border border-border bg-surface p-5">
          <ProfileAvatarImage
            alt=""
            appearance={profile.avatarAppearance}
            className="size-16 rounded-card"
            label={profile.displayName}
            src={profile.avatarImageUrl}
          />
          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">
            {profile.profileType}
          </p>
          <h2 className="mt-1 break-words text-2xl font-semibold">{profile.displayName}</h2>
          {profile.hasPublicProfile ? (
            <p className="mt-2 text-sm text-muted">vrdex.net{publicProfilePath}</p>
          ) : null}
        </div>
      </aside>

      <section aria-labelledby="claim-heading">
        <h1 className="text-3xl font-semibold sm:text-4xl" id="claim-heading">
          Claim {profile.displayName}
        </h1>

        {context === undefined ? <p className="mt-8 text-sm text-muted">Loading claim options…</p> : null}
        {context?.ownership === "signed_out" ? (
          <Notice className="mt-8" variant="warning">
            <p className="font-semibold">Sign in to continue this claim.</p>
            <Link
              className={cn(buttonVariants({ variant: "primary" }), "mt-4")}
              href={`/sign-in?returnTo=${encodeURIComponent(profileClaimPath(profile.slug, source))}`}
            >
              Sign in
            </Link>
          </Notice>
        ) : null}
        {(context?.ownership === "viewer" && context.verified) ||
        status.kind === "complete" ||
        collectorCompletion !== null ? (
          <div
            aria-live="polite"
            className="outline-none"
            ref={completionRef}
            role="status"
            tabIndex={-1}
          >
            <Notice className="mt-8" variant="success">
              <div className="flex gap-3">
                <BadgeCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
                <div>
                  <p className="font-semibold">
                    {status.kind === "complete"
                      ? status.message
                      : collectorCompletion !== null
                        ? collectorCompletion.connectionOnly
                          ? "That account or group is now connected to this profile."
                          : collectorCompletion.verified
                            ? "Verified. This profile is yours."
                            : "This profile is yours. You can manage it now."
                        : "You already manage this profile."}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link className={buttonVariants({ variant: "primary" })} href={completionPath}>
                      {profile.hasPublicProfile ? "View profile" : "Manage profile"}
                    </Link>
                    {profile.hasPublicProfile ? (
                      <Link className={buttonVariants({ variant: "secondary" })} href={appearancePath}>
                        Edit appearance
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            </Notice>
          </div>
        ) : null}
        {context?.ownership === "other" ? (
          <Notice className="mt-8" variant="warning">
            <p className="font-semibold">This profile already has an owner.</p>
            <p className="mt-1">If ownership changed or this looks wrong, contact support rather than creating another claim.</p>
          </Notice>
        ) : null}
        {isUnverifiedViewer && status.kind !== "complete" ? (
          <Notice className="mt-8">
            <p className="font-semibold">You manage this profile. It is not verified yet.</p>
            <p className="mt-1">
              {profile.profileType === "community"
                ? "Verifying takes one more step: show us you run its Discord server or VRChat group."
                : "Verifying takes one more step: show us you own this VRChat account."}
            </p>
          </Notice>
        ) : null}
        {isVerifiedViewer && status.kind !== "complete" ? (
          <Notice className="mt-8">
            <p className="font-semibold">Adding another connection?</p>
            <p className="mt-1">
              This profile is already verified. Proving control of another server, group, or account
              below adds it to the list you can connect from your account page.
            </p>
          </Notice>
        ) : null}
        {canUseClaimJourney && !context?.emailVerified ? (
          <Notice className="mt-8" variant="warning">
            Verify your email before claiming. This protects profile ownership and recovery.
          </Notice>
        ) : null}

        {canUseClaimJourney && context?.emailVerified && status.kind !== "complete" ? (
          <>
            {context.pendingProof &&
            !context.pendingProof.expired &&
            context.pendingProof.targetType === "vrclinking" ? (
              // No proof code to show: this attempt is answered by a delegated
              // credential, not by something the claimant posts. Showing the
              // code panel would hand them a task that does nothing.
              <div className="mt-8 rounded-card border border-border bg-surface p-5">
                <h2 className="text-xl font-semibold">Waiting on VRCLinking</h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  No community that has delegated a credential reported your Discord account as
                  linked to this VRChat account yet. If you have just linked it, check again in a
                  minute.
                </p>
                <p className="mt-2 break-all text-sm text-muted">
                  {context.pendingProof.targetExternalId}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    disabled={status.kind === "working"}
                    variant="primary"
                    onClick={() => void checkProof(context.pendingProof!.id, "vrclinking")}
                  >
                    Check again
                  </Button>
                  <Button disabled={status.kind === "working"} variant="ghost" onClick={() => void startOver("proof")}>
                    Start over
                  </Button>
                </div>
              </div>
            ) : context.pendingProof && !context.pendingProof.expired ? (
              <div className="mt-8 rounded-card border border-border bg-surface p-5">
                <h2 className="text-xl font-semibold">
                  Add this code to your VRChat{" "}
                  {context.pendingProof.targetType === "vrchat_group" ? "group" : "profile"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  {context.pendingProof.targetType === "vrchat_group"
                    ? "Paste it anywhere in the group’s description and save, then check below. Once we find it you can take it back out."
                    : "Paste it anywhere in your profile bio and save, then check below. Once we find it you can take it back out."}
                </p>
                <CopyValueRow className="mt-4" label="Proof code" value={context.pendingProof.proofCode} />
                <dl className="mt-4 grid gap-1 text-sm text-muted">
                  <div className="flex flex-wrap gap-x-2">
                    <dt>
                      {context.pendingProof.targetType === "vrchat_group" ? "Group" : "Account"}
                    </dt>
                    <dd className="break-all text-foreground">
                      {context.pendingProof.targetExternalId}
                    </dd>
                  </div>
                  <div className="flex flex-wrap gap-x-2">
                    <dt>Code expires</dt>
                    <dd className="text-foreground">
                      {new Date(context.pendingProof.expiresAt).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button disabled={status.kind === "working"} variant="primary" onClick={() => void checkProof(context.pendingProof!.id)}>I&apos;ve added it - check now</Button>
                  <Button disabled={status.kind === "working"} variant="ghost" onClick={() => void startOver("proof")}>Start over</Button>
                </div>
              </div>
            ) : context.pendingClaimRequest && !isUnverifiedViewer && !isVerifiedViewer ? (
              <div className="mt-8 rounded-card border border-border bg-surface p-5">
                <h2 className="text-xl font-semibold">One more step</h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  We will check that your Discord account has Administrator in that server.
                </p>
                {context.pendingClaimRequest.discordGuildId ? (
                  <p className="mt-2 break-all text-sm text-muted">Server ID: {context.pendingClaimRequest.discordGuildId}</p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button disabled={status.kind === "working"} variant="primary" onClick={() => void checkDiscord(context.pendingClaimRequest!.id)}>Check Discord access</Button>
                  <Button disabled={status.kind === "working"} variant="ghost" onClick={() => void startOver("claim_request")}>Start over</Button>
                </div>
              </div>
            ) : (
              <form className="mt-8" onSubmit={submit}>
                <fieldset>
                  <legend className="text-xl font-semibold">
                    {isVerifiedViewer
                      ? "Prove control of another server, group, or account"
                      : isUnverifiedViewer
                        ? profile.profileType === "person"
                          ? "Verify this profile with VRChat"
                          : "Verify this community"
                        : "Choose how to confirm ownership"}
                  </legend>
                  {/* An unverified community owner (created through the no-match
                      path) can upgrade to verified by proving Discord server
                      control, so both methods must stay reachable for them. For
                      an existing person owner the Discord claim is the one
                      method with nothing to offer — it would just report the
                      ownership they already hold — while VRChat and VRCLinking
                      both prove control and both count as an upgrade. Leaving
                      VRCLinking out of this branch stranded exactly the owners
                      the quick-claim path creates unverified. */}
                  <div className={cn("mt-4 grid gap-3", isOwnerUpgradeBranch && !vrclinkingAvailable ? undefined : "sm:grid-cols-2")}>
                    {isOwnerUpgradeBranch ? (
                      <>
                        {vrchatMethodCard}
                        {vrclinkingAvailable ? vrclinkingMethodCard : null}
                      </>
                    ) : (
                      <>
                        {profile.profileType === "person" ? vrchatMethodCard : discordMethodCard}
                        {profile.profileType === "person" ? discordMethodCard : vrchatMethodCard}
                        {vrclinkingAvailable ? vrclinkingMethodCard : null}
                      </>
                    )}
                  </div>
                  {/* Points at the purpose-scoped round-trip, not `/account`.
                      `hasDiscord` is a VRDex verification watermark now, and the
                      only thing that writes one is this OAuth flow. `/account`
                      opens Clerk's profile, where linking Discord as a sign-in
                      method writes nothing VRDex reads — so sending a blocked
                      claimant there left them looping: link Discord, come back,
                      still blocked, no other affordance on the page.

                      Each term is gated on its card actually being rendered.
                      The owner-upgrade branch omits the Discord card entirely,
                      so `discordMethodBlocked` alone would offer verification
                      that unlocks nothing visible — which is what happens for an
                      existing owner wherever VRCLinking is unconfigured, the
                      repository default. */}
                  {(!isOwnerUpgradeBranch && discordMethodBlocked) ||
                  (vrclinkingAvailable && vrclinkingMethodBlocked) ? (
                    <Link
                      className={cn(buttonVariants({ variant: "secondary" }), "mt-3")}
                      href={discordVerifyHref}
                    >
                      {discordVerifyState === "verified"
                        ? "Check Discord again"
                        : "Verify with Discord"}
                    </Link>
                  ) : null}
                </fieldset>

                <div className="mt-6 border-t border-border pt-6">
                  {method === "vrclinking" ? (
                    <Field>
                      VRChat profile URL or user ID
                      <Input
                        autoComplete="off"
                        name="targetExternalId"
                        placeholder="https://vrchat.com/home/user/usr_…"
                        required
                      />
                      <FieldText>
                        VRDex asks the communities that have delegated a VRCLinking credential whether
                        your Discord account is linked to this VRChat account and verified. It receives a
                        yes or no and which server answered, nothing else.
                      </FieldText>
                    </Field>
                  ) : method === "vrchat" ? (
                    <Field>
                      {profile.profileType === "person" ? "VRChat profile URL or user ID" : "VRChat group URL or group ID"}
                      <Input
                        autoComplete="off"
                        name="targetExternalId"
                        placeholder={profile.profileType === "person" ? "https://vrchat.com/home/user/usr_…" : "https://vrchat.com/home/group/grp_…"}
                        required
                      />
                      <FieldText>We only use this to look for your code.</FieldText>
                    </Field>
                  ) : profile.profileType === "community" ? (
                    verifiedGuilds.length > 0 ? (
                      <Field>
                        Discord server
                        <Select name="discordGuildId" required>
                          {verifiedGuilds.map((guild) => (
                            <option key={guild.guildId} value={guild.guildId}>
                              {guild.guildName ?? guild.guildId} ({CONTROL_LEVEL_LABELS[guild.controlLevel]})
                            </option>
                          ))}
                        </Select>
                        <FieldText>
                          Only servers you own or administer appear here. VRDex reads your server list and
                          permissions once, then discards the access token. It never reads message content.
                        </FieldText>
                      </Field>
                    ) : (
                      <Notice>
                        <p className="font-semibold">Verify your Discord servers first.</p>
                        <p className="mt-1">
                          VRDex checks which servers you own, administer, or manage. You will return here to
                          finish the claim.
                        </p>
                        <Link
                          className={cn(buttonVariants({ variant: "primary" }), "mt-4")}
                          href={discordVerifyHref}
                        >
                          {discordVerifyState === "verified"
                            ? "Check Discord servers again"
                            : "Verify with Discord"}
                        </Link>
                        {discordVerifyState === "verified" ? (
                          <p className="mt-3 text-sm">
                            Discord did not report any server you own, administer, or manage.
                          </p>
                        ) : null}
                        {discordVerifyState === "failed" || discordVerifyState === "unavailable" ? (
                          <p className="mt-3 text-sm">
                            That check could not finish. Nothing changed; try again.
                          </p>
                        ) : null}
                      </Notice>
                    )
                  ) : (
                    <Notice>
                      This grants profile controls using your linked Discord account. It does not add a verified-owner badge.
                    </Notice>
                  )}
                  {method === "vrchat" ||
                  method === "vrclinking" ||
                  profile.profileType !== "community" ||
                  verifiedGuilds.length > 0 ? (
                    <Button
                      className="mt-5"
                      disabled={
                        status.kind === "working" ||
                        (method === "discord" && discordMethodBlocked) ||
                        (method === "vrclinking" && vrclinkingMethodBlocked)
                      }
                      size="lg"
                      type="submit"
                      variant="primary"
                    >
                      {method === "vrclinking"
                        ? "Check VRCLinking"
                        : method === "vrchat"
                          ? "Create proof code"
                          : profile.profileType === "community"
                            ? "Claim with this server"
                            : "Claim with Discord"}
                    </Button>
                  ) : null}
                </div>
              </form>
            )}
          </>
        ) : null}

        <div
          aria-live="polite"
          className="mt-5 outline-none"
          ref={statusRef}
          tabIndex={-1}
        >
          {status.kind === "working" || status.kind === "notice" ? <p className="text-sm text-muted">{status.message}</p> : null}
          {status.kind === "error" ? <Notice variant="error">{status.message}</Notice> : null}
        </div>

        {/* Was a `mailto:`, which asked for none of the identifiers any of these
            three need and required a mail client, on a headset. The form
            prompts for the profile and a way to reply, and the topic is chosen
            before the page loads. */}
        <p className="mt-8 border-t border-border pt-5 text-sm leading-6 text-muted">
          Transferring, recovering, or disputing ownership?{" "}
          <Link className="underline underline-offset-4" href="/support?topic=ownership_dispute">
            Contact support
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
