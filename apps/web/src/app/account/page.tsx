import { AccountPanel } from "./account-panel";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ claim?: string | string[] }>;
}) {
  const rawClaim = (await searchParams).claim;
  const defaultClaimSlug =
    (Array.isArray(rawClaim) ? rawClaim[0] : rawClaim)?.trim().slice(0, 120) ?? "";

  return (
    <PageShell className="py-10">
      <PageContainer max="5xl">
        <PageNav>
          <BrandLink />
        </PageNav>

        <header className="py-5 sm:py-8">
          <h1 className="text-3xl font-semibold sm:text-4xl">Account</h1>
        </header>

        <AccountPanel defaultClaimSlug={defaultClaimSlug} />
      </PageContainer>
    </PageShell>
  );
}
