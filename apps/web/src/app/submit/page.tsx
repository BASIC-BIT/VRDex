import Link from "next/link";
import { cookies } from "next/headers";

import { ProfileSubmissionForm } from "./profile-submission-form";
import { buttonVariants } from "@/components/ui/button";
import { Card, Eyebrow } from "@/components/ui/card";
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
    <PageShell className="py-10">
      <PageContainer max="5xl">
        <PageNav>
          <BrandLink />
          <Link
            className={buttonVariants({ variant: "secondary" })}
            href="/server-status"
          >
            Server status
          </Link>
        </PageNav>

        <section className="overflow-hidden rounded-hero border border-border bg-surface shadow-hero backdrop-blur">
          <div className="grid gap-8 px-6 py-8 sm:px-8 lg:grid-cols-[0.85fr_1.15fr] lg:px-10 lg:py-10">
            <div className="flex flex-col justify-between gap-8">
              <div>
                <Eyebrow>Community submissions</Eyebrow>
                <h1 className="mt-5 text-4xl leading-none font-semibold tracking-[-0.04em] sm:text-6xl">
                  Add a missing VRChat scene profile.
                </h1>
                <p className="mt-5 max-w-xl text-base leading-7 text-muted sm:text-lg">
                  This first submission flow creates ordinary unclaimed profiles for people and communities. It keeps the field set narrow so community entries are useful without pretending to be owner-authored pages.
                </p>
              </div>

              <Card surface="strong">
                <Eyebrow>Safe by default</Eyebrow>
                <p className="mt-3 text-sm leading-7 text-muted">
                  {e2eMode
                    ? "This Playwright run uses a server-side test gate to exercise the same public submission data path without an interactive login."
                    : "Submission requires Convex auth, stores source attribution for later moderation, generates the canonical slug server-side, and publishes with an unclaimed trust state."}
                </p>
              </Card>
            </div>

            <Card surface="glass">
              <ProfileSubmissionForm e2eMode={e2eMode} />
            </Card>
          </div>
        </section>
      </PageContainer>
    </PageShell>
  );
}
