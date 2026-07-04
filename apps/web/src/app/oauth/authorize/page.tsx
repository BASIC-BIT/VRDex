import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api } from "@convex-generated-api";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { convexHttpClient } from "@/lib/server/convex-http";
import {
  normalizeOAuthAuthorizationRequest,
  type OAuthAuthorizationRequest,
} from "@/lib/server/oauth-authorization-request";
import { oauthScopeString } from "@/lib/server/oauth-jwt";

type AuthorizePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function urlSearchParamsFromRecord(params: Record<string, string | string[] | undefined>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    const firstValue = firstParam(value);

    if (firstValue !== undefined) {
      searchParams.set(key, firstValue);
    }
  }

  return searchParams;
}

async function requestForAuthorize(searchParams: URLSearchParams) {
  const headerList = await headers();
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";

  return new Request(`${proto}://${host}/oauth/authorize?${searchParams.toString()}`);
}

function scopeLabel(scope: string) {
  if (scope === "mcp:read") {
    return "Read public VRDex data through MCP";
  }

  if (scope === "public:read") {
    return "Read public API data";
  }

  return scope;
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

function HiddenAuthorizationFields({ authorization }: { authorization: OAuthAuthorizationRequest }) {
  return (
    <>
      <input name="response_type" type="hidden" value="code" />
      <input name="client_id" type="hidden" value={authorization.clientId} />
      <input name="redirect_uri" type="hidden" value={authorization.redirectUri} />
      <input name="resource" type="hidden" value={authorization.resource} />
      <input name="scope" type="hidden" value={oauthScopeString(authorization.requestedScopes)} />
      <input name="code_challenge" type="hidden" value={authorization.codeChallenge} />
      <input name="code_challenge_method" type="hidden" value={authorization.codeChallengeMethod} />
      {authorization.state === undefined ? null : <input name="state" type="hidden" value={authorization.state} />}
    </>
  );
}

export default async function AuthorizePage({ searchParams }: AuthorizePageProps) {
  const params = await searchParams;
  const normalizedParams = urlSearchParamsFromRecord(params);
  const request = await requestForAuthorize(normalizedParams);
  let authorization: OAuthAuthorizationRequest;

  try {
    authorization = normalizeOAuthAuthorizationRequest(normalizedParams, request);
  } catch (error) {
    return <AuthorizationProblem detail={error instanceof Error ? error.message : "The authorization request is invalid."} />;
  }

  const authToken = await convexAuthNextjsToken();

  if (authToken === undefined) {
    redirect(`/sign-in?redirectTo=${encodeURIComponent(`/oauth/authorize?${normalizedParams.toString()}`)}`);
  }

  const convex = convexHttpClient();

  convex.setAuth(authToken);

  const client = await convex.query(api.oauthApps.resolveAuthorizationClient, {
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
              This app is requesting access to public VRDex data for your signed-in account.
            </p>
          </div>

          <Card className="grid gap-6" padding="lg" surface="white">
            <div className="grid gap-2">
              <p className="text-sm font-medium text-muted">Requested access</p>
              <ul className="grid gap-2">
                {authorization.requestedScopes.map((scope) => (
                  <li className="rounded-control border border-border bg-surface-strong px-4 py-3 text-sm" key={scope}>
                    {scopeLabel(scope)}
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
              <HiddenAuthorizationFields authorization={authorization} />
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
