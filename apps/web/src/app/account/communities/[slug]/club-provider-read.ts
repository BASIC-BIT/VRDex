"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import { useMutation, useQueries } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "@convex-generated-api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";

export type ProviderReadParams = FunctionArgs<
  typeof api.clubProviderReads.request
>["params"];
export type ProviderReadResult = NonNullable<
  FunctionReturnType<typeof api.clubProviderReads.get>
>;
export type ProviderItem = NonNullable<
  ProviderReadResult["result"]
>["items"][number];

export function useClubProviderRead(
  communityProfileId: Id<"profiles">,
  params: ProviderReadParams | null,
) {
  const request = useMutation(api.clubProviderReads.request);
  const [revision, refresh] = useReducer((value: number) => value + 1, 0);
  const key = JSON.stringify([communityProfileId, params, revision]);
  const [ticket, setTicket] = useState<{
    key: string;
    id?: Id<"clubProviderReadRequests">;
    error?: string;
  } | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const [profile, parameters] = JSON.parse(key) as [
      Id<"profiles">,
      ProviderReadParams | null,
      number,
    ];
    if (!parameters) return;
    let active = true;
    void request({ communityProfileId: profile, params: parameters })
      .then((id) => {
        if (active) setTicket({ key, id });
      })
      .catch((cause) => {
        if (active)
          setTicket({
            key,
            error:
              cause instanceof Error ? cause.message : "Unable to load data.",
          });
      });
    return () => {
      active = false;
    };
  }, [key, request]);
  const requestId = ticket?.key === key ? ticket.id : undefined;
  const queries = useMemo<
    Record<
      string,
      {
        query: typeof api.clubProviderReads.get;
        args: { requestId: Id<"clubProviderReadRequests"> };
      }
    >
  >(
    () =>
      Object.fromEntries(
        requestId
          ? [
              [
                "read",
                { query: api.clubProviderReads.get, args: { requestId } },
              ],
            ]
          : [],
      ),
    [requestId],
  );
  const result = useQueries(queries).read as
    | ProviderReadResult
    | Error
    | null
    | undefined;
  const observedAt =
    result && !(result instanceof Error)
      ? result.result?.observedAt
      : undefined;
  useEffect(() => {
    if (observedAt === undefined) return;
    const tick = () => setNow(Date.now());
    const initial = setTimeout(tick, 0);
    const timer = setTimeout(
      tick,
      Math.max(0, observedAt + 60_001 - Date.now()),
    );
    return () => {
      clearTimeout(initial);
      clearTimeout(timer);
    };
  }, [observedAt]);
  const error =
    ticket?.key === key && ticket.error
      ? ticket.error
      : result instanceof Error
        ? result.message
        : result === null
          ? "Data expired. Refresh to continue."
          : result?.state === "failed"
            ? "Unable to load data. Try refreshing."
            : null;
  return {
    data: result && !(result instanceof Error) ? result.result : null,
    error,
    loading:
      params !== null &&
      !error &&
      (!result ||
        result instanceof Error ||
        result.state === "pending" ||
        result.state === "running"),
    fresh:
      observedAt !== undefined &&
      observedAt <= now &&
      now - observedAt <= 60_000,
    refresh,
  };
}
