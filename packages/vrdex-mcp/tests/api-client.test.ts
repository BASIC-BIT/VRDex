import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";

import { createVrdexApiClient } from "../src/api-client";
import { normalizeApiBaseUrl } from "../src/config";

type FixtureRequest = {
  authorization: string | undefined;
  body: unknown;
  contentType: string | undefined;
  method: string | undefined;
  pathname: string;
  searchParams: URLSearchParams;
};

function writeJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

function eventPreview(slug = "club-night") {
  return {
    slug,
    source: { label: "VRDex", sourceType: "manual" },
    startAt: 1_798_761_600_000,
    title: "Club Night",
  };
}

async function requestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf8");

  return text ? (JSON.parse(text) as unknown) : undefined;
}

async function handleFixtureRequest(request: IncomingMessage, response: ServerResponse, requests: FixtureRequest[]) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const body = await requestBody(request);

  requests.push({
    authorization: request.headers.authorization,
    body,
    contentType: request.headers["content-type"],
    method: request.method,
    pathname: url.pathname,
    searchParams: url.searchParams,
  });

  if (url.pathname.endsWith("/api/v0/search")) {
    writeJson(response, 200, {
      query: url.searchParams.get("q") ?? "",
      type: url.searchParams.get("type") ?? "all",
      results: [
        {
          entityType: "event",
          routePath: "/events/club-night",
          score: 1,
          slug: "club-night",
          title: "Club Night",
        },
      ],
    });

    return;
  }

  if (url.pathname.endsWith("/api/v0/profiles/basic-bit")) {
    writeJson(response, 200, {
      displayName: "BASIC BIT",
      profileType: "community",
      slug: "basic-bit",
      telemetry: {
        schemaVersion: 1,
        rollupVersion: "community-telemetry-v1",
        freshness: "current",
        observedAt: 1798761600000,
        definitions: { currentPopulation: { unit: "people", grain: "latest_poll", gapPolicy: "omitted_when_stale" } },
        currentPopulation: { value: 42, activeInstanceCount: 2, observedAt: 1798761600000, coverage: "observed" },
      },
      trustLabel: "claimed_verified",
    });

    return;
  }

  if (url.pathname.endsWith("/api/v0/events") && request.method === "POST") {
    writeJson(response, 200, {
      eventId: "event_created",
      eventPath: "/events/created-club-night",
      slug: "created-club-night",
    });

    return;
  }

  if (url.pathname.endsWith("/api/v0/events/club-night") && request.method === "PATCH") {
    writeJson(response, 200, {
      eventId: "event_1",
      eventPath: "/events/club-night",
      slug: "club-night",
    });

    return;
  }

  if (url.pathname.endsWith("/api/v0/events/created-club-night")) {
    writeJson(response, 200, {
      ...eventPreview("created-club-night"),
      id: "event_created",
      watchSurfaceEnabled: false,
    });

    return;
  }

  if (url.pathname.endsWith("/api/v0/events/club-night")) {
    writeJson(response, 200, {
      ...eventPreview(),
      id: "event_1",
      watchSurfaceEnabled: false,
    });

    return;
  }

  if (url.pathname.endsWith("/api/v0/events/upcoming")) {
    writeJson(response, 200, { events: [eventPreview()] });

    return;
  }

  if (url.pathname.endsWith("/api/v0/worlds/club-world")) {
    writeJson(response, 200, {
      creatorAttributions: [],
      displayName: "Club World",
      media: [],
      outboundLinks: [],
      platformCompatibility: [],
      slug: "club-world",
      tags: [],
      visibilityStatus: "public",
    });

    return;
  }

  if (url.pathname.endsWith("/api/v0/worlds/active")) {
    writeJson(response, 200, {
      worlds: [
        {
          activityLabel: "Hosting upcoming events",
          displayName: "Club World",
          nextEvent: eventPreview(),
          slug: "club-world",
          tags: [],
          upcomingEventCount: 1,
        },
      ],
    });

    return;
  }

  writeJson(response, 404, {
    status: 404,
    title: "Not found",
    type: "about:blank",
  });
}

