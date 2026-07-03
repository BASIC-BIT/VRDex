import { notFound, redirect } from "next/navigation";

import { fetchPublicShortLinkTargetByCode } from "@/convex/server";

export const dynamic = "force-dynamic";

type ShortLinkPageProps = {
  params: Promise<{
    code: string;
  }>;
};

export default async function ShortLinkPage({ params }: ShortLinkPageProps) {
  const { code } = await params;
  const result = await fetchPublicShortLinkTargetByCode(code);

  if (result.target === null) {
    notFound();
  }

  redirect(result.target.path);
}
