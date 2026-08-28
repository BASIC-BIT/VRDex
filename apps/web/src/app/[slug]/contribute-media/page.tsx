import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProfileMediaContributionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  if (
    process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED !== "true" &&
    process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true"
  ) {
    notFound();
  }
  const { slug } = await params;
  redirect(`/${encodeURIComponent(slug)}/edit#media-contributions`);
}
