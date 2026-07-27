"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { api } from "@convex-generated-api";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldText } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { claimErrorMessage } from "@/lib/claim-errors";
import { cn } from "@/lib/cn";

type AssetType = "discord_guild" | "vrchat_group" | "vrchat_user";

const ASSET_LABELS: Record<AssetType, string> = {
  discord_guild: "Discord server",
  vrchat_group: "VRChat group",
  vrchat_user: "VRChat account",
};
const CONTROL_LEVEL_LABELS: Record<string, string> = {
  owner: "Owner",
  administrator: "Administrator",
  manager: "Manage Server",
  self: "You",
};

const selectClassName =
  "w-full rounded-input border border-border bg-surface px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

export function ConnectionsPanel({ initialProfileSlug }: { initialProfileSlug?: string }) {
  const ownedProfiles = useQuery(api.profilePrivacy.listOwnedPrivacyProfilesForAccount);
  const [selectedSlug, setSelectedSlug] = useState(initialProfileSlug ?? "");
  const activeSlug = selectedSlug || ownedProfiles?.[0]?.slug || "";
  const connections = useQuery(
    api.profileConnections.listProfileConnections,
    activeSlug ? { profileSlug: activeSlug } : "skip",
  );
  const available = useQuery(
    api.profileConnections.listAvailableConnections,
    activeSlug ? { profileSlug: activeSlug } : "skip",
  );
  const addConnection = useMutation(api.profileConnections.addVerifiedConnection);
  const setPrimary = useMutation(api.profileConnections.setPrimaryConnection);
  const removeConnection = useMutation(api.profileConnections.removeConnection);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(claimErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submitAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const raw = String(form.get("asset") ?? "");
    const separator = raw.indexOf(":");

    if (separator < 0) {
      return;
    }

    await run(() =>
      addConnection({
        profileSlug: activeSlug,
        assetType: raw.slice(0, separator) as AssetType,
        assetExternalId: raw.slice(separator + 1),
      }),
    );
  }

  if (ownedProfiles === undefined) {
    return <p className="text-sm text-muted">Loading your profiles…</p>;
  }

  if (ownedProfiles === null || ownedProfiles.length === 0) {
    return (
      <Notice>
        <p className="font-semibold">You do not manage any profiles yet.</p>
        <p className="mt-1">Claim a profile before connecting servers or groups to it.</p>
      </Notice>
    );
  }

  const verifyHref = `/api/discord/verify/start?returnTo=${encodeURIComponent(
    `/account/connections?profileSlug=${activeSlug}`,
  )}`;

  return (
    <div className="grid gap-8">
      <Field>
        Profile
        <select
          className={selectClassName}
          name="profileSlug"
          value={activeSlug}
          onChange={(event) => setSelectedSlug(event.target.value)}
        >
          {ownedProfiles.map((profile) => (
            <option key={profile.slug} value={profile.slug}>
              {profile.displayName} ({profile.profileType})
            </option>
          ))}
        </select>
        <FieldText>
          A community can hold several Discord servers and VRChat groups. One of each kind is the
          primary, which is the one shown first on the public profile.
        </FieldText>
      </Field>

      <section>
        <h2 className="text-xl font-semibold">Connected</h2>
        {connections === undefined ? (
          <p className="mt-3 text-sm text-muted">Loading connections…</p>
        ) : connections === null || connections.connections.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nothing is connected to this profile yet.</p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {connections.connections.map((connection) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-4"
                key={connection.id}
              >
                <div className="min-w-0">
                  <p className="font-medium break-words">
                    {connection.assetDisplayName ?? connection.assetExternalId}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {ASSET_LABELS[connection.assetType as AssetType]}
                    {connection.linkRole === "primary" ? " · Primary" : ""}
                    {connection.verified ? " · Verified" : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {connection.linkRole === "primary" ? null : (
                    <Button
                      disabled={busy}
                      variant="secondary"
                      onClick={() =>
                        void run(() =>
                          setPrimary({
                            profileSlug: activeSlug,
                            assetType: connection.assetType as AssetType,
                            assetExternalId: connection.assetExternalId,
                          }),
                        )
                      }
                    >
                      Make primary
                    </Button>
                  )}
                  <Button
                    disabled={busy}
                    variant="ghost"
                    onClick={() =>
                      void run(() =>
                        removeConnection({
                          profileSlug: activeSlug,
                          assetType: connection.assetType as AssetType,
                          assetExternalId: connection.assetExternalId,
                        }),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border-t border-border pt-6">
        <h2 className="text-xl font-semibold">Add a connection</h2>
        {available === undefined ? (
          <p className="mt-3 text-sm text-muted">Loading verified servers and groups…</p>
        ) : available.length === 0 ? (
          <Notice className="mt-4">
            <p className="font-semibold">Nothing left to connect.</p>
            <p className="mt-1">
              Only servers and groups you have proved you control can be connected. Verify more
              Discord servers, or complete a VRChat proof from the profile&apos;s claim page.
            </p>
            <Link className={cn(buttonVariants({ variant: "primary" }), "mt-4")} href={verifyHref}>
              Verify Discord servers
            </Link>
          </Notice>
        ) : (
          <form className="mt-4" onSubmit={submitAdd}>
            <Field>
              Verified server or group
              <select className={selectClassName} name="asset" required>
                {available.map((asset) => (
                  <option
                    key={`${asset.assetType}:${asset.assetExternalId}`}
                    value={`${asset.assetType}:${asset.assetExternalId}`}
                  >
                    {asset.assetDisplayName ?? asset.assetExternalId} (
                    {ASSET_LABELS[asset.assetType as AssetType]} ·{" "}
                    {CONTROL_LEVEL_LABELS[asset.controlLevel] ?? asset.controlLevel})
                  </option>
                ))}
              </select>
            </Field>
            <Button className="mt-4" disabled={busy} type="submit" variant="primary">
              Connect to this profile
            </Button>
          </form>
        )}
      </section>

      <div aria-live="polite">
        {error === null ? null : <Notice variant="error">{error}</Notice>}
      </div>
    </div>
  );
}
