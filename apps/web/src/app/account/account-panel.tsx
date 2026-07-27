"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import Link from "next/link";
import { Component, type ReactNode } from "react";

import { api } from "@convex-generated-api";
import { buttonVariants, Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { requestBrowserSignOut } from "@/lib/auth-session";
import { cn } from "@/lib/cn";
import { ownerProfileDestinationPath, profileClaimPath } from "@/lib/profile-claim";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

function ConnectedAccountPanel({ mediaKitEnabled }: { mediaKitEnabled: boolean }) {
  const viewer = useQuery(api.accounts.viewer);
  const ownedProfiles = useQuery(api.profilePrivacy.listOwnedPrivacyProfilesForAccount);
  const { signOut } = useAuthActions();

  if (viewer === undefined || ownedProfiles === undefined) {
    return <p className="text-sm text-muted">Loading account…</p>;
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
            <Link className={buttonVariants({ variant: "secondary" })} href="/account/privacy">Privacy controls</Link>
            <Link className={buttonVariants({ variant: "secondary" })} href="/account/appearance">Personalization</Link>
            <Link className={buttonVariants({ variant: "secondary" })} href="/account/security">Security</Link>
            {mediaKitEnabled ? (
              <Link className={buttonVariants({ variant: "secondary" })} href="/account/media-kit">Media kit</Link>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              onClick={async () => {
                await requestBrowserSignOut(signOut);
                window.location.assign("/sign-in");
              }}
            >
              Sign out
            </Button>
          </div>
        </div>

        <div className="lg:border-l lg:border-border lg:pl-8">
          <h2 className="text-lg font-semibold">Sign-in methods</h2>
          <ul className="mt-4 divide-y divide-border border-y border-border text-sm">
            {viewer.linkedProviders.length === 0 ? (
              <li className="py-3 text-muted">No sign-in methods linked.</li>
            ) : viewer.linkedProviders.map((account) => (
              <li className="flex items-center justify-between gap-4 py-3" key={`${account.provider}:${account.providerAccountId}`}>
                <span className="font-medium capitalize">{account.provider}</span>
                <span className="text-muted">{account.emailVerified ? "Verified email" : "Connected"}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="profiles-heading" className="border-t border-border py-8">
        <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <h2 className="text-2xl font-semibold" id="profiles-heading">Your profiles</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
              Claiming confirms control of a specific profile. Linking a sign-in method only changes how you access your account.
            </p>
          </div>
          <Link className={buttonVariants({ variant: "primary" })} href="/search">
            Find a profile
          </Link>
        </div>
        {ownedProfiles && ownedProfiles.length > 0 ? (
          <ul className="mt-5 divide-y divide-border border-y border-border">
            {ownedProfiles.map((profile) => {
              const profilePath = ownerProfileDestinationPath(
                profile,
                profileClaimPath(profile.slug, "account"),
              );

              return (
                <li className="flex flex-wrap items-center justify-between gap-3 py-4" key={profile.profileId}>
                  <div>
                    <Link className="font-medium underline underline-offset-4" href={profilePath}>
                      {profile.displayName}
                    </Link>
                    <p className="mt-1 text-sm text-muted">
                      {profile.claimState === "claimed_verified" ? "Verified owner" : "Owner · Verification available"}
                    </p>
                  </div>
                  {profile.claimState === "claimed_unverified" ? (
                    <Link
                      className={buttonVariants({ size: "sm", variant: "secondary" })}
                      href={profileClaimPath(profile.slug, "account")}
                    >
                      Verify with VRChat
                    </Link>
                  ) : null}
                  {mediaKitEnabled ? (
                    <Link
                      className={buttonVariants({ size: "sm", variant: "secondary" })}
                      href={`/account/media-kit?profile=${encodeURIComponent(profile.slug)}`}
                    >
                      Manage media
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <Notice className="mt-5" variant="dashed">
            Open an unclaimed profile and choose <strong>Claim profile</strong>.
          </Notice>
        )}
      </section>
    </div>
  );
}

class AccountPanelErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    return this.state.hasError ? (
      <Notice className="leading-7" variant="dashed">
        Account details are temporarily unavailable. Try again shortly.
      </Notice>
    ) : this.props.children;
  }
}

export function AccountPanel({ mediaKitEnabled }: { mediaKitEnabled: boolean }) {
  if (!convexUrl) {
    return (
      <Notice className="leading-7" variant="dashed">
        Account details are temporarily unavailable. Try again shortly.
      </Notice>
    );
  }

  return (
    <AccountPanelErrorBoundary>
      <ConnectedAccountPanel mediaKitEnabled={mediaKitEnabled} />
    </AccountPanelErrorBoundary>
  );
}
