import type { z } from "@vrdex/api-contracts";
import {
  PublicActiveWorldsResponseSchema,
  PublicEventSchema,
  PublicEventsResponseSchema,
  PublicProfileSchema,
  PublicSearchResponseSchema,
  PublicWorldSchema,
} from "@vrdex/api-contracts";

import type { VrdexMcpConfig } from "./config";

export type VrdexSearchType = "all" | "person" | "community" | "profile" | "world" | "event";
export type VrdexProfileType = "person" | "community";

export type VrdexApiSuccess<T> = {
  data: T;
  ok: true;
};

export type VrdexApiFailure = {
  detail?: string;
  ok: false;
  retryAfter?: string;
  status: number;
  title: string;
  url: string;
};

export type VrdexApiResult<T> = VrdexApiSuccess<T> | VrdexApiFailure;

type ResponseSchema<T> = {
  parse(value: unknown): T;
};

type ApiClientOptions = VrdexMcpConfig & {
  fetch?: typeof fetch;
  userAgent?: string;
};

export type VrdexApiClient = ReturnType<typeof createVrdexApiClient>;

function appendSearchParam(searchParams: URLSearchParams, key: string, value: number | string | undefined) {
  if (value !== undefined) {
    searchParams.set(key, String(value));
  }
}

function trimLeadingSlashes(value: string) {
  let start = 0;

  while (start < value.length && value.charCodeAt(start) === 47) {
    start += 1;
  }

  return value.slice(start);
}

function trimTrailingSlashes(value: string) {
  let end = value.length;

  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }

  return value.slice(0, end);
}

function buildApiUrl(apiBaseUrl: string, path: string, searchParams: Record<string, number | string | undefined> = {}) {
  const url = new URL(`${trimTrailingSlashes(apiBaseUrl)}/${trimLeadingSlashes(path)}`);

  for (const [key, value] of Object.entries(searchParams)) {
    appendSearchParam(url.searchParams, key, value);
  }

  return url;
}

async function parseResponseBody(response: Response) {
  const text = await response.text();

  if (!text.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function problemMessage(payload: unknown, fallbackTitle: string) {
  if (payload !== null && typeof payload === "object") {
    const title = "title" in payload && typeof payload.title === "string" ? payload.title : fallbackTitle;
    const detail = "detail" in payload && typeof payload.detail === "string" ? payload.detail : undefined;

    return { title, detail };
  }

  return { title: fallbackTitle, detail: undefined };
}

export function createVrdexApiClient(options: ApiClientOptions) {
  const fetcher = options.fetch ?? fetch;
  const userAgent = options.userAgent ?? "vrdex-mcp/0.0.0";

  async function get<T>(
    schema: ResponseSchema<T>,
    path: string,
    searchParams?: Record<string, number | string | undefined>,
  ): Promise<VrdexApiResult<T>> {
    const url = buildApiUrl(options.apiBaseUrl, path, searchParams);
    const headers = new Headers({
      accept: "application/json",
      "user-agent": userAgent,
    });

    if (options.bearerToken !== undefined) {
      headers.set("authorization", `Bearer ${options.bearerToken}`);
    }

    const response = await fetcher(url, { headers });
    const payload = await parseResponseBody(response);

    if (!response.ok) {
      const problem = problemMessage(payload, `VRDex API request failed with ${response.status}`);
      const retryAfter = response.headers.get("retry-after") ?? undefined;

      return {
        ok: false,
        status: response.status,
        title: problem.title,
        ...(problem.detail === undefined ? {} : { detail: problem.detail }),
        ...(retryAfter === undefined ? {} : { retryAfter }),
        url: url.toString(),
      };
    }

    return { ok: true, data: schema.parse(payload) };
  }

  return {
    get apiBaseUrl() {
      return options.apiBaseUrl;
    },
    getEvent(slug: string) {
      return get(PublicEventSchema, `events/${encodeURIComponent(slug)}`);
    },
    getProfile(input: { profileType?: VrdexProfileType; slug: string }) {
      const segment =
        input.profileType === "person" ? "people" : input.profileType === "community" ? "communities" : "profiles";

      return get(PublicProfileSchema, `${segment}/${encodeURIComponent(input.slug)}`);
    },
    getWorld(slug: string) {
      return get(PublicWorldSchema, `worlds/${encodeURIComponent(slug)}`);
    },
    listActiveWorlds(input: { limit?: number } = {}) {
      return get(PublicActiveWorldsResponseSchema, "worlds/active", { limit: input.limit });
    },
    listUpcomingEvents(input: { limit?: number } = {}) {
      return get(PublicEventsResponseSchema, "events/upcoming", { limit: input.limit });
    },
    search(input: { limit?: number; query: string; type?: VrdexSearchType }) {
      return get(PublicSearchResponseSchema, "search", {
        limit: input.limit,
        q: input.query,
        type: input.type,
      });
    },
  };
}

export type InferSchemaOutput<T extends z.ZodType> = z.infer<T>;
