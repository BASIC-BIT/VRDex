"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { Component, FormEvent, ReactNode, useState, useTransition } from "react";

import { api } from "@convex-generated-api";
import { Badge } from "@/components/ui/badge";
import { buttonVariants, Button } from "@/components/ui/button";
import { Card, cardVariants, Eyebrow } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/cn";
import type { Id } from "../../../../../convex/_generated/dataModel";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

type ClaimStatus =
  | { kind: "idle" }
  | { kind: "submitting"; label: string }
  | {
      kind: "success";
      message: string;
      href?: string;
      proofCode?: string;
      expiresAt?: number;
      claimRequestId?: Id<"profileClaimRequests">;
      attemptId?: Id<"profileVerificationAttempts">;
    }
  | { kind: "error"; message: string };

const claimErrorPatterns = [
  /A verified email address is required before claim-level actions\./,
  /A linked Discord account is required for this claim method\./,
  /A valid profile slug is required\./,
  /Profile not found\./,
  /This claim method requires a (?:person|community) profile\./,
  /This profile already has an active owner\./,
  /VRChat user proof requires a person profile\./,
  /VRChat group proof requires a community profile\./,
  /A VRChat or VRCLinking target id is required\./,
  /DISCORD_BOT_TOKEN is not configured\./,
  /Discord API returned HTTP \d+\./,
  /VRCHAT_PROOF_ADAPTER_URL is not configured\./,
  /VRCLINKING_PROOF_ADAPTER_URL is not configured\./,
];

function stringField(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function claimErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  for (const pattern of claimErrorPatterns) {
    const match = message.match(pattern);

    if (match) {
      return match[0];
    }
  }

  return "Claim request failed. Check the profile slug and try again.";
}

