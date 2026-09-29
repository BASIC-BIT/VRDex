import { permanentRedirect } from "next/navigation";
export default async function TelemetryRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  permanentRedirect(`/account/communities/${encodeURIComponent(slug)}`);
}
