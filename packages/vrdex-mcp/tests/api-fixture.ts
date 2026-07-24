import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export type VrdexMcpApiFixtureRequest = {
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

function handleFixtureRequest(
  request: IncomingMessage,
  response: ServerResponse,
  captured: VrdexMcpApiFixtureRequest[],
) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  captured.push({ pathname: url.pathname, searchParams: url.searchParams });

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
  const server = createServer((request, response) => handleFixtureRequest(request, response, captured));

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