function ClaimActions({ emailVerified, hasDiscord }: { emailVerified: boolean; hasDiscord: boolean }) {
  const verifyDiscordAdmin = useAction(api.profileClaims.verifyDiscordCommunityAdminClaim);
  const verifyVrchatProof = useAction(api.profileClaims.verifyVrchatProofViaAdapter);
  const claimPerson = useMutation(api.profileClaims.claimExistingPersonWithDiscord);
  const requestCommunityClaim = useMutation(api.profileClaims.requestCommunityDiscordAdminClaim);
  const startVrchatProof = useMutation(api.profileClaims.startVrchatProof);
  const [status, setStatus] = useState<ClaimStatus>({ kind: "idle" });
  const [, startTransition] = useTransition();

  async function submitDiscordPersonClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    setStatus({ kind: "submitting", label: "Claiming person profile..." });

    try {
      const result = await claimPerson({ profileSlug: stringField(formData.get("profileSlug")) });
      startTransition(() =>
        setStatus({
          kind: "success",
          message:
            "state" in result && result.state === "already_owned"
              ? "You already own this person profile."
              : `Person profile claimed as ${result.claimState.replace(/_/g, " ")}.`,
          href: result.profilePath,
        }),
      );
      form.reset();
    } catch (error) {
      startTransition(() => setStatus({ kind: "error", message: claimErrorMessage(error) }));
    }
  }

  async function submitCommunityDiscordClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    setStatus({ kind: "submitting", label: "Requesting community claim..." });

    try {
      const result = await requestCommunityClaim({
        profileSlug: stringField(formData.get("profileSlug")),
        discordGuildId: stringField(formData.get("discordGuildId")),
        discordGuildName: stringField(formData.get("discordGuildName")) || undefined,
      });
      startTransition(() =>
        setStatus({
          kind: "success",
          message:
            result.state === "already_owned"
              ? "You already own this community profile."
              : "Community claim request created. Administrator verification still needs the Discord adapter.",
          href: result.profilePath,
          ...("claimRequestId" in result ? { claimRequestId: result.claimRequestId } : {}),
        }),
      );
      form.reset();
    } catch (error) {
      startTransition(() => setStatus({ kind: "error", message: claimErrorMessage(error) }));
    }
  }

  async function submitVrchatProof(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    setStatus({ kind: "submitting", label: "Creating proof code..." });

    try {
      const result = await startVrchatProof({
        profileSlug: stringField(formData.get("profileSlug")),
        targetType: stringField(formData.get("targetType")) as "vrchat_user" | "vrchat_group" | "vrclinking",
        targetExternalId: stringField(formData.get("targetExternalId")),
      });
      startTransition(() =>
        setStatus({
          kind: "success",
          message: "Proof code created. Put this code where the configured adapter can read it.",
          proofCode: result.proofCode,
          expiresAt: result.expiresAt,
          attemptId: result.attemptId,
        }),
      );
      form.reset();
    } catch (error) {
      startTransition(() => setStatus({ kind: "error", message: claimErrorMessage(error) }));
    }
  }

  async function verifyPendingDiscordAdminClaim(claimRequestId: Id<"profileClaimRequests">) {
    setStatus({ kind: "submitting", label: "Checking Discord Administrator permission..." });

    try {
      const result = await verifyDiscordAdmin({ claimRequestId });
      startTransition(() =>
        setStatus({
          kind: "success",
          message:
            "claimState" in result
              ? `Community claim verified as ${result.claimState.replace(/_/g, " ")}.`
              : "Discord Administrator permission was not verified.",
        }),
      );
    } catch (error) {
      startTransition(() => setStatus({ kind: "error", message: claimErrorMessage(error) }));
    }
  }

  async function verifyPendingVrchatProof(attemptId: Id<"profileVerificationAttempts">) {
    setStatus({ kind: "submitting", label: "Checking proof code..." });

    try {
      const result = await verifyVrchatProof({ attemptId });
      startTransition(() =>
        setStatus({
          kind: "success",
          message:
            "claimState" in result
              ? `Proof verified as ${result.claimState.replace(/_/g, " ")}.`
              : `Proof check finished with state ${result.state}.`,
        }),
      );
    } catch (error) {
      startTransition(() => setStatus({ kind: "error", message: claimErrorMessage(error) }));
    }
  }

  const disabled = !emailVerified;

  return (
    <Card className="lg:col-span-2" surface="glass">
      <Eyebrow>Profile claims</Eyebrow>
      <Notice className="mt-3">
        Claim actions require a verified email. Discord community ownership is recorded as a pending request until the Discord Administrator adapter verifies full Administrator permission.
      </Notice>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <form className={cn(cardVariants({ padding: "sm", surface: "strong" }), "grid gap-3")} onSubmit={submitDiscordPersonClaim}>
          <h3 className="font-semibold tracking-[-0.02em]">Discord person claim</h3>
          <Field>
            Person slug
            <Input className="bg-surface" name="profileSlug" placeholder="dj-celine" required />
          </Field>
          <Button disabled={disabled || !hasDiscord} size="lg" type="submit" variant="primary">
            Claim with Discord
          </Button>
          {!hasDiscord ? <p className="text-xs leading-5 text-muted">Link Discord before using this method.</p> : null}
        </form>

        <form className={cn(cardVariants({ padding: "sm", surface: "strong" }), "grid gap-3")} onSubmit={submitCommunityDiscordClaim}>
          <h3 className="font-semibold tracking-[-0.02em]">Discord community claim</h3>
          <Field>
            Community slug
            <Input className="bg-surface" name="profileSlug" placeholder="afterglow-social" required />
          </Field>
          <Field>
            Discord guild ID
            <Input className="bg-surface" name="discordGuildId" required />
          </Field>
          <Field>
            Guild name
            <Input className="bg-surface" name="discordGuildName" placeholder="Optional" />
          </Field>
          <Button disabled={disabled || !hasDiscord} size="lg" type="submit" variant="primary">
            Request admin claim
          </Button>
        </form>

        <form className={cn(cardVariants({ padding: "sm", surface: "strong" }), "grid gap-3")} onSubmit={submitVrchatProof}>
          <h3 className="font-semibold tracking-[-0.02em]">VRChat proof code</h3>
          <Field>
            Profile slug
            <Input className="bg-surface" name="profileSlug" placeholder="dj-celine" required />
          </Field>
          <Field>
            Target type
            <Select className="bg-surface" name="targetType" required>
              <option value="vrchat_user">VRChat user</option>
              <option value="vrchat_group">VRChat group</option>
              <option value="vrclinking">VRCLinking</option>
            </Select>
          </Field>
          <Field>
            Target ID
            <Input className="bg-surface" name="targetExternalId" required />
          </Field>
          <Button disabled={disabled} size="lg" type="submit" variant="primary">
            Create proof code
          </Button>
        </form>
      </div>

      {status.kind === "submitting" ? <p className="mt-4 text-sm text-muted">{status.label}</p> : null}
      {status.kind === "error" ? (
        <Notice className="mt-4" variant="error">{status.message}</Notice>
      ) : null}
      {status.kind === "success" ? (
        <Notice className="mt-4">
          <p>{status.message}</p>
          {status.proofCode ? <p className="mt-2 font-mono text-base text-foreground">{status.proofCode}</p> : null}
          {status.expiresAt ? <p className="mt-1 text-xs">Expires {new Date(status.expiresAt).toLocaleString()}</p> : null}
          {status.claimRequestId ? (
            <button
              className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "mt-3 mr-3")}
              type="button"
              onClick={() => void verifyPendingDiscordAdminClaim(status.claimRequestId!)}
            >
              Check Discord admin
            </button>
          ) : null}
          {status.attemptId ? (
            <button
              className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "mt-3 mr-3")}
              type="button"
              onClick={() => void verifyPendingVrchatProof(status.attemptId!)}
            >
              Check proof now
            </button>
          ) : null}
          {status.href ? (
            <Link className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "mt-3")} href={status.href}>
              View profile
            </Link>
          ) : null}
        </Notice>
      ) : null}
    </Card>
  );
}

