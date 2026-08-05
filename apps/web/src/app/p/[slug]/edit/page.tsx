import { ProfileEditForm } from "../../../_components/profile-edit-form";
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
            <ProfileEditForm profilePath={`/p/${slug}`} slug={slug} />
          </div>
        </section>
      </PageContainer>
    </PageShell>
  );
}
