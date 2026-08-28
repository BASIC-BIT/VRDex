import { MediaContributionsPanel } from "./media-contributions-panel";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export const dynamic = "force-dynamic";

export default function MediaContributionsPage() {
  return (
    <PageShell className="py-10">
      <PageContainer max="4xl">
        <PageNav>
          <BrandLink />
        </PageNav>
        <MediaContributionsPanel />
      </PageContainer>
    </PageShell>
  );
}
