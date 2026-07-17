import "server-only";

import { unstable_cache } from "next/cache";

import { twitchLoginFromUrl } from "@/lib/twitch-url";

export type TwitchLiveState =
  | {
      status: "live";
      gameName?: string;
      startedAt: string;
      title: string;
      viewerCount: number;
    }
  | { status: "offline" }
  | { status: "unavailable" };

type PublicLink = {
  type: string;
  url: string;
};

type TwitchTokenResponse = {
  access_token?: string;
};

type TwitchStreamsResponse = {
  data?: Array<{
    game_name?: string;
    started_at?: string;
    title?: string;
    viewer_count?: number;
  }>;
};

const staleStateMaxAgeMs = 60_000;
const staleStates = new Map<string, { fetchedAt: number; state: TwitchLiveState }>();

function getFreshStaleState(login: string): TwitchLiveState | undefined {
  const entry = staleStates.get(login);

  if (!entry) {
    return undefined;
  }

  if (Date.now() - entry.fetchedAt <= staleStateMaxAgeMs) {
    return entry.state;
  }

  staleStates.delete(login);
  return undefined;
}

const getTwitchAppToken = unstable_cache(
  async () => {
    const clientId = process.env.TWITCH_CLIENT_ID?.trim();
    const clientSecret = process.env.TWITCH_CLIENT_SECRET?.trim();

    if (!clientId || !clientSecret) {
      return null;
    }

    const response = await fetch("https://id.twitch.tv/oauth2/token", {
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }),
      method: "POST",
      signal: AbortSignal.timeout(4000),
    });

    if (!response.ok) {
      throw new Error(`Twitch token request returned HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as TwitchTokenResponse;
    return payload.access_token ?? null;
  },
  ["twitch-app-token"],
  { revalidate: 3000 },
);

const getCachedTwitchLiveState = unstable_cache(
  async (login: string): Promise<TwitchLiveState> => {
    const clientId = process.env.TWITCH_CLIENT_ID?.trim();
    const token = await getTwitchAppToken();

    if (!clientId || !token) {
      return { status: "unavailable" };
    }

    const url = new URL("https://api.twitch.tv/helix/streams");
    url.searchParams.set("user_login", login);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-Id": clientId,
      },
      signal: AbortSignal.timeout(4000),
    });

    if (!response.ok) {
      throw new Error(`Twitch streams request returned HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as TwitchStreamsResponse;
    const stream = payload.data?.[0];

    if (!stream) {
      return { status: "offline" };
    }

    return {
      status: "live",
      title: stream.title?.trim() || "Live on Twitch",
      viewerCount: stream.viewer_count ?? 0,
      startedAt: stream.started_at ?? new Date().toISOString(),
      ...(stream.game_name?.trim() ? { gameName: stream.game_name.trim() } : {}),
    };
  },
  ["twitch-live-state"],
  { revalidate: 60 },
);

export async function getTwitchLiveState(links: readonly PublicLink[]): Promise<TwitchLiveState | undefined> {
  const login = links
    .filter((link) => link.type === "twitch")
    .map((link) => twitchLoginFromUrl(link.url))
    .find((candidate): candidate is string => candidate !== null);

  if (!login) {
    return undefined;
  }

  try {
    const state = await getCachedTwitchLiveState(login);

    if (state.status !== "unavailable") {
      staleStates.set(login, { fetchedAt: Date.now(), state });
    }

    return state.status === "unavailable" ? getFreshStaleState(login) ?? state : state;
  } catch (error) {
    console.error(`Twitch live-state lookup failed for ${login}:`, error);
    return getFreshStaleState(login) ?? { status: "unavailable" };
  }
}
