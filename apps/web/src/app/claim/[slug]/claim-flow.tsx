"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { usePostHog } from "posthog-js/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { BadgeCheck, Building2, ShieldCheck, UserRound } from "lucide-react";

import { api } from "@convex-generated-api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { buttonVariants, Button } from "@/components/ui/button";
import { CopyValueRow } from "@/components/ui/copy-value-row";
import { EntityImage } from "@/components/ui/entity-image";
import { Field, FieldText, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { captureProductEvent } from "@/lib/posthog";
import { claimErrorMessage, claimFailureOutcome } from "@/lib/claim-errors";
import { cn } from "@/lib/cn";
import {
  ownerProfileDestinationPath,
  profileClaimPath,
  type ClaimEntrySource,
  type DiscordVerifyStatus,
} from "@/lib/profile-claim";

type ProfileType = "person" | "community";
type ClaimMethod = "discord" | "vrchat";
type ClaimProfile = {
  avatarImageUrl?: string;
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
    ownership: "available" | "viewer" | "other";
    verified: boolean;
    pendingClaimRequest: null;
    pendingProof: null;
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
  // These let the observer below cover that case exactly once, without
  // double-counting a completion a handler already reported.
  const reportedCompletionRef = useRef(false);
  const seenOwnershipRef = useRef<string | null>(null);
  // Only the person quick-claim needs Discord as a linked sign-in provider.
  // The community path claims against a control proof recorded by the
  // purpose-scoped OAuth round-trip, which a Google or email/password account
  // can complete just as well — gating it on `hasDiscord` let such a user
  // verify a server, see it in the picker, and then be unable to submit.
  const discordNeedsLinkedAccount = profile.profileType === "person";
  const discordMethodBlocked = discordNeedsLinkedAccount && !context?.hasDiscord;
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
  const canUseClaimJourney =
    context?.ownership === "available" || isUnverifiedViewer || isVerifiedViewer;
  const method: ClaimMethod =
    selectedMethod ??
    (profile.profileType === "community" && context?.ownership === "available"
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

  // Report the completion the collector produced. Only a transition observed on
  // this page counts, so opening a profile already owned emits nothing, and the
  // outcome is read from the resulting claim state rather than assumed verified
  // — `recordVrchatProofVerification` deliberately leaves a claim unverified
  // when the target was not already on record for the listing.
  useEffect(() => {
    const ownership = context?.ownership;

    if (ownership === undefined) return;

    const previous = seenOwnershipRef.current;
    seenOwnershipRef.current = ownership;

    if (
      previous === null ||
      previous === "viewer" ||
      ownership !== "viewer" ||
      reportedCompletionRef.current
    ) {
      return;
    }

    reportedCompletionRef.current = true;
    captureProductEvent(posthog, "claim_completed", {
      method: "vrchat",
      outcome: context?.verified ? "claimed_verified" : "claimed_unverified",
      profile_type: profile.profileType,
    });
  }, [context?.ownership, context?.verified, posthog, profile.profileType]);

  function selectMethod(nextMethod: ClaimMethod) {
    setMethod(nextMethod);
    setStatus({ kind: "idle" });
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
    setStatus({
      kind: "working",
      message: method === "vrchat" ? "Creating your proof code…" : "Checking Discord access…",
    });

    try {
      if (method === "vrchat") {
        await startVrchatProof({
          profileSlug: profile.slug,
          targetType: profile.profileType === "person" ? "vrchat_user" : "vrchat_group",
          targetExternalId: String(form.get("targetExternalId") ?? ""),
        });
        setStatus({ kind: "notice", message: "Proof code ready. Finish the VRChat step below." });
        return;
      }

      if (profile.profileType === "person") {
        const result = await claimPerson({ profileSlug: profile.slug });
        const alreadyOwned = "state" in result && result.state === "already_owned";
        setStatus({
          kind: "complete",
          message: alreadyOwned ? "This profile is already yours." : "Profile claimed. You can manage it now.",
          verified: false,
        });
        reportedCompletionRef.current = true;
        reportedCompletionRef.current = true;
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
      setStatus({
        kind: "complete",
        message: verified
          ? "Server control verified. This community is now yours."
          : "Server control verified, and this community is now yours. The listing is not marked verified, which needs VRDex to have this server on record for it — contact support if it should be.",
        verified,
      });
      reportedCompletionRef.current = true;
      captureProductEvent(posthog, "claim_completed", {
        method,
        outcome: verified ? "claimed_verified" : "claimed_unverified",
        profile_type: profile.profileType,
      });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
      captureProductEvent(posthog, "claim_failed", {
        method,
        outcome: outcomeForError(error),
        profile_type: profile.profileType,
      });
    }
  }

  async function checkProof(attemptId: Id<"profileVerificationAttempts">) {
    setStatus({ kind: "working", message: "Checking for your proof code…" });
    try {
      const result = await verifyVrchat({ attemptId });
      if ("claimState" in result) {
        // Proving control of the target does not by itself establish that the
        // target is the one this listing represents, so report the state the
        // claim actually reached.
        const verified = result.claimState === "claimed_verified";
        setStatus({
          kind: "complete",
          message: verified
            ? "Ownership verified. This profile is now yours."
            : "Ownership confirmed, and this profile is now yours. It is not marked verified yet, because this account or group was not already on record for the listing.",
          verified,
        });
        reportedCompletionRef.current = true;
        reportedCompletionRef.current = true;
      captureProductEvent(posthog, "claim_completed", {
          method: "vrchat",
          outcome: verified ? "claimed_verified" : "claimed_unverified",
          profile_type: profile.profileType,
        });
      } else if (result.state === "verified") {
        // The collector fleet resolves attempts on its own schedule, so it may
        // have landed the verdict between render and this click. Reporting the
        // stale "we could not find the code yet" for an attempt that already
        // succeeded told users their completed claim had failed.
        setStatus({
          kind: "complete",
          message: "Ownership confirmed. This profile is now yours.",
          verified: true,
        });
      } else if (result.state === "failed") {
        setStatus({
          kind: "error",
          message:
            "This verification attempt was rejected. Start again to get a new code.",
        });
        captureProductEvent(posthog, "claim_failed", {
          method: "vrchat",
          outcome: "not_verified",
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
                  "Your proof is queued. VRDex checks VRChat for the code automatically; this page updates once it is found.",
              }
            : {
                kind: "error",
                message: result.state === "expired"
                  ? "This proof code expired. Start again to get a new code."
                  : result.state === "unavailable"
                    ? "VRChat verification is temporarily unavailable. Your proof is still pending; try again shortly."
                  : "We could not find the proof code yet. Check where you placed it, then try again.",
              },
        );
        if (outcome !== null) {
          captureProductEvent(posthog, "claim_failed", {
            method: "vrchat",
            outcome,
            profile_type: profile.profileType,
          });
        }
      }
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
      captureProductEvent(posthog, "claim_failed", {
        method: "vrchat",
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
            ? "Server control verified. This community is now yours."
            : "Server control verified, and this community is now yours. The listing is not marked verified, which needs VRDex to have this server on record for it — contact support if it should be.",
          verified,
        });
        reportedCompletionRef.current = true;
        reportedCompletionRef.current = true;
      captureProductEvent(posthog, "claim_completed", {
          method: "discord",
          outcome: verified ? "claimed_verified" : "claimed_unverified",
          profile_type: profile.profileType,
        });
      } else {
        setStatus({
          kind: "error",
          message: "Administrator access was not found. Check the server and your role, then start again.",
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
    setStatus({ kind: "working", message: "Canceling this attempt…" });
    try {
      await cancelPending({ profileSlug: profile.slug, pendingType });
      setStatus({ kind: "notice", message: "Attempt canceled. Choose a method to start again." });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    }
  }

  const vrchatMethodCard = (
    <MethodCard active={method === "vrchat"} title="Verify with VRChat" onClick={() => selectMethod("vrchat")}>
      <ShieldCheck aria-hidden="true" className="mb-2 size-5 text-accent" />
      Match a one-time code on your VRChat {profile.profileType === "person" ? "profile" : "group"}. Grants ownership.
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
        ? "Fast access with your linked account. This claims the profile but does not verify that it represents you."
        : "Confirm you own, administer, or manage the community’s Discord server. Grants ownership."}
      {discordMethodBlocked ? " Link Discord from your account first." : ""}
    </MethodCard>
  );

  return (
    <div className="grid gap-8 py-4 sm:py-8 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-12">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <Link className="text-sm text-muted underline underline-offset-4" href={backPath}>
          {profile.hasPublicProfile ? "Back to profile" : "Back to account"}
        </Link>
        <div className="mt-5 rounded-card border border-border bg-surface p-5">
          <EntityImage
            alt=""
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

      <section aria-labelledby="claim-heading" className="ph-no-capture" data-ph-no-capture>
        <h1 className="text-3xl font-semibold sm:text-4xl" id="claim-heading">
          Claim {profile.displayName}
        </h1>
        <p className="mt-3 max-w-xl text-base leading-7 text-muted">
          Confirm you represent this {profile.profileType}. You will see exactly what each method proves before continuing.
        </p>

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
        {(context?.ownership === "viewer" && context.verified) || status.kind === "complete" ? (
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
                    {status.kind === "complete" ? status.message : "You already manage this profile."}
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
            <p className="font-semibold">You manage this profile, but it is not verified yet.</p>
            <p className="mt-1">
              {profile.profileType === "community"
                ? "Prove control of its Discord server or VRChat group below to record that control."
                : "Complete the VRChat proof below to record that control."}
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
            {context.pendingProof && !context.pendingProof.expired ? (
              <div className="mt-8 rounded-card border border-border bg-surface p-5">
                <h2 className="text-xl font-semibold">Finish your VRChat proof</h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Put this code in the profile or group represented by the URL you entered. It expires{" "}
                  {new Date(context.pendingProof.expiresAt).toLocaleString()}.
                </p>
                <p className="mt-2 break-all text-sm text-muted">{context.pendingProof.targetExternalId}</p>
                <CopyValueRow className="mt-4" label="Proof code" value={context.pendingProof.proofCode} />
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button disabled={status.kind === "working"} variant="primary" onClick={() => void checkProof(context.pendingProof!.id)}>Check proof now</Button>
                  <Button disabled={status.kind === "working"} variant="ghost" onClick={() => void startOver("proof")}>Start over</Button>
                </div>
              </div>
            ) : context.pendingClaimRequest && !isUnverifiedViewer && !isVerifiedViewer ? (
              <div className="mt-8 rounded-card border border-border bg-surface p-5">
                <h2 className="text-xl font-semibold">Finish your Discord check</h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  We will confirm that your linked Discord account has Administrator access in the server you entered.
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
                      control, so both methods must stay reachable for them. A
                      person profile only ever has the VRChat method to offer an
                      existing owner — the Discord person claim would just report
                      the ownership they already hold. */}
                  <div className={cn("mt-4 grid gap-3", (isUnverifiedViewer || isVerifiedViewer) && profile.profileType === "person" ? undefined : "sm:grid-cols-2")}>
                    {(isUnverifiedViewer || isVerifiedViewer) && profile.profileType === "person" ? (
                      vrchatMethodCard
                    ) : (
                      <>
                        {profile.profileType === "person" ? vrchatMethodCard : discordMethodCard}
                        {profile.profileType === "person" ? discordMethodCard : vrchatMethodCard}
                      </>
                    )}
                  </div>
                  {!isUnverifiedViewer && !isVerifiedViewer && discordMethodBlocked ? (
                    <Link className="mt-3 inline-block text-sm underline underline-offset-4" href="/account">
                      Review sign-in methods
                    </Link>
                  ) : null}
                </fieldset>

                <div className="mt-6 border-t border-border pt-6">
                  {method === "vrchat" ? (
                    <Field>
                      {profile.profileType === "person" ? "VRChat profile URL or user ID" : "VRChat group URL or group ID"}
                      <Input
                        autoComplete="off"
                        name="targetExternalId"
                        placeholder={profile.profileType === "person" ? "https://vrchat.com/home/user/usr_…" : "https://vrchat.com/home/group/grp_…"}
                        required
                      />
                      <FieldText>We only use this identifier to check the one-time proof code.</FieldText>
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
                  profile.profileType !== "community" ||
                  verifiedGuilds.length > 0 ? (
                    <Button
                      className="mt-5"
                      disabled={status.kind === "working" || (method === "discord" && discordMethodBlocked)}
                      size="lg"
                      type="submit"
                      variant="primary"
                    >
                      {method === "vrchat" ? "Create proof code" : profile.profileType === "community" ? "Claim with this server" : "Claim with Discord"}
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

        <p className="mt-8 border-t border-border pt-5 text-sm leading-6 text-muted">
          Need to transfer, recover, or dispute ownership? Contact support. Do not claim a profile you do not represent.
        </p>
      </section>
    </div>
  );
}
