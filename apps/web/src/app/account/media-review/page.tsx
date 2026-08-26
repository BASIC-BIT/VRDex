import { MediaReviewPanel } from "./media-review-panel";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export const dynamic = "force-dynamic";

export default function MediaReviewPage() {
  return (
    <PageShell className="py-10">
      <PageContainer max="5xl">
        <PageNav>
          <BrandLink />
        </PageNav>
        <MediaReviewPanel />
      </PageContainer>
    </PageShell>
  );
}
