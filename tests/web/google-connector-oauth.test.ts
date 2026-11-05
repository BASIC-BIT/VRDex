import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { it } from "node:test";
import { GOOGLE_CONNECTOR_SCOPES, encodeStateCookie, exchangeGoogleCode, googleAuthorizeUrl, readStateCookie } from "../../apps/web/src/lib/server/google-connector-oauth";

it("builds the consent URL with the fixed scopes, offline access, and forced consent", () => {
  const url = new URL(googleAuthorizeUrl({ clientId: "client-id", redirectUri: "https://vrdex.test/api/connectors/google/callback", state: "s1" }));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("scope"), GOOGLE_CONNECTOR_SCOPES.join(" "));
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "s1");
});

it("accepts only a cookie whose state matches the query", () => {
  const cookie = encodeStateCookie({ state: "s1", communitySlug: "basic-nights" });
  assert.deepEqual(readStateCookie(cookie, "s1"), { state: "s1", communitySlug: "basic-nights" });
  assert.equal(readStateCookie(cookie, "s2"), null);
  assert.equal(readStateCookie(undefined, "s1"), null);
  assert.equal(readStateCookie("not-base64-json", "s1"), null);
  assert.equal(readStateCookie(cookie, null), null);
});

const PRIMARY_CALENDAR = "https://www.googleapis.com/calendar/v3/users/me/calendarList/primary";
const tokenFetch = (token: Record<string, unknown>): typeof fetch => async (input) =>
  String(input) === PRIMARY_CALENDAR ? Response.json({ id: "organiser@example.com" }) : Response.json(token);

it("exchanges a code and reads the primary calendar ID", async () => {
  const token = tokenFetch({ access_token: "a", refresh_token: "rt", expires_in: 3600, scope: GOOGLE_CONNECTOR_SCOPES.join(" ") });
  let authorization: string | null = null;
  const result = await exchangeGoogleCode({ code: "c", redirectUri: "r", clientId: "i", clientSecret: "s",
    fetchImplementation: async (input, init) => {
      if (String(input) === PRIMARY_CALENDAR) authorization = new Headers(init?.headers).get("authorization");
      return token(input, init);
    } });
  assert.equal(result.refreshToken, "rt");
  assert.equal(result.externalAccountId, "organiser@example.com");
  assert.equal(authorization, "Bearer a");
});

it("refuses a grant missing a required scope", async () => {
  await assert.rejects(exchangeGoogleCode({ code: "c", redirectUri: "r", clientId: "i", clientSecret: "s",
    fetchImplementation: tokenFetch({ access_token: "a", refresh_token: "rt", expires_in: 3600, scope: GOOGLE_CONNECTOR_SCOPES[0] }) }), /GOOGLE_SCOPES_MISSING/);
});

it("refuses a grant without a refresh token", async () => {
  await assert.rejects(exchangeGoogleCode({ code: "c", redirectUri: "r", clientId: "i", clientSecret: "s",
    fetchImplementation: tokenFetch({ access_token: "a", expires_in: 3600, scope: GOOGLE_CONNECTOR_SCOPES.join(" ") }) }), /GOOGLE_REFRESH_TOKEN_MISSING/);
});

it("refuses a grant with no readable primary calendar and never echoes Google's answer", async () => {
  const withAnswer = (answer: () => Response): typeof fetch => async (input) => String(input) === PRIMARY_CALENDAR
    ? answer()
    : Response.json({ access_token: "a", refresh_token: "rt", expires_in: 3600, scope: GOOGLE_CONNECTOR_SCOPES.join(" ") });
  for (const answer of [() => Response.json({ kind: "secret-detail" }), () => new Response("secret-detail", { status: 200 }), () => Response.json({ id: "x" }, { status: 403 })]) {
    await assert.rejects(exchangeGoogleCode({ code: "c", redirectUri: "r", clientId: "i", clientSecret: "s", fetchImplementation: withAnswer(answer) }), /^Error: GOOGLE_ACCOUNT_UNKNOWN$/);
  }
  await assert.rejects(exchangeGoogleCode({ code: "c", redirectUri: "r", clientId: "i", clientSecret: "s",
    fetchImplementation: async () => Response.json({ error: "invalid_grant", error_description: "code c" }, { status: 400 }) }), /^Error: GOOGLE_TOKEN_400$/);
});

