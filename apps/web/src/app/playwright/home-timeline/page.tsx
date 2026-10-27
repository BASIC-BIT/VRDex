import { notFound } from "next/navigation";
import { Preview } from "./preview";
export const dynamic = "force-dynamic";
export default function Page() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true"
  )
    notFound();
  return <Preview />;
}
