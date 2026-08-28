import { ManagedEventsPanel } from "./managed-events-panel";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export const dynamic = "force-dynamic";

export default function ManagedEventsPage() {
  return (
    <PageShell className="py-10">
      <PageContainer max="5xl">
        <PageNav>
          <BrandLink />
        </PageNav>
        <ManagedEventsPanel />
      </PageContainer>
    </PageShell>
  );
}
