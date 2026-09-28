import { notFound } from "next/navigation";
import { EventIntakePreview } from "./preview";
import { EventIntakeRevisionPreview } from "./revision-preview";
export default async function EventIntakeFixturePage({ searchParams }: { searchParams: Promise<{ revision?: string }> }) {
  if (process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true") notFound();
  const { revision } = await searchParams;
  if (revision) return <EventIntakeRevisionPreview correction={revision === "correction"} />;
  return <EventIntakePreview />;
}
