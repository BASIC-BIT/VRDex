import { EventIntakeForm } from "../event-intake-form";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
export default async function NewEventPage({ searchParams }: { searchParams: Promise<{ draft?: string; community?: string }> }) {
  const params = await searchParams;
  return <PageShell className="py-10"><PageContainer max="6xl"><PageNav><BrandLink /></PageNav><h1 className="mb-8 text-3xl font-semibold">Add event</h1><EventIntakeForm draftId={params.draft} initialCommunitySlug={params.community} /></PageContainer></PageShell>;
}
