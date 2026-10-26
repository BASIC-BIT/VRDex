import { notFound } from "next/navigation";
import { EventInventoryPreview } from "./preview";

export default async function EventInventoryFixturePage({ searchParams }: {
  searchParams: Promise<{ contributor?: string; session?: string }>;
}) {
  if (process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true") notFound();
  const params = await searchParams;
  return <EventInventoryPreview contributorOnly={params.contributor === "1"} session={params.session} />;
}
