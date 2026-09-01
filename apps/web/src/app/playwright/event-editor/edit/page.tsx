import { notFound } from "next/navigation";

import { EventEditorEditPreview } from "../preview";

export const dynamic = "force-dynamic";

export default function EventEditorEditFixturePage() {
  if (process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true") {
    notFound();
  }

  return <EventEditorEditPreview />;
}
