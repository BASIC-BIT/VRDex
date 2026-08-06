import { ProfileEditForm } from "../../../_components/profile-edit-form";
import { ProfilePrivateRecord } from "../../../_components/profile-private-record";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export const dynamic = "force-dynamic";

type ProfileEditPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function PersonProfileEditPage({ params }: ProfileEditPageProps) {
  const { slug } = await params;

  return (
    <PageShell>
      <PageContainer max="3xl">
        <PageNav>
          <BrandLink />
        </PageNav>

        <section className="border-t border-border pt-8 sm:pt-10">
          <h1 className="text-3xl leading-tight font-semibold sm:text-4xl">Edit profile</h1>

          <div className="mt-8">
            <ProfileEditForm profilePath={`/p/${slug}`} profileType="person" slug={slug} />
          </div>
        </section>

        {/*
          The record's other mount is the public profile page, which both profile
          routes `notFound()` before rendering when a profile is draft-private,
          opted out, or suppressed -- so the owners whose record has no public
          page at all, accepted concierge handoffs among them, were the ones who
          could not reach it. This route does not gate on publication state and
          is already the owner's, so it reaches exactly them. Renders nothing for
          anyone the query refuses.
        */}
        <ProfilePrivateRecord profilePath={`/p/${slug}`} profileType="person" slug={slug} />
      </PageContainer>
    </PageShell>
  );
}