function ConnectedAccountPanel() {
  const viewer = useQuery(api.accounts.viewer);
  const { signOut } = useAuthActions();

  if (viewer === undefined) {
    return <p className="text-sm text-muted">Loading account...</p>;
  }

  if (viewer === null) {
    return (
      <Card surface="strong">
        <h2 className="text-2xl font-semibold tracking-[-0.03em]">Not signed in</h2>
        <p className="mt-3 text-sm leading-7 text-muted">
          Sign in before submitting profiles, claiming ownership, or changing field privacy.
        </p>
        <Link
          className={cn(buttonVariants({ size: "lg", variant: "primary" }), "mt-5")}
          href="/sign-in"
        >
          Sign in
        </Link>
      </Card>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_0.8fr]">
      <Card surface="strong">
        <h2 className="text-2xl font-semibold tracking-[-0.03em]">
          {viewer.user.name ?? viewer.user.email ?? "Signed-in account"}
        </h2>
        <dl className="mt-5 grid gap-3 text-sm">
          <div>
            <dt className="font-mono text-xs uppercase tracking-[0.22em] text-muted">Email</dt>
            <dd className="mt-1">{viewer.user.email ?? "Not provided"}</dd>
          </div>
          <div>
            <dt className="font-mono text-xs uppercase tracking-[0.22em] text-muted">Email status</dt>
            <dd className="mt-1">{viewer.user.emailVerified ? "Verified" : "Not verified"}</dd>
          </div>
        </dl>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link className={buttonVariants({ size: "lg", variant: "primary" })} href="/account/appearance">
            Customize appearance
          </Link>
          <Button size="lg" type="button" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </Card>

      <Card surface="glass">
        <Eyebrow>Linked providers</Eyebrow>
        <div className="mt-4 grid gap-3">
          {viewer.linkedProviders.length === 0 ? (
            <p className="text-sm text-muted">No providers linked yet.</p>
          ) : (
            viewer.linkedProviders.map((account) => (
              <div
                className="rounded-control border border-border bg-surface-strong px-4 py-3 text-sm"
                key={`${account.provider}:${account.providerAccountId}`}
              >
                <span className="font-medium capitalize">{account.provider}</span>
                <Badge className="ml-2" variant="muted">
                  {account.emailVerified ? "email verified" : "linked"}
                </Badge>
              </div>
            ))
          )}
        </div>
      </Card>

      <ClaimActions
        emailVerified={viewer.user.emailVerified}
        hasDiscord={viewer.linkedProviders.some((account) => account.provider === "discord")}
      />
    </div>
  );
}

class AccountPanelErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <Notice className="leading-7" variant="dashed">
          Account state is temporarily unavailable because the backend query failed. Try again after the Convex deployment finishes.
        </Notice>
      );
    }

    return this.props.children;
  }
}

export function AccountPanel() {
  if (!convexUrl) {
    return (
      <Notice className="leading-7" variant="dashed">
        Convex is not configured in this environment, so account state is unavailable.
      </Notice>
    );
  }

  return (
    <AccountPanelErrorBoundary>
      <ConnectedAccountPanel />
    </AccountPanelErrorBoundary>
  );
}
