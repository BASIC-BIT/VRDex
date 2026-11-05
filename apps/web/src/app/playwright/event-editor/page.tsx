import { notFound } from "next/navigation";

import { EventEditorPreview } from "./preview";
import { EventIdentityPreview } from "./identity-preview";

export const dynamic = "force-dynamic";

export default async function EventEditorFixturePage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; fail?: string; identity?: string }>;
}) {
  if (process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true") {
    notFound();
  }

  const { connected, fail, identity } = await searchParams;
  return identity === "picker" ? (
    <EventIdentityPreview />
  ) : (
    <EventEditorPreview connected={connected === "1"} fail={fail === "1"} />
  );
}
