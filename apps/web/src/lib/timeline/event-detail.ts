import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../../convex/_generated/api";
export type CanonicalEvent = NonNullable<
  FunctionReturnType<typeof api.events.getPublicBySlug>
>;
export type DetailState =
  | { kind: "loading"; slug: string | null }
  | { kind: "available"; slug: string; event: CanonicalEvent }
  | { kind: "unavailable"; slug: string }
  | { kind: "error"; slug: string; error: unknown };
export type DetailObserver = {
  value(event: CanonicalEvent | null): void;
  error(error: unknown): void;
};
export function createEventDetailController(
  watch: (slug: string, observer: DetailObserver) => () => void,
) {
  let state: DetailState = { kind: "loading", slug: null };
  let generation = 0;
  let stop: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: DetailState) => {
    state = next;
    listeners.forEach((fn) => fn());
  };
  function select(slug: string | null, force = false) {
    if (!force && state.slug === slug && stop !== undefined) return;
    const token = ++generation;
    stop?.();
    stop = undefined;
    publish({ kind: "loading", slug });
    if (slug === null) return;
    const observer: DetailObserver = {
      value: (event) => {
        if (token === generation)
          publish(
            event === null
              ? { kind: "unavailable", slug }
              : { kind: "available", slug, event },
          );
      },
      error: (error) => {
        if (token === generation) publish({ kind: "error", slug, error });
      },
    };
    try {
      stop = watch(slug, observer);
    } catch (error) {
      observer.error(error);
    }
  }
  return {
    select,
    retry: () => select(state.slug, true),
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      generation++;
      stop?.();
      stop = undefined;
    },
  };
}
