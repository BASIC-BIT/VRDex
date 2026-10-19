import { notFound } from "next/navigation";
import { PersistentFixture } from "./preview";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ event?: string; kind?: string; view?: string }> }) {
  if (process.env.NODE_ENV === "production" || process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true") notFound();
  return <PersistentFixture {...await searchParams} />;
}
