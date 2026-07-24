import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export type VrdexMcpApiFixtureRequest = {
  authorization: string | undefined;
  body: unknown;
  method: string | undefined;
  pathname: string;
  searchParams: URLSearchParams;
};

function writeJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
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

async function handleFixtureRequest(
  request: IncomingMessage,
  response: ServerResponse,
  captured: VrdexMcpApiFixtureRequest[],
) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const body = await requestBody(request);

  captured.push({
    authorization: request.headers.authorization,
    body,
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

  if (url.pathname.endsWith("/api/v0/communities/basic-bit")) {
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
    if (
      body !== null &&
      typeof body === "object" &&
      "title" in body &&
      body.title === "Indeterminate Create"
    ) {
      response.destroy();

      return;
    }

    if (
      body !== null &&
      typeof body === "object" &&
      "title" in body &&
      body.title === "Readback Failure"
    ) {
      writeJson(response, 200, {
        eventId: "event_missing_readback",
        eventPath: "/events/missing-readback",
        slug: "missing-readback",
      });

      return;
    }

    if (
      body !== null &&
      typeof body === "object" &&
      "title" in body &&
      body.title === "Thrown Readback"
    ) {
      writeJson(response, 200, {
        eventId: "event_invalid_readback",
        eventPath: "/events/invalid-readback",
        slug: "invalid-readback",
      });

      return;
    }

    writeJson(response, 200, {
      eventId: "event_created",
      eventPath: "/events/created-club-night",
      slug: "created-club-night",
    });

    return;
  }

  if (url.pathname.endsWith("/api/v0/events/club-night") && request.method === "PATCH") {
    if (
      body !== null &&
      typeof body === "object" &&
      "summary" in body &&
      body.summary === "Indeterminate Update"
    ) {
      response.destroy();

      return;
    }

    writeJson(response, 200, {
      eventId: "event_1",
      eventPath: "/events/club-night",
      slug: "club-night",
    });

    return;
  }

  if (url.pathname.endsWith("/api/v0/events/invalid-readback")) {
    writeJson(response, 200, {});

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

export async function startVrdexMcpApiFixture() {
  const captured: VrdexMcpApiFixtureRequest[] = [];
  const server = createServer((request, response) => {
    void handleFixtureRequest(request, response, captured).catch((error: unknown) => {
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
    captured,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    origin: `http://127.0.0.1:${address.port}`,
  };
}