async function startFixtureServer() {
  const requests: FixtureRequest[] = [];
  const server = createServer((request, response) => {
    void handleFixtureRequest(request, response, requests).catch((error: unknown) => {
      writeJson(response, 500, {
        detail: error instanceof Error ? error.message : "Fixture request failed.",
        status: 500,
        title: "Fixture error",
      });
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert(address !== null && typeof address === "object");

  return {
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    origin: `http://127.0.0.1:${address.port}`,
    requests,
  };
}

test("calls public API routes with bearer credentials and validates schemas", async () => {
  const fixture = await startFixtureServer();

  try {
    const client = createVrdexApiClient({
      apiBaseUrl: normalizeApiBaseUrl(`${fixture.origin}/custom-root`),
      bearerToken: "vrdx_test_token",
      outputMode: "compact",
    });
    const search = await client.search({ limit: 2, query: "club", type: "event" });
    const profile = await client.getProfile({ slug: "basic-bit" });
    const event = await client.getEvent("club-night");
    const upcoming = await client.listUpcomingEvents({ limit: 1 });
    const world = await client.getWorld("club-world");
    const activeWorlds = await client.listActiveWorlds({ limit: 1 });
    const created = await client.createEvent({
      communitySlug: "basic-bit",
      startAt: 1_798_761_600_000,
      title: "Created Club Night",
    });
    const publicReadback = await client.getPublicEvent("created-club-night");
    const updated = await client.updateEvent("club-night", {
      summary: null,
    });

    assert.equal(search.ok, true);
    assert.equal(profile.ok, true);
    assert.equal(profile.ok ? profile.data.telemetry?.currentPopulation?.value : undefined, 42);
    assert.equal(event.ok, true);
    assert.equal(upcoming.ok, true);
    assert.equal(world.ok, true);
    assert.equal(activeWorlds.ok, true);
    assert.equal(created.ok, true);
    assert.equal(publicReadback.ok, true);
    assert.equal(updated.ok, true);
    assert.deepEqual(
      fixture.requests.map((request) => request.pathname),
      [
        "/custom-root/api/v0/search",
        "/custom-root/api/v0/profiles/basic-bit",
        "/custom-root/api/v0/events/club-night",
        "/custom-root/api/v0/events/upcoming",
        "/custom-root/api/v0/worlds/club-world",
        "/custom-root/api/v0/worlds/active",
        "/custom-root/api/v0/events",
        "/custom-root/api/v0/events/created-club-night",
        "/custom-root/api/v0/events/club-night",
      ],
    );
    assert.equal(fixture.requests[0]?.authorization, undefined);
    assert.equal(fixture.requests[0]?.searchParams.get("q"), "club");
    assert.equal(fixture.requests[0]?.searchParams.get("type"), "event");
    assert.equal(fixture.requests[0]?.searchParams.get("limit"), "2");
    assert.equal(fixture.requests[6]?.authorization, "Bearer vrdx_test_token");
    assert.equal(fixture.requests[6]?.contentType, "application/json");
    assert.equal(fixture.requests[6]?.method, "POST");
    assert.deepEqual(fixture.requests[6]?.body, {
      communitySlug: "basic-bit",
      startAt: 1_798_761_600_000,
      title: "Created Club Night",
    });
    assert.equal(fixture.requests[7]?.authorization, undefined);
    assert.equal(fixture.requests[8]?.authorization, "Bearer vrdx_test_token");
    assert.equal(fixture.requests[8]?.method, "PATCH");
    assert.deepEqual(fixture.requests[8]?.body, { summary: null });
  } finally {
    await fixture.close();
  }
});

test("returns structured failures for API problem responses", async () => {
  const server = createServer((_request, response) => {
    writeJson(
      response,
      429,
      {
        detail: "Slow down.",
        status: 429,
        title: "Too many requests",
        type: "about:blank",
      },
      { "retry-after": "15" },
    );
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert(address !== null && typeof address === "object");

  try {
    const client = createVrdexApiClient({
      apiBaseUrl: `http://127.0.0.1:${address.port}/api/v0`,
      outputMode: "compact",
    });
    const result = await client.getEvent("club-night");

    assert.deepEqual(result, {
      detail: "Slow down.",
      ok: false,
      retryAfter: "15",
      status: 429,
      title: "Too many requests",
      url: `http://127.0.0.1:${address.port}/api/v0/events/club-night`,
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
