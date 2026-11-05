import { notFound } from "next/navigation";
import { Fixture, NativeFixture } from "./preview";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ native?: string }> }) {
  if (process.env.NODE_ENV === "production" || process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true") notFound();
  return (await searchParams).native === "true" ? <NativeFixture /> : <Fixture />;
}
