import { CommunityTelemetryDashboard } from "./community-telemetry-dashboard";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export default async function CommunityTelemetryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PageShell><PageContainer max="6xl"><PageNav><BrandLink /></PageNav><CommunityTelemetryDashboard communitySlug={slug} /></PageContainer></PageShell>;
}
