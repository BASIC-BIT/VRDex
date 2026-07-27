import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api, internal } from "@convex-generated-api";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { oauthConsentSummary, oauthScopeLabel } from "@/lib/oauth-consent-copy";
import { convexAdminHttpClient, convexHttpClient } from "@/lib/server/convex-http";
import {
  invalidAuthSessionRedirectPath,
  isAuthSessionInvalidError,
} from "@/lib/server/invalid-auth-session";
import { oauthAuthorizeProblemDetail } from "@/lib/server/oauth-authorize-problem";
import {
  hashOAuthConsentTransactionValue,
  normalizeOAuthConsentTransactionValue,
} from "@/lib/server/oauth-consent-transaction";

type AuthorizeReviewPageProps = {
  searchParams: Promise<{ problem?: string | string[]; transaction?: string | string[] }>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function AuthorizationProblem({ detail }: { detail: string }) {
  return (
    <PageShell className="py-10">
      <PageContainer max="4xl">
        <PageNav>
          <BrandLink />
          <Link className={buttonVariants({ variant: "secondary" })} href="/developers/api">
            API docs
          </Link>
        </PageNav>

        <Card className="grid gap-4" padding="lg" surface="white">
          <h1 className="text-3xl font-semibold">Authorization request failed</h1>
          <Notice variant="error">{detail}</Notice>
        </Card>
      </PageContainer>
    </PageShell>
  );
}

export default async function AuthorizeReviewPage({ searchParams }: AuthorizeReviewPageProps) {
  const params = await searchParams;
  const problemDetail = oauthAuthorizeProblemDetail(firstParam(params.problem));

  if (problemDetail !== undefined) {
    return <AuthorizationProblem detail={problemDetail} />;
  }

  const transactionParam = firstParam(params.transaction);
  let transaction: string;

  try {
    transaction = normalizeOAuthConsentTransactionValue(transactionParam ?? "");
  } catch {
    return <AuthorizationProblem detail="The OAuth consent transaction is invalid or expired." />;
  }

  const authToken = await convexAuthNextjsToken();

  if (authToken === undefined) {
    const redirectTo = `/oauth/authorize/review?transaction=${encodeURIComponent(transaction)}`;
    redirect(`/sign-in?redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  const userConvex = convexHttpClient();
  userConvex.setAuth(authToken);

  let authorization: FunctionReturnType<
    typeof api.oauthConsentTransactions.get
  >;

  try {
    authorization = await userConvex.query(api.oauthConsentTransactions.get, {
      transactionHash: await hashOAuthConsentTransactionValue(transaction),
    });
  } catch (error) {
    if (isAuthSessionInvalidError(error)) {
      redirect(
        invalidAuthSessionRedirectPath(
          `/oauth/authorize/review?transaction=${encodeURIComponent(transaction)}`,
        ),
      );
    }

    throw error;
  }

  if (authorization === null) {
    return <AuthorizationProblem detail="The OAuth consent transaction is invalid or expired." />;
  }

  const client = await convexAdminHttpClient().query(internal.oauthApps.resolveAuthorizationClient, {
    clientId: authorization.clientId,
    redirectUri: authorization.redirectUri,
    requestedScopes: authorization.requestedScopes,
    resource: authorization.resource,
  });

  if (!client.ok) {
    return <AuthorizationProblem detail="This OAuth client cannot use the requested redirect URI, resource, or scopes." />;
  }

  return (
    <PageShell className="py-10">
      <PageContainer max="4xl">
        <PageNav>
          <BrandLink />
          <Link className={buttonVariants({ variant: "secondary" })} href="/account">
            Account
          </Link>
        </PageNav>

        <section className="grid gap-6">
          <div>
            <h1 className="text-4xl leading-none font-semibold sm:text-5xl">Authorize {client.displayName}</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted">
              {oauthConsentSummary}
            </p>
          </div>

          <Card className="grid gap-6" padding="lg" surface="white">
            <div className="grid gap-2">
              <p className="text-sm font-medium text-muted">Requested access</p>
              <ul className="grid gap-2">
                {authorization.requestedScopes.map((scope) => (
                  <li className="rounded-control border border-border bg-surface-strong px-4 py-3 text-sm" key={scope}>
                    {oauthScopeLabel(scope)}
                  </li>
                ))}
              </ul>
            </div>

            <dl className="grid gap-3 border-t border-border pt-5 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-muted">Redirect host</dt>
              <dd className="break-all">{new URL(authorization.redirectUri).host}</dd>
              <dt className="text-muted">Resource</dt>
              <dd className="break-all">{authorization.resource}</dd>
            </dl>

            <form action="/oauth/authorize/consent" className="flex flex-col gap-3 sm:flex-row" method="post">
              <input name="transaction" type="hidden" value={transaction} />
              <button className={buttonVariants({ size: "lg", variant: "primary" })} name="decision" type="submit" value="approve">
                Authorize
              </button>
              <button className={buttonVariants({ size: "lg", variant: "secondary" })} name="decision" type="submit" value="deny">
                Deny
              </button>
            </form>
          </Card>
        </section>
      </PageContainer>
    </PageShell>
  );
}