it("callback refuses a mismatched state or a short grant without reaching Convex", () => {
  execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { createRequire, registerHooks } from "node:module";
    import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
    import { tmpdir } from "node:os";
    import { join } from "node:path";
    import { pathToFileURL } from "node:url";
    const { NextRequest }=createRequire(join(process.cwd(),"apps/web/package.json"))("next/server");
    const state=globalThis.googleRoute={admin:0,fetches:0};
    globalThis.fetch=async()=>{state.fetches++;if(!state.token)throw new Error("unexpected fetch");return Response.json(state.token);};
    const sources={
      "@/lib/server/auth":'export const convexAuthToken=async()=>"session"; export const viewerQuery={}; export const unauthenticatedRedirectResponse=()=>new Response(null,{status:303}); export const isUnauthenticatedError=()=>false;',
      "@/lib/server/convex-http":'export const convexHttpClient=()=>({setAuth(){},query:async()=>({user:{id:"user"}})}); export const convexAdminHttpClient=()=>{globalThis.googleRoute.admin++;return {query:async()=>({}),action:async()=>({credentialId:"cred"})};};',
    };
    const directory=mkdtempSync(join(tmpdir(),"vrdex-google-route-"));
    const mocks=Object.fromEntries(Object.entries(sources).map(([key,source],i)=>{const path=join(directory,"mock-"+i+".mjs");writeFileSync(path,source);return [key,{url:pathToFileURL(path).href,path}];}));
    registerHooks({resolve(specifier,context,next){return mocks[specifier]?{url:mocks[specifier].url,shortCircuit:true}:next(specifier,context);}});
    try {
      const { encodeStateCookie }=await import("./apps/web/src/lib/server/google-connector-oauth.ts");
      const { GET }=await import("./apps/web/src/app/api/connectors/google/callback/route.ts");
      const cookie=encodeStateCookie({state:"s1",communitySlug:"basic-nights"});
      const response=await GET(new NextRequest("https://vrdex.test/api/connectors/google/callback?code=c&state=s2",{headers:{cookie:"vrdex_google_connector_state="+cookie}}));
      assert.ok(response.status>=300&&response.status<400);
      assert.ok(response.headers.get("location").endsWith("/account?googleCalendar=failed"),response.headers.get("location"));
      assert.match(response.headers.get("set-cookie"),/vrdex_google_connector_state=;/);
      assert.match(response.headers.get("set-cookie"),/Max-Age=0|Expires=Thu, 01 Jan 1970/);
      assert.deepEqual([state.admin,state.fetches],[0,0]);

      // A grant with one scope fails the exchange before Convex sees any token.
      state.token={access_token:"a",refresh_token:"rt",expires_in:3600,scope:"https://www.googleapis.com/auth/calendar.events"};
      const short=await GET(new NextRequest("https://vrdex.test/api/connectors/google/callback?code=c&state=s1",{headers:{cookie:"vrdex_google_connector_state="+cookie}}));
      assert.ok(short.status>=300&&short.status<400);
      assert.ok(short.headers.get("location").endsWith("/account/communities/basic-nights/integrations?googleCalendar=failed"),short.headers.get("location"));
      assert.match(short.headers.get("set-cookie"),/vrdex_google_connector_state=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i);
      assert.deepEqual([state.admin,state.fetches],[0,1]);
    } finally { for (const mock of Object.values(mocks)) unlinkSync(mock.path); rmdirSync(directory); }
  `], { cwd: process.cwd(), env: { ...process.env, TSX_TSCONFIG_PATH: "apps/web/tsconfig.json", GOOGLE_CONNECTOR_CLIENT_ID: "client-id", GOOGLE_CONNECTOR_CLIENT_SECRET: "client-secret" }, stdio: "pipe" });
});
