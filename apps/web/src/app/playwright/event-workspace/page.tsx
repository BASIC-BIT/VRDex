import { notFound } from "next/navigation";
import { EventWorkspaceCheckpoint } from "./preview";

export default async function EventWorkspacePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true") notFound();
  return <EventWorkspaceCheckpoint view={(await searchParams).view ?? "inventory"} />;
}
