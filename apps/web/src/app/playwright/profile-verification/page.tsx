import { notFound } from "next/navigation";
import type { PublicVerifiedConnection } from "@vrdex/api-contracts";
import { ProfileVerificationStatus } from "../../account/profile-verification-status";
import { ProfileVrcdnStreams } from "../../_components/profile-vrcdn-streams";
import { PageContainer, PageShell } from "@/components/ui/page-shell";
import { mergeVerifiedVrchatLinks } from "@/lib/profile-link-verification";
import { profileLinkPresentation } from "../../../../../../convex/_profileLinkPresentation";

export default async function ProfileVerificationPreview({ searchParams }: { searchParams: Promise<{ links?: string }> }) {
  if (process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true") notFound();
  const scenario = (await searchParams).links;
  const connection: PublicVerifiedConnection = {
    assetType: "vrchat_user", assetExternalId: "usr_11111111-2222-3333-4444-555555555555",
    url: "https://vrchat.com/home/user/usr_11111111-2222-3333-4444-555555555555",
    displayName: scenario === "fallback" ? undefined : "Example DJ", verifiedAt: Date.UTC(2026, 9, 25), linkRole: "primary",
  };
  const connections = scenario === "revoked" ? [] : [connection];
  const links = mergeVerifiedVrchatLinks([
    ...(scenario === "missing" ? [] : [{ type: "vrchat_profile", url: connection.url, label: connection.displayName || connection.assetExternalId, labelMode: "custom" as const }]),
    { type: "website", url: "https://example.com", label: "Website" },
  ], connections);
  return (
    <PageShell>
      <PageContainer max="6xl">
        <h1 className="py-8 text-3xl font-semibold">Account</h1>
        <dl className="flex gap-3"><dt>Email status</dt><dd>Verified</dd></dl>
        <section aria-label="Connected profile" className="mt-8 flex flex-wrap items-center justify-between gap-3 border-y border-border py-4">
          <span>Example profile</span>
          <div className="flex flex-wrap items-center gap-3"><ProfileVerificationStatus slug="example-dj" connections={connections} /></div>
        </section>
        <section aria-label="Unverified connection" className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-4">
          <span>Another profile</span>
          <ProfileVerificationStatus slug="another-profile" connections={[]} />
        </section>
        <section aria-label="Public Links">
          <ProfileVrcdnStreams discordHandles={[]} profileSlug="example-dj" streams={[]} links={links.map(link => ({
            href: link.url, key: link.url, ...profileLinkPresentation({ ...link, type: link.type ?? "website" }), verifiedAt: link.verifiedAt,
          }))} />
        </section>
      </PageContainer>
    </PageShell>
  );
}
