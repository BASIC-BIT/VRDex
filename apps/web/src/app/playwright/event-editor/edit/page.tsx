import { notFound } from "next/navigation";

import { EventEditorEditPreview } from "../preview";

export const dynamic = "force-dynamic";

export default async function EventEditorEditFixturePage({
  searchParams,
}: {
  searchParams: Promise<{ fail?: string; scope?: string; series?: string }>;
}) {
  if (process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true") {
    notFound();
  }

  const { fail, scope, series } = await searchParams;
  return <EventEditorEditPreview fail={fail === "1"} scope={scope} series={series === "1"} />;
}
