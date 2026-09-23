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
    attempt?: { nonce: string; startedAt: number };
  } | null>(null);
  const [pendingNonce, setPendingNonce] = useState<string | null>(null);
  const [freshDeadline, setFreshDeadline] = useState(0);
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
        if (active)
          setTicket({
            key,
            id,
            attempt: { nonce: crypto.randomUUID(), startedAt: performance.now() },
          });
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
  const attempt = ticket?.key === key ? ticket.attempt : undefined;
  const queries = useMemo<
    Record<
      string,
      {
        query: typeof api.clubProviderReads.get;
        args: FunctionArgs<typeof api.clubProviderReads.get>;
      }
    >
  >(
    () =>
      Object.fromEntries(
        requestId && attempt
          ? [
              [
                "read",
                {
                  query: api.clubProviderReads.get,
                  args: { requestId, freshnessNonce: attempt.nonce },
                },
              ],
            ]
          : [],
      ),
    [requestId, attempt],
  );
  const result = useQueries(queries).read as
    | ProviderReadResult
    | Error
    | null
    | undefined;
  const read = result && !(result instanceof Error) ? result : null;
  const pending = read?.state === "pending" || read?.state === "running";
  if (pending && attempt && pendingNonce !== attempt.nonce)
    setPendingNonce(attempt.nonce);
  const needsFreshEvaluation =
    read?.state === "succeeded" && attempt?.nonce === pendingNonce;
  useEffect(() => {
    if (!needsFreshEvaluation) return;
    // The observation happened after this subscription began. Re-evaluate once
    // so time spent waiting for the worker does not consume the new evidence.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTicket((current) =>
      current?.key === key
        ? {
            ...current,
            attempt: { nonce: crypto.randomUUID(), startedAt: performance.now() },
          }
        : current,
    );
  }, [key, needsFreshEvaluation]);
  // Anchor before the query, conservatively charging transport time. Replayed
  // values and rerenders use the same anchor, never a new full freshness window.
  const deadline =
    attempt && read?.state === "succeeded" && read.fresh && read.result
      ? attempt.startedAt + read.remainingFreshMs
      : 0;
  useEffect(() => {
    const remaining = deadline - performance.now();
    // Synchronize readiness with the external monotonic clock after evaluation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFreshDeadline(remaining > 0 ? deadline : 0);
    if (remaining <= 0) return;
    const timer = setTimeout(
      () => setFreshDeadline(0),
      Math.max(0, Math.ceil(remaining)),
    );
    return () => clearTimeout(timer);
  }, [deadline]);
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
    fresh: !needsFreshEvaluation && deadline > 0 && freshDeadline === deadline,
    refresh,
  };
}
