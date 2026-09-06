import { notFound } from "next/navigation";
import { ProfileVerificationStatus } from "../../account/profile-verification-status";
import { ProfileVrcdnStreams } from "../../_components/profile-vrcdn-streams";
import { PageContainer, PageShell } from "@/components/ui/page-shell";

export default function ProfileVerificationPreview() {
  if (process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true") notFound();
  return (
    <PageShell>
      <PageContainer max="6xl">
        <h1 className="py-8 text-3xl font-semibold">Account</h1>
        <dl className="flex gap-3"><dt>Email status</dt><dd>Verified</dd></dl>
        <section aria-label="Connected profile" className="mt-8 flex flex-wrap items-center justify-between gap-3 border-y border-border py-4">
          <span>Example DJ</span>
          <div className="flex flex-wrap items-center gap-3"><ProfileVerificationStatus slug="example-dj" verified /></div>
        </section>
        <section aria-label="Unverified connection" className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-4">
          <span>Another profile</span>
          <ProfileVerificationStatus slug="another-profile" verified={false} />
        </section>
        <ProfileVrcdnStreams discordHandles={[]} profileSlug="example-dj" streams={[]} links={[
          { href: "https://vrchat.com/home/user/usr_11111111-2222-3333-4444-555555555555", key: "verified", label: "VRChat", verified: true },
          { href: "https://example.com", key: "website", label: "Website" },
        ]} />
      </PageContainer>
    </PageShell>
  );
}
