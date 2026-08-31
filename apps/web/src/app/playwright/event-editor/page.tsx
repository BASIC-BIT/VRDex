import { notFound } from "next/navigation";

import { EventEditorPreview } from "./preview";

export default function EventEditorFixturePage() {
  if (process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true") {
    notFound();
  }

  return <EventEditorPreview />;
}
