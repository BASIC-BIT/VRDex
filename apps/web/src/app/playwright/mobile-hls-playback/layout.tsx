import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ComposedFixture } from "../event-lineup-live/preview";
export const dynamic = "force-dynamic";
export default function Layout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === "production" || process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true") notFound();
  return <ComposedFixture>{children}</ComposedFixture>;
}
