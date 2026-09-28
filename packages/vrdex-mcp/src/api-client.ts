import type { z } from "@vrdex/api-contracts";
import { eventIntakeOperations, EventPosterBytesSchema, EventPosterUploadSchema, EVENT_POSTER_MAX_BYTES, type EventIntakeOperation } from "@vrdex/api-contracts";
import { createHash } from "node:crypto";
import {
  ApiEventCreateRequestSchema,
  ApiEventUpdateRequestSchema,
  ApiEventWriteResponseSchema,
  ApiMeProfilesResponseSchema,
  ApiProfileSubmitRequestSchema,
  ApiProfileUpdateRequestSchema,
  ApiProfileWriteResponseSchema,
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
export type VrdexEventCreateInput = z.infer<typeof ApiEventCreateRequestSchema>;
export type VrdexEventUpdateInput = z.infer<typeof ApiEventUpdateRequestSchema>;
export type VrdexProfileSubmitInput = z.infer<typeof ApiProfileSubmitRequestSchema>;
export type VrdexProfileUpdateInput = z.infer<typeof ApiProfileUpdateRequestSchema>;

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

  async function request<T>(
    schema: ResponseSchema<T>,
    path: string,
    requestOptions: {
      authenticate?: boolean;
      body?: unknown;
      idempotencyKey?: string;
      method?: "GET" | "PATCH" | "POST" | "DELETE";
      searchParams?: Record<string, number | string | undefined>;
    } = {},
  ): Promise<VrdexApiResult<T>> {
    const url = buildApiUrl(options.apiBaseUrl, path, requestOptions.searchParams);
    const headers = new Headers({
      accept: "application/json",
      "user-agent": userAgent,
    });

    if (requestOptions.authenticate !== false && options.bearerToken !== undefined) {
      headers.set("authorization", `Bearer ${options.bearerToken}`);
    }

    if (requestOptions.body !== undefined) {
      headers.set("content-type", "application/json");
    }

    if (requestOptions.idempotencyKey !== undefined) {
      headers.set("idempotency-key", requestOptions.idempotencyKey);
    }

    const response = await fetcher(url, {
      headers,
      method: requestOptions.method ?? "GET",
      ...(requestOptions.body === undefined ? {} : { body: JSON.stringify(requestOptions.body) }),
    });
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

  function get<T>(
    schema: ResponseSchema<T>,
    path: string,
    searchParams?: Record<string, number | string | undefined>,
  ) {
    return request(schema, path, { authenticate: false, searchParams });
  }

  async function eventIntake(operation: EventIntakeOperation, raw: unknown) {
    const contract = eventIntakeOperations[operation];
    const input = contract.input.parse(raw);
    const body: Record<string, unknown> = { ...input };
    const path = contract.path.replace(/\{(\w+)\}/g, (_match, key: string) => {
      const value = body[key];
      delete body[key];
      return encodeURIComponent(String(value));
    });
    return request<unknown>(contract.output, path, { method: contract.method,
      ...(contract.method === "GET" || contract.method === "DELETE" ? {} : { body }),
    });
  }
  return {
    eventIntake,
    async uploadEventPosterBytes(raw: unknown) {
      if (!options.posterUploadOrigin) throw new Error("Configure the poster upload origin.");
      const allowed = new URL(options.posterUploadOrigin);
      if (allowed.protocol !== "https:" || allowed.username || allowed.password || allowed.origin !== options.posterUploadOrigin) throw new Error("Invalid poster upload origin.");
      const input = EventPosterBytesSchema.parse(raw);
      const bytes = Buffer.from(input.base64, "base64");
      if (!bytes.length || bytes.length > EVENT_POSTER_MAX_BYTES || bytes.toString("base64") !== input.base64) throw new Error("Invalid poster base64.");
      const detected = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png"
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg"
          : bytes.subarray(0,4).toString() === "RIFF" && bytes.subarray(8,12).toString() === "WEBP" ? "image/webp" : null;
      if (detected !== input.contentType) throw new Error("Poster type mismatch.");
      const begun = await eventIntake("poster_upload_begin", { draftId: input.draftId, contentType: input.contentType, byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
      if (!begun.ok) return begun;
      const target = EventPosterUploadSchema.parse(begun.data);
      const url = new URL(target.transfer.url);
      if (url.protocol !== "https:" || url.username || url.password || url.origin !== allowed.origin) throw new Error("Unexpected poster upload origin.");
      const form = new FormData();
      for (const [key, value] of Object.entries(target.transfer.fields)) form.append(key, value);
      form.append(target.transfer.fileField, new Blob([new Uint8Array(bytes)], { type: input.contentType }), "poster");
      // Only the pinned storage origin receives these caller-supplied bytes. Never send the API bearer token.
      const uploaded = await fetcher(url, { method: "POST", body: form, redirect: "error" });
      if (!uploaded.ok) throw new Error("Poster upload failed.");
      // The server fully decodes and validates the image before accepting it.
      return eventIntake("poster_upload_complete", { draftId: input.draftId, posterAssetId: target.posterAssetId });
    },
    get apiBaseUrl() {
      return options.apiBaseUrl;
    },
    createEvent(input: VrdexEventCreateInput) {
      return request(ApiEventWriteResponseSchema, "events", {
        body: ApiEventCreateRequestSchema.parse(input),
        method: "POST",
      });
    },
    getEvent(slug: string) {
      return get(PublicEventSchema, `events/${encodeURIComponent(slug)}`);
    },
    getPublicEvent(slug: string) {
      return request(PublicEventSchema, `events/${encodeURIComponent(slug)}`, {
        authenticate: false,
      });
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
    // Authenticated, unlike its neighbours here: the point of it is the drafts
    // and opted-out profiles a public read is right to withhold.
    listMyProfiles(input: { limit?: number } = {}) {
      return request(ApiMeProfilesResponseSchema, "me/profiles", {
        searchParams: { limit: input.limit },
      });
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
    submitProfile(input: VrdexProfileSubmitInput, idempotencyKey: string) {
      return request(ApiProfileWriteResponseSchema, "profiles", {
        body: ApiProfileSubmitRequestSchema.parse(input),
        idempotencyKey,
        method: "POST",
      });
    },
    updateEvent(slug: string, input: VrdexEventUpdateInput) {
      return request(ApiEventWriteResponseSchema, `events/${encodeURIComponent(slug)}`, {
        body: ApiEventUpdateRequestSchema.parse(input),
        method: "PATCH",
      });
    },
    updateProfile(slug: string, input: VrdexProfileUpdateInput) {
      return request(ApiProfileWriteResponseSchema, `profiles/${encodeURIComponent(slug)}`, {
        body: ApiProfileUpdateRequestSchema.parse(input),
        method: "PATCH",
      });
    },
  };
}

export type InferSchemaOutput<T extends z.ZodType> = z.infer<T>;
