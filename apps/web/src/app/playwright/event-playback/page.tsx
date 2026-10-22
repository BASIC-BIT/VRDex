import { notFound } from "next/navigation";
import { PlaybackFixture } from "./preview";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ event?: string; kind?: string }> }) {
  if (process.env.NODE_ENV === "production" || process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true") notFound();
  const { event, kind } = await searchParams;
  return <PlaybackFixture eventId={event === "b" ? "b" : "a"} twitch={kind === "twitch"} />;
}
