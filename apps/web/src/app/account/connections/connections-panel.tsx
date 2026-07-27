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

export function ConnectionsPanel({ initialProfileSlug }: { initialProfileSlug?: string }) {
  const ownedProfiles = useQuery(api.profilePrivacy.listOwnedPrivacyProfilesForAccount);
  const [selectedSlug, setSelectedSlug] = useState(initialProfileSlug ?? "");
  // `initialProfileSlug` comes from a query parameter, so it may name a profile
  // the viewer does not own or one that does not exist. Constrain it to the
  // owned list before it reaches queries that throw on an unknown slug, rather
  // than failing the whole account page on a mistyped URL.
  const activeSlug =
    (ownedProfiles?.some((profile) => profile.slug === selectedSlug) ? selectedSlug : "") ||
    ownedProfiles?.[0]?.slug ||
    "";
  const connections = useQuery(
    api.profileConnections.listProfileConnections,
    activeSlug ? { profileSlug: activeSlug } : "skip",
  );
  const available = useQuery(
    api.profileConnections.listAvailableConnections,
    activeSlug ? { profileSlug: activeSlug } : "skip",
  );
  const activeProfileType = ownedProfiles?.find((profile) => profile.slug === activeSlug)?.profileType;
  // Community-only: the handler rejects person profiles outright, which would
  // fail the whole page rather than just this section.
  const vrclinkingCredentials = useQuery(
    api.vrclinkingCredentials.listCredentials,
    activeSlug && activeProfileType === "community" ? { profileSlug: activeSlug } : "skip",
  );
  const registerCredential = useMutation(api.vrclinkingCredentials.registerCredential);
  const revokeCredential = useMutation(api.vrclinkingCredentials.revokeCredential);
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

  async function submitDelegation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    await run(async () => {
      await registerCredential({
        profileSlug: activeSlug,
        guildId: String(data.get("delegationGuildId") ?? ""),
        secretRef: String(data.get("secretRef") ?? ""),
      });
      form.reset();
    });
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
  // A delegation only makes sense for a Discord server already connected here.
  const connectedGuilds = (connections?.connections ?? []).filter(
    (connection) => connection.assetType === "discord_guild",
  );
  const guildLabel = (guildId: string) =>
    connectedGuilds.find((connection) => connection.assetExternalId === guildId)
      ?.assetDisplayName ?? guildId;

  return (
    <div className="grid gap-8">
      <Field>
        Profile
        <Select
          name="profileSlug"
          value={activeSlug}
          onChange={(event) => setSelectedSlug(event.target.value)}
        >
          {ownedProfiles.map((profile) => (
            <option key={profile.slug} value={profile.slug}>
              {profile.displayName} ({profile.profileType})
            </option>
          ))}
        </Select>
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
          <h2 className="text-xl font-semibold">VRCLinking delegation</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            If your community uses VRCLinking, you can let VRDex read its Discord-to-VRChat links.
            VRDex only ever asks whether a given member is linked and verified.
          </p>
          <Notice className="mt-3">
            Optional, and not required for anything today. Set this up only if you already run
            VRCLinking and want VRDex ready to use it; there is nothing to gain from creating a
            credential for it otherwise.
          </Notice>

          {connectedGuilds.length === 0 && (vrclinkingCredentials?.length ?? 0) === 0 ? (
            <Notice className="mt-4">
              Connect a verified Discord server to this profile first. A delegation applies to one
              server.
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
                        variant="ghost"
                        onClick={() =>
                          void run(() =>
                            revokeCredential({
                              profileSlug: activeSlug,
                              guildId: credential.guildId,
                            }),
                          )
                        }
                      >
                        Revoke
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {connectedGuilds.length === 0 ? (
                // The delegation above outlived the connection it was created
                // for. Revoking it must stay reachable, but there is no server
                // left to attach a new one to.
                <Notice className="mt-4">
                  This profile has no connected Discord server. Reconnect one to add a delegation;
                  existing delegations stay revocable above.
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
                  Secret store reference
                  <Input
                    autoComplete="off"
                    name="secretRef"
                    placeholder="secret://my-community-vrclinking"
                    required
                    spellCheck={false}
                  />
                  <FieldText>
                    <strong>Do not paste your VRCLinking API key here.</strong> Store the key in the
                    operator secret store and enter its reference — either{" "}
                    <code>secret://name</code> or an{" "}
                    <code>arn:aws:secretsmanager:…</code> ARN. VRDex records the reference only; the
                    key itself is never sent to or stored by VRDex&apos;s database. A pasted key is
                    rejected.
                  </FieldText>
                </Field>
                <Button className="mt-4" disabled={busy} type="submit" variant="secondary">
                  Save delegation
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
