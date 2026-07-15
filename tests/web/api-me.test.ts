import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

function runMeRouteProbe(script: string) {
  return execFileSync(process.execPath, ["--import", "tsx", "-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: "apps/web/tsconfig.json",
      VRDEX_RATE_LIMIT_STORE: "memory",
    },
  });
}

describe("current API caller route", () => {
  it("requires a bearer credential", () => {
    const output = runMeRouteProbe(`
      import { GET } from "./apps/web/src/app/api/v0/me/route.ts";

      const response = await GET(new Request("https://app.example.test/api/v0/me"));
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^401/m);
    assert.match(output, /"title":"Bearer token required"/);
  });

  it("rejects bearer-token query parameters", () => {
    const output = runMeRouteProbe(`
      import { GET } from "./apps/web/src/app/api/v0/me/route.ts";

      const response = await GET(new Request("https://app.example.test/api/v0/me?token=secret"));
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^400/m);
    assert.match(output, /"title":"Bearer token query parameters are not allowed"/);
  });

  for (const route of [
    "me/profiles",
    "me/communities",
    "me/events",
  ]) {
    it(`requires a bearer credential for /api/v0/${route}`, () => {
      const output = runMeRouteProbe(`
        import { GET } from "./apps/web/src/app/api/v0/${route}/route.ts";

        const response = await GET(new Request("https://app.example.test/api/v0/${route}"));
        console.log(response.status);
        console.log(JSON.stringify(await response.json()));
      `);

      assert.match(output, /^401/m);
      assert.match(output, /"title":"Bearer token required"/);
    });

    it(`rejects bearer-token query parameters for /api/v0/${route}`, () => {
      const output = runMeRouteProbe(`
        import { GET } from "./apps/web/src/app/api/v0/${route}/route.ts";

        const response = await GET(new Request("https://app.example.test/api/v0/${route}?access_token=secret"));
        console.log(response.status);
        console.log(JSON.stringify(await response.json()));
      `);

      assert.match(output, /^400/m);
      assert.match(output, /"title":"Bearer token query parameters are not allowed"/);
    });
  }

  it("requires a bearer credential for event creation", () => {
    const output = runMeRouteProbe(`
      import { POST } from "./apps/web/src/app/api/v0/events/route.ts";

      const response = await POST(new Request("https://app.example.test/api/v0/events", {
        method: "POST",
        body: JSON.stringify({ title: "Club Night", communitySlug: "club-name", startAt: 1770000000000 }),
      }));
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^401/m);
    assert.match(output, /"title":"Bearer token required"/);
  });

  it("rejects bearer-token query parameters for event creation", () => {
    const output = runMeRouteProbe(`
      import { POST } from "./apps/web/src/app/api/v0/events/route.ts";

      const response = await POST(new Request("https://app.example.test/api/v0/events?token=secret", {
        method: "POST",
        body: JSON.stringify({ title: "Club Night", communitySlug: "club-name", startAt: 1770000000000 }),
      }));
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^400/m);
    assert.match(output, /"title":"Bearer token query parameters are not allowed"/);
  });

  it("requires a bearer credential for event updates", () => {
    const output = runMeRouteProbe(`
      import { PATCH } from "./apps/web/src/app/api/v0/events/[slug]/route.ts";

      const response = await PATCH(
        new Request("https://app.example.test/api/v0/events/club-night", {
          method: "PATCH",
          body: JSON.stringify({ title: "Club Night", communitySlug: "club-name", startAt: 1770000000000 }),
        }),
        { params: Promise.resolve({ slug: "club-night" }) },
      );
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^401/m);
    assert.match(output, /"title":"Bearer token required"/);
  });

  it("rejects bearer-token query parameters for event updates", () => {
    const output = runMeRouteProbe(`
      import { PATCH } from "./apps/web/src/app/api/v0/events/[slug]/route.ts";

      const response = await PATCH(
        new Request("https://app.example.test/api/v0/events/club-night?api_token=secret", {
          method: "PATCH",
          body: JSON.stringify({ title: "Club Night", communitySlug: "club-name", startAt: 1770000000000 }),
        }),
        { params: Promise.resolve({ slug: "club-night" }) },
      );
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^400/m);
    assert.match(output, /"title":"Bearer token query parameters are not allowed"/);
  });

  it("requires a bearer credential for profile updates", () => {
    const output = runMeRouteProbe(`
      import { PATCH } from "./apps/web/src/app/api/v0/profiles/[slug]/route.ts";

      const response = await PATCH(
        new Request("https://app.example.test/api/v0/profiles/artist-name", {
          method: "PATCH",
          body: JSON.stringify({ headline: "Updated profile" }),
        }),
        { params: Promise.resolve({ slug: "artist-name" }) },
      );
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^401/m);
    assert.match(output, /"title":"Bearer token required"/);
  });

  it("rejects bearer-token query parameters for profile updates", () => {
    const output = runMeRouteProbe(`
      import { PATCH } from "./apps/web/src/app/api/v0/profiles/[slug]/route.ts";

      const response = await PATCH(
        new Request("https://app.example.test/api/v0/profiles/artist-name?token=secret", {
          method: "PATCH",
          body: JSON.stringify({ headline: "Updated profile" }),
        }),
        { params: Promise.resolve({ slug: "artist-name" }) },
      );
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^400/m);
    assert.match(output, /"title":"Bearer token query parameters are not allowed"/);
  });

  it("requires a bearer credential for profile asset upload intents", () => {
    const output = runMeRouteProbe(`
      import { POST } from "./apps/web/src/app/api/v0/profiles/[slug]/assets/upload-intent/route.ts";

      const response = await POST(
        new Request("https://app.example.test/api/v0/profiles/artist-name/assets/upload-intent", {
          method: "POST",
          body: JSON.stringify({
            originalFileName: "logo.png",
            mimeType: "image/png",
            byteSize: 1024,
            placements: ["primary_logo"],
          }),
        }),
        { params: Promise.resolve({ slug: "artist-name" }) },
      );
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^401/m);
    assert.match(output, /"title":"Bearer token required"/);
  });

  it("rejects bearer-token query parameters for profile asset upload intents", () => {
    const output = runMeRouteProbe(`
      import { POST } from "./apps/web/src/app/api/v0/profiles/[slug]/assets/upload-intent/route.ts";

      const response = await POST(
        new Request("https://app.example.test/api/v0/profiles/artist-name/assets/upload-intent?access_token=secret", {
          method: "POST",
          body: JSON.stringify({
            originalFileName: "logo.png",
            mimeType: "image/png",
            byteSize: 1024,
            placements: ["primary_logo"],
          }),
        }),
        { params: Promise.resolve({ slug: "artist-name" }) },
      );
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^400/m);
    assert.match(output, /"title":"Bearer token query parameters are not allowed"/);
  });
});
