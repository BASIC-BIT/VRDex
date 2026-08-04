"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { api } from "@convex-generated-api";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldText, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { claimErrorMessage } from "@/lib/claim-errors";

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

/**
 * Injected data for the Playwright fixture route, mirroring `ClaimFlow`'s
 * `previewContext`. The visual loop the UI rule requires needs this surface
 * rendered deterministically without an account or a live backend.
 */
export type ConnectionsPreview = {
  ownedProfiles: { slug: string; displayName: string; profileType: "person" | "community" }[];
  connections: {
    id: string;
    assetType: AssetType;
    assetExternalId: string;
    assetDisplayName?: string;
    linkRole: "primary" | "secondary";
    verified: boolean;
  }[];
  available: {
    assetType: AssetType;
    assetExternalId: string;
    assetDisplayName?: string;
    controlLevel: string;
  }[];
  credentials: { guildId: string; lastUsedAt?: number; lastConsultedAt?: number }[];
};

export function ConnectionsPanel({
  delegationEnabled = false,
  initialProfileSlug,
  preview,
}: {
  /** Whether this deployment can store a pasted VRCLinking key at all. */
  delegationEnabled?: boolean;
  initialProfileSlug?: string;
  preview?: ConnectionsPreview;
}) {
  const queriedOwnedProfiles = useQuery(
    api.profilePrivacy.listOwnedPrivacyProfilesForAccount,
    preview ? "skip" : {},
  );
  const ownedProfiles = preview?.ownedProfiles ?? queriedOwnedProfiles;
  // Derived, not held: the workspace above this panel owns the choice and puts
  // it in the URL, so local state would only be a second copy to fall out of
  // sync with the tab links.
  //
  // `initialProfileSlug` comes from a query parameter, so it may name a profile
  // the viewer does not own or one that does not exist. Constrain it to the
  // owned list before it reaches queries that throw on an unknown slug, rather
  // than failing the whole account page on a mistyped URL.
  const activeSlug =
    (ownedProfiles?.some((profile) => profile.slug === initialProfileSlug)
      ? initialProfileSlug
      : "") ||
    ownedProfiles?.[0]?.slug ||
    "";
  const queriedConnections = useQuery(
    api.profileConnections.listProfileConnections,
    activeSlug && !preview ? { profileSlug: activeSlug } : "skip",
  );
  const connections = preview
    ? { isManager: true, connections: preview.connections }
    : queriedConnections;
  const queriedAvailable = useQuery(
    api.profileConnections.listAvailableConnections,
    activeSlug && !preview ? { profileSlug: activeSlug } : "skip",
  );
  const available = preview?.available ?? queriedAvailable;
  const activeProfileType = ownedProfiles?.find((profile) => profile.slug === activeSlug)?.profileType;
  // Community-only: the handler rejects person profiles outright, which would
  // fail the whole page rather than just this section.
  const queriedCredentials = useQuery(
    api.vrclinkingCredentials.listCredentials,
    activeSlug && activeProfileType === "community" && !preview
      ? { profileSlug: activeSlug }
      : "skip",
  );
  const vrclinkingCredentials = preview?.credentials ?? queriedCredentials;
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
      // A plain `Error` here was thrown by this component against a route
      // response, so its message is already the thing to show. Only Convex
      // failures need the structured-code mapping, and running them all through
      // it replaced the route's reason with the generic fallback.
      setError(
        caught instanceof Error && caught.name === "Error"
          ? caught.message
          : claimErrorMessage(caught),
      );
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

  /**
   * Posted to a route rather than straight to Convex.
   *
   * The key has to reach the operator secret store and must not reach Convex's
   * database, so the route is the only party that sees it: it reserves a row to
   * name the key, writes the key, and only then activates the delegation Convex
   * records.
   */
  async function submitDelegation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    await run(async () => {
      const response = await fetch("/api/account/vrclinking-delegation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profileSlug: activeSlug,
          guildId: String(data.get("delegationGuildId") ?? ""),
          apiKey: String(data.get("apiKey") ?? ""),
        }),
      });

      if (!response.ok) {
        const problem: unknown = await response.json().catch(() => null);
        const detail =
          problem !== null && typeof problem === "object" && "detail" in problem
            ? String((problem as { detail?: unknown }).detail ?? "")
            : "";

        throw new Error(detail || "That delegation could not be saved. Try again.");
      }

      form.reset();
    });
  }

  /**
   * Through the route, like saving one: revoking the row does not remove the
   * key, and only the route can reach the store that holds it.
   */
  async function revokeDelegation(guildId: string) {
    const response = await fetch("/api/account/vrclinking-delegation", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profileSlug: activeSlug, guildId }),
    });

    if (!response.ok) {
      const problem: unknown = await response.json().catch(() => null);
      const detail =
        problem !== null && typeof problem === "object" && "detail" in problem
          ? String((problem as { detail?: unknown }).detail ?? "")
          : "";

      throw new Error(detail || "That key could not be revoked. Try again.");
    }
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
  const activeProfile = ownedProfiles.find((profile) => profile.slug === activeSlug);
  // A delegation only makes sense for a Discord server already connected here,
  // and only one whose control proof is still live: links deliberately outlive
  // their proofs, and `reserveCredential` rejects an unproved server outright.
  // Offering it in the picker only produces an error on submit.
  const connectedGuilds = (connections?.connections ?? []).filter(
    (connection) => connection.assetType === "discord_guild" && connection.verified,
  );
  const guildLabel = (guildId: string) =>
    connectedGuilds.find((connection) => connection.assetExternalId === guildId)
      ?.assetDisplayName ?? guildId;

  return (
    <div className="grid gap-8">
      <p className="text-sm leading-6 text-muted">
        A community can hold several Discord servers and VRChat groups. One of each kind is the
        primary.
      </p>

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
                  <p className="font-medium break-words" data-ph-no-capture>
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
                  {/* Confirmed, like the developer-token and OAuth-app
                      revokes: this drops a link that took an OAuth round-trip
                      or a VRChat proof to earn, and re-creating it means doing
                      that again. It was a single unguarded click. */}
                  <Button
                    disabled={busy}
                    variant="dangerGhost"
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Disconnect ${connection.assetDisplayName ?? connection.assetExternalId} from this profile? You will have to prove you control it again to reconnect.`,
                        )
                      ) {
                        return;
                      }

                      void run(() =>
                        removeConnection({
                          profileSlug: activeSlug,
                          assetType: connection.assetType as AssetType,
                          assetExternalId: connection.assetExternalId,
                        }),
                      );
                    }}
                  >
                    Disconnect
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
            <div className="mt-4 flex flex-wrap gap-2">
              <Link className={buttonVariants({ variant: "primary" })} href={verifyHref}>
                Verify Discord servers
              </Link>
              {activeSlug ? (
                // Encoded even though `activeSlug` can only be a slug the server
                // returned for this account: it originates in a query parameter,
                // and a link target is not the place to rely on that narrowing
                // holding forever.
                <Link
                  className={buttonVariants({ variant: "secondary" })}
                  href={`/claim/${encodeURIComponent(activeSlug)}`}
                >
                  Start a VRChat proof
                </Link>
              ) : null}
            </div>
          </Notice>
        ) : (
          <form className="mt-4" onSubmit={submitAdd}>
            <Field>
              Verified server or group
              {/* Option text is a raw usr_… id or a private server name;
                  maskAllInputs covers the select value, not the option text. */}
              <Select name="asset" required data-ph-no-capture>
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
              </Select>
            </Field>
            <Button className="mt-4" disabled={busy} type="submit" variant="primary">
              Connect to this profile
            </Button>
          </form>
        )}
      </section>

      {activeProfile?.profileType === "community" ? (
        <section className="border-t border-border pt-6">
          <h2 className="text-xl font-semibold">VRCLinking</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            If your server uses VRCLinking, share its API key and your members can claim their own
            VRDex profile without posting a proof code — VRDex asks your server whether they are
            linked and verified, and gets back only yes or no.
          </p>

          {!delegationEnabled && (vrclinkingCredentials?.length ?? 0) === 0 ? (
            // Said before the form, not after a submit. Without the grant this
            // deployment cannot store a key, and the previous shape let an owner
            // register a delegation that would never resolve — the feature read
            // as working right up until a member's claim silently found nothing.
            <Notice className="mt-4">
              VRCLinking is not available on this deployment yet.
            </Notice>
          ) : connectedGuilds.length === 0 && (vrclinkingCredentials?.length ?? 0) === 0 ? (
            <Notice className="mt-4">
              Connect a verified Discord server to this profile first. A key applies to one server.
            </Notice>
          ) : (
            <>
              {vrclinkingCredentials && vrclinkingCredentials.length > 0 ? (
                <ul className="mt-4 grid gap-3">
                  {vrclinkingCredentials.map((credential) => (
                    <li
                      className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-4"
                      key={credential.guildId}
                    >
                      <div className="min-w-0">
                        <p className="font-medium break-words" data-ph-no-capture>
                          {guildLabel(credential.guildId)}
                        </p>
                        <p className="mt-1 text-sm text-muted">
                          {credential.lastUsedAt
                            ? `Last matched ${new Date(credential.lastUsedAt).toLocaleString()}`
                            : credential.lastConsultedAt
                              ? `Last queried ${new Date(credential.lastConsultedAt).toLocaleString()} · no match yet`
                              : "Not used yet"}
                        </p>
                      </div>
                      <Button
                        disabled={busy}
                        variant="dangerGhost"
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Revoke the VRCLinking key for ${guildLabel(credential.guildId)}? VRDex will stop asking that server about member links.`,
                            )
                          ) {
                            return;
                          }

                          void run(() => revokeDelegation(credential.guildId));
                        }}
                      >
                        Revoke
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {connectedGuilds.length === 0 || !delegationEnabled ? (
                // The key above outlived the connection it was created for, or
                // this deployment can no longer store one. Revoking has to stay
                // reachable either way; adding a new one does not.
                <Notice className="mt-4">
                  {delegationEnabled
                    ? "This profile has no connected Discord server. Reconnect one to add a key; existing keys stay revocable above."
                    : "VRCLinking is not available on this deployment yet. Existing keys stay revocable above."}
                </Notice>
              ) : (
              <form className="mt-4" onSubmit={submitDelegation}>
                <Field>
                  Discord server
                  <Select name="delegationGuildId" required data-ph-no-capture>
                    {connectedGuilds.map((connection) => (
                      <option key={connection.assetExternalId} value={connection.assetExternalId}>
                        {connection.assetDisplayName ?? connection.assetExternalId}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field className="mt-4">
                  VRCLinking API key
                  <Input
                    autoComplete="off"
                    name="apiKey"
                    placeholder="Paste the key from your VRCLinking dashboard"
                    required
                    spellCheck={false}
                    type="password"
                  />
                  <FieldText>
                    The key is stored in VRDex&apos;s secret store, never in its database, and is
                    only ever used to ask whether one of your members is linked and verified.
                    Replace it here any time, or revoke it above.
                  </FieldText>
                </Field>
                <Button className="mt-4" disabled={busy} type="submit" variant="secondary">
                  Save key
                </Button>
              </form>
              )}
            </>
          )}
        </section>
      ) : null}

      <div aria-live="polite">
        {error === null ? null : <Notice variant="error">{error}</Notice>}
      </div>
    </div>
  );
}
