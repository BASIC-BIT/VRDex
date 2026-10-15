"use client";
import { eventEditorHistoryPosition as position, registerEventEditorHistoryCapture } from "@/lib/event-editor-history";
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export const EventEditorPendingContext = createContext<(key: string, pending: boolean) => void>(() => {});
export function useEventEditorPending() {
  const [inputs, setInputs] = useState<Record<string, boolean>>({});
  const register = useCallback((key: string, pending: boolean) => setInputs(current => current[key] === pending ? current : { ...current, [key]: pending }), []);
  return { register, pending: Object.values(inputs).some(Boolean) };
}
export function usePendingEventInput(pending: boolean) {
  const register = useContext(EventEditorPendingContext);
  const key = useId();
  useEffect(() => { register(key, pending); return () => register(key, false); }, [key, pending, register]);
}

export function useEventEditorLeaveGuard({ dirty }: { dirty: boolean }): { requestLeave: (navigate: () => void) => boolean } {
  const currentDirty = useRef(dirty);
  useLayoutEffect(() => { currentDirty.current = dirty; }, [dirty]);
  const approved = useRef(false);
  const requestLeave = useCallback((navigate: () => void) => {
    if (currentDirty.current && !window.confirm("Leave without saving?")) return false;
    approved.current = true;
    navigate();
    return true;
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { if (!approved.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  useEffect(() => {
    let index = position(history.state) ?? 0;
    let restoring: { delta: number } | undefined;
    let replaying = false;
    let browserEscape = false;
    const pop = (event: PopStateEvent) => {
      if (browserEscape) { browserEscape = false; index = position(event.state) ?? index; return; }
      if (replaying) { replaying = false; index = position(event.state) ?? index; return; }
      if (restoring) {
        event.stopImmediatePropagation();
        const { delta } = restoring;
        restoring = undefined;
        if (window.confirm("Leave without saving?")) { approved.current = true; replaying = true; history.go(delta); }
        return;
      }
      const target = position(event.state);
      // Entries created before bootstrap have no reliable direction or distance. Never guess.
      if (target === undefined) return;
      if (!currentDirty.current || approved.current) { index = target; return; }
      event.stopImmediatePropagation();
      const delta = target - index;
      if (!delta) return;
      restoring = { delta };
      history.go(-delta);
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.download || (anchor.target && anchor.target !== "_self")) return;
      const destination = new URL(anchor.href);
      if (destination.origin === location.origin && destination.pathname === location.pathname && destination.search === location.search) return;
      if (anchor.href === location.href || !currentDirty.current || approved.current) return;
      if (!window.confirm("Leave without saving?")) { event.preventDefault(); event.stopImmediatePropagation(); }
      else approved.current = true;
    };
    // Some routers begin traversal work at the public Navigation API event,
    // before popstate. Ask while the editor is still mounted; allow an approved traversal.
    const navigation = "navigation" in window && window.navigation instanceof EventTarget ? window.navigation : undefined;
    const traverse = (event: Event) => {
      if (!("navigationType" in event) || event.navigationType !== "traverse" || !("destination" in event)) return;
      const destination = event.destination;
      const entry = navigation && "currentEntry" in navigation ? navigation.currentEntry : undefined;
      if (!destination || typeof destination !== "object" || !("sameDocument" in destination) || !destination.sameDocument || !("index" in destination) || typeof destination.index !== "number" || !entry || typeof entry !== "object" || !("index" in entry) || typeof entry.index !== "number") return;
      if (!event.cancelable) { browserEscape = true; return; }
      if (replaying || restoring || approved.current || !currentDirty.current) return;
      if (window.confirm("Leave without saving?")) approved.current = true;
      else event.preventDefault();
    };
    navigation?.addEventListener("navigate", traverse);
    const unregisterHistory = registerEventEditorHistoryCapture(pop);
    document.addEventListener("click", click, true);
    return () => {
      navigation?.removeEventListener("navigate", traverse);
      unregisterHistory();
      document.removeEventListener("click", click, true);
    };
  }, []);
  return { requestLeave };
}
