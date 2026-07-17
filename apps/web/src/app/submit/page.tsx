import { cookies } from "next/headers";

import { ProfileSubmissionForm } from "./profile-submission-form";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

async function isE2eSubmissionMode() {
  const expectedToken = process.env.VRDEX_E2E_BROWSER_TOKEN?.trim();
  const cookieStore = await cookies();
  const requestToken = cookieStore.get("vrdex_e2e_token")?.value;

  return process.env.VRDEX_ENABLE_E2E_HELPERS === "true" && Boolean(expectedToken) && requestToken === expectedToken;
}

export default async function SubmitProfilePage() {
  const e2eMode = await isE2eSubmissionMode();

  return (
    <PageShell>
      <PageContainer max="3xl">
        <PageNav>
          <BrandLink />
        </PageNav>

        <section className="border-t border-border pt-8 sm:pt-10">
          <h1 className="text-3xl leading-tight font-semibold sm:text-4xl">
            Add a profile
          </h1>
          <p className="mt-2 text-sm text-muted">
            Add a person or community that is missing from VRDex.
          </p>

          <div className="mt-8">
            <ProfileSubmissionForm e2eMode={e2eMode} />
          </div>
        </section>
      </PageContainer>
    </PageShell>
  );
}
