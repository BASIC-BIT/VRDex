import { notFound } from "next/navigation";
import { EventLineupFixture } from "./preview";
export const dynamic = "force-dynamic";
export default function Page() {
  if (process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true") notFound();
  return <EventLineupFixture />;
}
