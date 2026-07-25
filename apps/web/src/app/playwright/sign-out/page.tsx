import { notFound } from "next/navigation";

import { SignOutPreview } from "./preview";

export default async function SignOutPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  if (process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true") {
    notFound();
  }

  const { state } = await searchParams;

  return <SignOutPreview shouldFail={state === "failure"} />;
}
