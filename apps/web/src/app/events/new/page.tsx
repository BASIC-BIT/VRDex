import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { EventIntakeForm } from "../event-intake-form";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
export default async function NewEventPage({ searchParams }: { searchParams: Promise<{ draft?: string; community?: string }> }) {
  const params = await searchParams;
  return <PageShell className="py-10"><PageContainer max="6xl"><PageNav showMyEvents={false}><BrandLink /><Link className={buttonVariants({ variant: "secondary" })} href="/account/events">My events</Link></PageNav><EventIntakeForm heading={<h1 className="text-3xl font-semibold">Add event</h1>} draftId={params.draft} initialCommunitySlug={params.community} /></PageContainer></PageShell>;
}
