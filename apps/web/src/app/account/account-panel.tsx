"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { FormEvent, useState, useTransition } from "react";

import { api } from "@convex-generated-api";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

type ClaimStatus =
  | { kind: "idle" }
  | { kind: "submitting"; label: string }
  | { kind: "success"; message: string; href?: string; proofCode?: string; expiresAt?: number }
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
  const claimPerson = useMutation(api.profileClaims.claimExistingPersonWithDiscord);
  const requestCommunityClaim = useMutation(api.profileClaims.requestCommunityDiscordAdminClaim);
  const startVrchatProof = useMutation(api.profileClaims.startVrchatProof);
  const [status, setStatus] = useState<ClaimStatus>({ kind: "idle" });
  const [, startTransition] = useTransition();

  async function submitDiscordPersonClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    setStatus({ kind: "submitting", label: "Claiming person profile..." });

    try {
      const result = await claimPerson({ profileSlug: stringField(formData.get("profileSlug")) });
      startTransition(() =>
        setStatus({
          kind: "success",
          message: `Person profile claimed as ${result.claimState.replace(/_/g, " ")}.`,
          href: result.profilePath,
        }),
      );
      event.currentTarget.reset();
    } catch (error) {
      startTransition(() => setStatus({ kind: "error", message: claimErrorMessage(error) }));
    }
  }

  async function submitCommunityDiscordClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

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
        }),
      );
      event.currentTarget.reset();
    } catch (error) {
      startTransition(() => setStatus({ kind: "error", message: claimErrorMessage(error) }));
    }
  }

  async function submitVrchatProof(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

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
        }),
      );
      event.currentTarget.reset();
    } catch (error) {
      startTransition(() => setStatus({ kind: "error", message: claimErrorMessage(error) }));
    }
  }

  const disabled = !emailVerified;

  return (
    <div className="rounded-[1.5rem] border border-border bg-white/45 px-5 py-5 lg:col-span-2">
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-muted">Profile claims</p>
      <div className="mt-3 rounded-[1rem] border border-border bg-surface-strong px-4 py-3 text-sm leading-6 text-muted">
        Claim actions require a verified email. Discord community ownership is recorded as a pending request until the Discord Administrator adapter verifies full Administrator permission.
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <form className="grid gap-3 rounded-[1.25rem] border border-border bg-surface-strong px-4 py-4" onSubmit={submitDiscordPersonClaim}>
          <h3 className="font-semibold tracking-[-0.02em]">Discord person claim</h3>
          <label className="grid gap-2 text-sm font-medium">
            Person slug
            <input className="rounded-2xl border border-border bg-surface px-4 py-3 font-normal outline-none focus:border-accent" name="profileSlug" placeholder="dj-celine" required />
          </label>
          <button className="rounded-full bg-accent px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60" disabled={disabled || !hasDiscord} type="submit">
            Claim with Discord
          </button>
          {!hasDiscord ? <p className="text-xs leading-5 text-muted">Link Discord before using this method.</p> : null}
        </form>

        <form className="grid gap-3 rounded-[1.25rem] border border-border bg-surface-strong px-4 py-4" onSubmit={submitCommunityDiscordClaim}>
          <h3 className="font-semibold tracking-[-0.02em]">Discord community claim</h3>
          <label className="grid gap-2 text-sm font-medium">
            Community slug
            <input className="rounded-2xl border border-border bg-surface px-4 py-3 font-normal outline-none focus:border-accent" name="profileSlug" placeholder="afterglow-social" required />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Discord guild ID
            <input className="rounded-2xl border border-border bg-surface px-4 py-3 font-normal outline-none focus:border-accent" name="discordGuildId" required />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Guild name
            <input className="rounded-2xl border border-border bg-surface px-4 py-3 font-normal outline-none focus:border-accent" name="discordGuildName" placeholder="Optional" />
          </label>
          <button className="rounded-full bg-accent px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60" disabled={disabled || !hasDiscord} type="submit">
            Request admin claim
          </button>
        </form>

        <form className="grid gap-3 rounded-[1.25rem] border border-border bg-surface-strong px-4 py-4" onSubmit={submitVrchatProof}>
          <h3 className="font-semibold tracking-[-0.02em]">VRChat proof code</h3>
          <label className="grid gap-2 text-sm font-medium">
            Profile slug
            <input className="rounded-2xl border border-border bg-surface px-4 py-3 font-normal outline-none focus:border-accent" name="profileSlug" placeholder="dj-celine" required />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Target type
            <select className="rounded-2xl border border-border bg-surface px-4 py-3 font-normal outline-none focus:border-accent" name="targetType" required>
              <option value="vrchat_user">VRChat user</option>
              <option value="vrchat_group">VRChat group</option>
              <option value="vrclinking">VRCLinking</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Target ID
            <input className="rounded-2xl border border-border bg-surface px-4 py-3 font-normal outline-none focus:border-accent" name="targetExternalId" required />
          </label>
          <button className="rounded-full bg-accent px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60" disabled={disabled} type="submit">
            Create proof code
          </button>
        </form>
      </div>

      {status.kind === "submitting" ? <p className="mt-4 text-sm text-muted">{status.label}</p> : null}
      {status.kind === "error" ? (
        <p className="mt-4 rounded-[1rem] border border-accent/35 bg-accent/10 px-4 py-3 text-sm leading-6 text-accent-strong">{status.message}</p>
      ) : null}
      {status.kind === "success" ? (
        <div className="mt-4 rounded-[1rem] border border-border bg-surface-strong px-4 py-3 text-sm leading-6 text-muted">
          <p>{status.message}</p>
          {status.proofCode ? <p className="mt-2 font-mono text-base text-foreground">{status.proofCode}</p> : null}
          {status.expiresAt ? <p className="mt-1 text-xs">Expires {new Date(status.expiresAt).toLocaleString()}</p> : null}
          {status.href ? (
            <Link className="mt-3 inline-flex rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground" href={status.href}>
              View profile
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AccountPanel() {
  const viewer = useQuery(api.accounts.viewer);
  const { signOut } = useAuthActions();

  if (!convexUrl) {
    return (
      <div className="rounded-[1.5rem] border border-dashed border-border bg-surface-strong px-5 py-5 text-sm leading-7 text-muted">
        Convex is not configured in this environment, so account state is unavailable.
      </div>
    );
  }

  if (viewer === undefined) {
    return <p className="text-sm text-muted">Loading account...</p>;
  }

  if (viewer === null) {
    return (
      <div className="rounded-[1.5rem] border border-border bg-surface-strong px-5 py-5">
        <h2 className="text-2xl font-semibold tracking-[-0.03em]">Not signed in</h2>
        <p className="mt-3 text-sm leading-7 text-muted">
          Sign in before submitting profiles, claiming ownership, or changing field privacy.
        </p>
        <Link
          className="mt-5 inline-flex rounded-full bg-accent px-5 py-3 text-sm font-medium text-white"
          href="/sign-in"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_0.8fr]">
      <div className="rounded-[1.5rem] border border-border bg-surface-strong px-5 py-5">
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
        <button
          className="mt-5 rounded-full border border-border bg-surface px-5 py-3 text-sm font-medium"
          type="button"
          onClick={() => void signOut()}
        >
          Sign out
        </button>
      </div>

      <div className="rounded-[1.5rem] border border-border bg-white/45 px-5 py-5">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-muted">Linked providers</p>
        <div className="mt-4 grid gap-3">
          {viewer.linkedProviders.length === 0 ? (
            <p className="text-sm text-muted">No providers linked yet.</p>
          ) : (
            viewer.linkedProviders.map((account) => (
              <div
                className="rounded-2xl border border-border bg-surface-strong px-4 py-3 text-sm"
                key={`${account.provider}:${account.providerAccountId}`}
              >
                <span className="font-medium capitalize">{account.provider}</span>
                <span className="ml-2 text-muted">
                  {account.emailVerified ? "email verified" : "linked"}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <ClaimActions
        emailVerified={viewer.user.emailVerified}
        hasDiscord={viewer.linkedProviders.some((account) => account.provider === "discord")}
      />
    </div>
  );
}
