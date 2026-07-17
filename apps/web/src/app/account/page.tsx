import { AccountPanel } from "./account-panel";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ claim?: string | string[]; claimType?: string | string[] }>;
}) {
  const resolvedSearchParams = await searchParams;
  const rawClaim = resolvedSearchParams.claim;
  const rawClaimType = Array.isArray(resolvedSearchParams.claimType)
    ? resolvedSearchParams.claimType[0]
    : resolvedSearchParams.claimType;
  const defaultClaimSlug =
    (Array.isArray(rawClaim) ? rawClaim[0] : rawClaim)?.trim().slice(0, 120) ?? "";
  const defaultClaimType = rawClaimType === "community" ? "community" : "person";

  return (
    <PageShell className="py-10">
      <PageContainer max="5xl">
        <PageNav>
          <BrandLink />
        </PageNav>

        <header className="py-5 sm:py-8">
          <h1 className="text-3xl font-semibold sm:text-4xl">Account</h1>
        </header>

        <AccountPanel defaultClaimSlug={defaultClaimSlug} defaultClaimType={defaultClaimType} />
      </PageContainer>
    </PageShell>
  );
}
