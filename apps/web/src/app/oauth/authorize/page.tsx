import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { internal } from "@convex-generated-api";
import { isOAuthClientMetadataDocumentUrl } from "@vrdex/api-contracts";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import {
  apiRateLimitPolicyForRouteClass,
  checkApiRateLimit,
  clientIpForRequest,
} from "@/lib/server/api-rate-limit";
import { recordApiRateLimitBlockedEvent } from "@/lib/server/api-rate-limit-events";
import { convexAdminHttpClient } from "@/lib/server/convex-http";
import { fetchOAuthClientMetadataDocument } from "@/lib/server/oauth-client-metadata-document";
import {
  normalizeOAuthAuthorizationRequest,
  type OAuthAuthorizationRequest,
} from "@/lib/server/oauth-authorization-request";
import { oauthMcpResourceUri, oauthScopeString } from "@/lib/server/oauth-jwt";

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
  const requestHeaders = new Headers();
  const forwardedFor = headerList.get("x-forwarded-for");
  const realIp = headerList.get("x-real-ip");

  if (forwardedFor !== null) {
    requestHeaders.set("x-forwarded-for", forwardedFor);
  }

  if (realIp !== null) {
    requestHeaders.set("x-real-ip", realIp);
  }

  return new Request(`${proto}://${host}/oauth/authorize?${searchParams.toString()}`, {
    headers: requestHeaders,
  });
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

async function ensureClientMetadataDocumentClient(authorization: OAuthAuthorizationRequest, request: Request) {
  if (!isOAuthClientMetadataDocumentUrl(authorization.clientId)) {
    return;
  }

  if (authorization.resource !== oauthMcpResourceUri(request)) {
    throw new Error("Client metadata document clients can only request the hosted MCP resource.");
  }

  const identity = { kind: "ip" as const, value: clientIpForRequest(request) };
  const routeClass = "oauth_dynamic_client_registration";
  const policy = apiRateLimitPolicyForRouteClass(routeClass);
  const rateLimit = await checkApiRateLimit({
    identity,
    routeClass,
  });

  if (!rateLimit.allowed) {
    await recordApiRateLimitBlockedEvent({
      identity,
      quotaTier: "standard",
      rateLimit,
      routeClass,
      windowMs: policy.windowMs,
    });

    throw new Error("Too many client metadata document requests were sent from this network.");
  }

  const metadata = await fetchOAuthClientMetadataDocument(authorization.clientId);

  await convexAdminHttpClient().mutation(internal.oauthApps.upsertClientMetadataDocumentMcpClient, {
    clientId: metadata.clientId,
    clientName: metadata.clientName,
    ...(metadata.clientUri === undefined ? {} : { clientUri: metadata.clientUri }),
    ...(metadata.logoUri === undefined ? {} : { logoUri: metadata.logoUri }),
    redirectUris: metadata.redirectUris,
    grantTypes: metadata.grantTypes,
    responseTypes: metadata.responseTypes,
    tokenEndpointAuthMethod: metadata.tokenEndpointAuthMethod,
    contacts: metadata.contacts,
    ...(metadata.softwareId === undefined ? {} : { softwareId: metadata.softwareId }),
    ...(metadata.softwareVersion === undefined ? {} : { softwareVersion: metadata.softwareVersion }),
    allowedScopes: metadata.allowedScopes,
    resource: authorization.resource,
  });
}

export default async function AuthorizePage({ searchParams }: AuthorizePageProps) {
  const params = await searchParams;
  const normalizedParams = urlSearchParamsFromRecord(params);
  const request = await requestForAuthorize(normalizedParams);
  let authorization: OAuthAuthorizationRequest;

  try {
    authorization = normalizeOAuthAuthorizationRequest(normalizedParams, request);
    await ensureClientMetadataDocumentClient(authorization, request);
  } catch (error) {
    return <AuthorizationProblem detail={error instanceof Error ? error.message : "The authorization request is invalid."} />;
  }

  const authToken = await convexAuthNextjsToken();

  if (authToken === undefined) {
    redirect(`/sign-in?redirectTo=${encodeURIComponent(`/oauth/authorize?${normalizedParams.toString()}`)}`);
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
