import { notFound } from "next/navigation";
import { EventIntakePreview } from "./preview";
export default function EventIntakeFixturePage() {
  if (process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true") notFound();
  return <EventIntakePreview />;
}
