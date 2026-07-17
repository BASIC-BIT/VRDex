"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { Component, useState, useTransition, type FormEvent, type ReactNode } from "react";

import { api } from "@convex-generated-api";
import { buttonVariants, Button } from "@/components/ui/button";
import { CopyValueRow } from "@/components/ui/copy-value-row";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/cn";
import type { Id } from "../../../../../convex/_generated/dataModel";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

type ClaimMethod = "discord" | "vrchat" | "vrclinking";
type ClaimProfileType = "person" | "community";

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
  /This community profile already has an active owner\./,
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

function profileSlugFromInput(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  let path = trimmed;

  try {
    path = new URL(trimmed).pathname;
  } catch {
    // A bare profile name or relative path is valid input.
  }

  const segments = path.split(/[/?#]/).filter(Boolean);

  if ((segments[0] === "p" || segments[0] === "c") && segments[1]) {
    return segments[1];
  }

  return segments.at(-1) ?? "";
}

function claimErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  for (const pattern of claimErrorPatterns) {
    const match = message.match(pattern);

    if (match) {
      return match[0];
    }
  }

  return "Profile not found. Check the profile link and try again.";
}

function ClaimActions({
  defaultClaimSlug,
  defaultClaimType,
  emailVerified,
  hasDiscord,
}: {
  defaultClaimSlug: string;
  defaultClaimType: ClaimProfileType;
  emailVerified: boolean;
  hasDiscord: boolean;
}) {
  const verifyDiscordAdmin = useAction(api.profileClaims.verifyDiscordCommunityAdminClaim);
  const verifyVrchatProof = useAction(api.profileClaims.verifyVrchatProofViaAdapter);
  const claimPerson = useMutation(api.profileClaims.claimExistingPersonWithDiscord);
  const requestCommunityClaim = useMutation(api.profileClaims.requestCommunityDiscordAdminClaim);
  const startVrchatProof = useMutation(api.profileClaims.startVrchatProof);
  const [profileType, setProfileType] = useState<ClaimProfileType>(defaultClaimType);
  const [method, setMethod] = useState<ClaimMethod>("discord");
  const [profileInput, setProfileInput] = useState(defaultClaimSlug);
  const [status, setStatus] = useState<ClaimStatus>({ kind: "idle" });
  const [, startTransition] = useTransition();
  const profileSlug = profileSlugFromInput(profileInput);
  const profilePath = `/${profileType === "community" ? "c" : "p"}/${profileSlug}`;

  function selectMethod(nextMethod: ClaimMethod) {
    setMethod(nextMethod);
    setStatus({ kind: "idle" });
  }

  function selectProfileType(nextProfileType: ClaimProfileType) {
    setProfileType(nextProfileType);
    if (nextProfileType === "community" && method === "vrclinking") {
      setMethod("vrchat");
    }
    setStatus({ kind: "idle" });
  }

  async function submitClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const profileSlug = profileSlugFromInput(stringField(formData.get("profileLink")));

    if (method === "discord") {
      if (profileType === "community") {
        setStatus({ kind: "submitting", label: "Requesting community claim..." });

        try {
          const result = await requestCommunityClaim({
            profileSlug,
            discordGuildId: stringField(formData.get("discordGuildId")),
            discordGuildName: stringField(formData.get("discordGuildName")) || undefined,
          });
          startTransition(() =>
            setStatus({
              kind: "success",
              message:
                result.state === "already_owned"
                  ? "You already own this community profile."
                  : "Community claim request created. Check your Discord administrator access to finish.",
              href: result.profilePath,
              ...("claimRequestId" in result ? { claimRequestId: result.claimRequestId } : {}),
            }),
          );
        } catch (error) {
          startTransition(() => setStatus({ kind: "error", message: claimErrorMessage(error) }));
        }

        return;
      }

      setStatus({ kind: "submitting", label: "Claiming person profile..." });

      try {
        const result = await claimPerson({ profileSlug });
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
      } catch (error) {
        startTransition(() => setStatus({ kind: "error", message: claimErrorMessage(error) }));
      }

      return;
    }

    setStatus({ kind: "submitting", label: "Creating proof code..." });

    try {
      const result = await startVrchatProof({
        profileSlug,
        targetType:
          profileType === "community"
            ? "vrchat_group"
            : method === "vrclinking"
              ? "vrclinking"
              : "vrchat_user",
        targetExternalId: stringField(formData.get("targetExternalId")),
      });
      startTransition(() =>
        setStatus({
          kind: "success",
          message: "Proof code created. Add it where the selected verification service can read it.",
          proofCode: result.proofCode,
          expiresAt: result.expiresAt,
          attemptId: result.attemptId,
        }),
      );
    } catch (error) {
      startTransition(() => setStatus({ kind: "error", message: claimErrorMessage(error) }));
    }
  }

  async function verifyPendingDiscordAdminClaim(claimRequestId: Id<"profileClaimRequests">) {
    setStatus({ kind: "submitting", label: "Checking Discord administrator access..." });

    try {
      const result = await verifyDiscordAdmin({ claimRequestId });
      startTransition(() =>
        setStatus({
          kind: "success",
          message:
            "claimState" in result
              ? `Community claim verified as ${result.claimState.replace(/_/g, " ")}.`
              : "Discord administrator access was not verified.",
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

  const disabled = !emailVerified || (method === "discord" && !hasDiscord);

  return (
    <section aria-labelledby="profile-claim-heading" className="border-t border-border py-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
        <div>
          <h2 className="text-2xl font-semibold" id="profile-claim-heading">
            Claim a profile
          </h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted">
            Choose the profile type and how you want to verify ownership.
          </p>
        </div>

        <div className="max-w-2xl">
          <div
            aria-label="Profile type"
            className="inline-flex rounded-control border border-border bg-surface p-1"
            role="group"
          >
            <Button
              aria-pressed={profileType === "person"}
              size="sm"
              type="button"
              variant={profileType === "person" ? "primary" : "ghost"}
              onClick={() => selectProfileType("person")}
            >
              Person
            </Button>
            <Button
              aria-pressed={profileType === "community"}
              size="sm"
              type="button"
              variant={profileType === "community" ? "primary" : "ghost"}
              onClick={() => selectProfileType("community")}
            >
              Community
            </Button>
          </div>

          <div
            aria-label="Claim method"
            className="mt-3 flex w-fit rounded-control border border-border bg-surface p-1"
            role="group"
          >
            <Button
              aria-pressed={method === "discord"}
              size="sm"
              type="button"
              variant={method === "discord" ? "primary" : "ghost"}
              onClick={() => selectMethod("discord")}
            >
              Discord
            </Button>
            <Button
              aria-pressed={method === "vrchat"}
              size="sm"
              type="button"
              variant={method === "vrchat" ? "primary" : "ghost"}
              onClick={() => selectMethod("vrchat")}
            >
              VRChat
            </Button>
            {profileType === "person" ? (
              <Button
                aria-pressed={method === "vrclinking"}
                size="sm"
                type="button"
                variant={method === "vrclinking" ? "primary" : "ghost"}
                onClick={() => selectMethod("vrclinking")}
              >
                VRC Linking
              </Button>
            ) : null}
          </div>

          <form className="mt-6 grid gap-4" onSubmit={submitClaim}>
            <Field>
              Profile link
              <Input
                name="profileLink"
                placeholder={profileType === "community" ? "vrdex.net/c/afterglow-social" : "vrdex.net/p/dj-celine"}
                required
                value={profileInput}
                onChange={(event) => {
                  setProfileInput(event.target.value);
                  setStatus({ kind: "idle" });
                }}
              />
            </Field>
            {profileSlug ? (
              <CopyValueRow
                label="Profile URL"
                value={`https://vrdex.net${profilePath}`}
              />
            ) : null}

            {profileType === "community" && method === "discord" ? (
              <>
                <Field>
                  Discord server ID
                  <Input name="discordGuildId" required />
                </Field>
                <Field>
                  Discord server name
                  <Input name="discordGuildName" placeholder="Optional" />
                </Field>
              </>
            ) : null}

            {method !== "discord" ? (
              <>
                <Field>
                  {profileType === "community"
                    ? "VRChat group ID"
                    : method === "vrclinking"
                      ? "VRC Linking user ID"
                      : "VRChat user ID"}
                  <Input
                    name="targetExternalId"
                    placeholder={profileType === "community" ? "grp_..." : "usr_..."}
                    required
                  />
                </Field>
              </>
            ) : null}

            <div>
              <Button
                disabled={disabled || status.kind === "submitting"}
                size="lg"
                type="submit"
                variant="primary"
              >
                {method === "discord"
                  ? profileType === "community"
                    ? "Request Discord admin claim"
                    : "Claim with Discord"
                  : "Create proof code"}
              </Button>
              {!emailVerified ? (
                <p className="mt-2 text-xs text-muted">Verify your email before claiming a profile.</p>
              ) : null}
              {method === "discord" && !hasDiscord ? (
                <p className="mt-2 text-xs text-muted">Link Discord to use this method.</p>
              ) : null}
            </div>
          </form>

          {status.kind === "submitting" ? <p className="mt-4 text-sm text-muted">{status.label}</p> : null}
          {status.kind === "error" ? (
            <Notice className="mt-4" variant="error">
              {status.message}
            </Notice>
          ) : null}
          {status.kind === "success" ? (
            <Notice className="mt-4" variant="success">
              <p>{status.message}</p>
              {status.proofCode ? <p className="mt-2 font-mono text-base text-foreground">{status.proofCode}</p> : null}
              {status.expiresAt ? <p className="mt-1 text-xs">Expires {new Date(status.expiresAt).toLocaleString()}</p> : null}
              {status.attemptId ? (
                <Button
                  className="mt-3 mr-3"
                  size="sm"
                  type="button"
                  onClick={() => status.attemptId && void verifyPendingVrchatProof(status.attemptId)}
                >
                  Check proof now
                </Button>
              ) : null}
              {status.claimRequestId ? (
                <Button
                  className="mt-3 mr-3"
                  size="sm"
                  type="button"
                  onClick={() =>
                    status.claimRequestId && void verifyPendingDiscordAdminClaim(status.claimRequestId)
                  }
                >
                  Check Discord access
                </Button>
              ) : null}
              {status.href ? (
                <Link className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "mt-3")} href={status.href}>
                  View profile
                </Link>
              ) : null}
            </Notice>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ConnectedAccountPanel({
  defaultClaimSlug,
  defaultClaimType,
}: {
  defaultClaimSlug: string;
  defaultClaimType: ClaimProfileType;
}) {
  const viewer = useQuery(api.accounts.viewer);
  const { signOut } = useAuthActions();

  if (viewer === undefined) {
    return <p className="text-sm text-muted">Loading account...</p>;
  }

  if (viewer === null) {
    return (
      <section className="border-t border-border py-8">
        <h2 className="text-2xl font-semibold">Not signed in</h2>
        <Link className={cn(buttonVariants({ size: "lg", variant: "primary" }), "mt-5")} href="/sign-in">
          Sign in
        </Link>
      </section>
    );
  }

  return (
    <div>
      <section className="grid gap-8 border-t border-border py-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
        <div>
          <h2 className="text-2xl font-semibold">{viewer.user.name ?? viewer.user.email ?? "Your details"}</h2>
          <dl className="mt-4 grid gap-2 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <dt className="text-muted">Email</dt>
              <dd>{viewer.user.email ?? "Not provided"}</dd>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <dt className="text-muted">Status</dt>
              <dd>{viewer.user.emailVerified ? "Verified" : "Verification required"}</dd>
            </div>
          </dl>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link className={buttonVariants({ variant: "secondary" })} href="/account/privacy">
              Privacy Controls
            </Link>
            <Link className={buttonVariants({ variant: "secondary" })} href="/account/appearance">
              Personalization
            </Link>
            <Button type="button" variant="ghost" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>

        <div className="lg:border-l lg:border-border lg:pl-8">
          <h2 className="text-lg font-semibold">Sign-in methods</h2>
          <ul className="mt-4 divide-y divide-border border-y border-border text-sm">
            {viewer.linkedProviders.length === 0 ? (
              <li className="py-3 text-muted">No sign-in methods linked.</li>
            ) : (
              viewer.linkedProviders.map((account) => (
                <li
                  className="flex items-center justify-between gap-4 py-3"
                  key={`${account.provider}:${account.providerAccountId}`}
                >
                  <span className="font-medium capitalize">{account.provider}</span>
                  <span className="text-muted">{account.emailVerified ? "Verified email" : "Connected"}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      </section>

      <ClaimActions
        defaultClaimSlug={defaultClaimSlug}
        defaultClaimType={defaultClaimType}
        emailVerified={viewer.user.emailVerified}
        hasDiscord={viewer.linkedProviders.some((account) => account.provider === "discord")}
        key={`${defaultClaimType}:${defaultClaimSlug}`}
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
          Account details are temporarily unavailable. Try again shortly.
        </Notice>
      );
    }

    return this.props.children;
  }
}

export function AccountPanel({
  defaultClaimSlug = "",
  defaultClaimType = "person",
}: {
  defaultClaimSlug?: string;
  defaultClaimType?: ClaimProfileType;
}) {
  if (!convexUrl) {
    return (
      <Notice className="leading-7" variant="dashed">
        Account details are unavailable in this environment.
      </Notice>
    );
  }

  return (
    <AccountPanelErrorBoundary>
      <ConnectedAccountPanel defaultClaimSlug={defaultClaimSlug} defaultClaimType={defaultClaimType} />
    </AccountPanelErrorBoundary>
  );
}
