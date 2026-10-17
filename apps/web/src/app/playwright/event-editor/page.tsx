import { notFound } from "next/navigation";

import { EventEditorPreview } from "./preview";
import { EventIdentityPreview } from "./identity-preview";

export const dynamic = "force-dynamic";

export default async function EventEditorFixturePage({
  searchParams,
}: {
  searchParams: Promise<{ identity?: string }>;
}) {
  if (process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true") {
    notFound();
  }

  return (await searchParams).identity === "picker" ? (
    <EventIdentityPreview />
  ) : (
    <EventEditorPreview />
  );
}
