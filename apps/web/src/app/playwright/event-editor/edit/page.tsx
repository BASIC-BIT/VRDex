import { notFound } from "next/navigation";

import { EventEditorEditPreview } from "../preview";

export const dynamic = "force-dynamic";

export default async function EventEditorEditFixturePage({
  searchParams,
}: {
  searchParams: Promise<{ fail?: string; flag?: string; past?: string; scope?: string; series?: string; state?: string }>;
}) {
  if (process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true") {
    notFound();
  }

  const { fail, flag, past, scope, series, state } = await searchParams;
  return <EventEditorEditPreview ended={state === "ended"} fail={fail === "1"} flagOff={flag === "off"} past={past === "1"} scope={scope} series={series === "1"} />;
}
