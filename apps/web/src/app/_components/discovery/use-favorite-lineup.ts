"use client";
import { useConvex } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@convex-generated-api";
import { createFavoriteLineupController, type FavoriteLineupContext, type FavoriteLineupSnapshot } from "@/lib/discovery/favorite-lineup";

const loading: FavoriteLineupSnapshot = { kind: "loading" };

/** Membership for the caller's selected cards; recommendation selection stays outside. */
export function useFavoriteLineup({ eventIds, favoriteProfileIds }: FavoriteLineupContext) {
  const client = useConvex();
  const contextKey = JSON.stringify({ eventIds: [...new Set(eventIds)].sort(), favoriteProfileIds: [...new Set(favoriteProfileIds)].sort() });
  const controller = useRef<ReturnType<typeof createFavoriteLineupController> | null>(null);
  const [state, setState] = useState<{ key: string; snapshot: FavoriteLineupSnapshot } | null>(null);
  const key = useRef(contextKey);

  useEffect(() => {
    const current = createFavoriteLineupController({ transport: { favoriteLineup: args => ({ subscribe(next, error) {
      const watch = client.watchQuery(api.homeDiscovery.favoriteLineup, args);
      const update = () => { try { const result = watch.localQueryResult(); if (result !== undefined) next(result); } catch (failure) { error(failure); } };
      const stop = watch.onUpdate(update); update(); return stop;
    } }) } });
    controller.current = current;
    const unsubscribe = current.subscribe(() => setState({ key: key.current, snapshot: current.getSnapshot() }));
    return () => { unsubscribe(); current.dispose(); controller.current = null; };
  }, [client]);
  useEffect(() => {
    key.current = contextKey;
    controller.current?.setContext(JSON.parse(contextKey) as FavoriteLineupContext);
  }, [client, contextKey]);
  const retry = useCallback(() => controller.current?.retry(), []);
  return { snapshot: state?.key === contextKey ? state.snapshot : loading, retry };
}
