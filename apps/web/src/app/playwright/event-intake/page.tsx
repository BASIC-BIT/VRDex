import { notFound } from "next/navigation";
import { EventIntakePreview } from "./preview";
import { EventIntakeRevisionPreview } from "./revision-preview";
export default async function EventIntakeFixturePage({ searchParams }: { searchParams: Promise<{ revision?: string; source?: string; community?: string }> }) {
  if (process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true") notFound();
  const { revision, source, community } = await searchParams;
  if (source) return <EventIntakeRevisionPreview correction={false} sourceMode={source} />;
  if (revision) return <EventIntakeRevisionPreview correction={revision === "correction" || revision === "staff"} staff={revision === "staff"} initialCommunitySlug={revision === "initial" ? community : undefined} />;
  return <EventIntakePreview />;
}
