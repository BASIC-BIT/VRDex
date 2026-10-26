import { notFound } from "next/navigation";
import { EventOperatorFixture } from "./preview";
export default function Page() {
  if (process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true") notFound();
  return <EventOperatorFixture />;
}
