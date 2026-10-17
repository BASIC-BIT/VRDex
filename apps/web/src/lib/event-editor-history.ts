/** Public history indexing starts before hydration; editor delegates remain disposable. */
type EditorPopListener = (event: PopStateEvent, previousPosition: number | undefined) => void;
const positionKey = "vrdexEventEditorPosition";
export function eventEditorHistoryPosition(state: unknown): number | undefined {
  return state && typeof state === "object" && positionKey in state && typeof state[positionKey] === "number" ? state[positionKey] : undefined;
}
type EditorHistoryCapture = { listener?: EditorPopListener; position: number | undefined };
declare global {
  var __vrdexEventEditorHistory: EditorHistoryCapture | undefined;
}
export function installEventEditorHistoryCapture(): void {
  if (globalThis.__vrdexEventEditorHistory) return;
  const state: EditorHistoryCapture = { position: eventEditorHistoryPosition(history.state) ?? 0 };
  globalThis.__vrdexEventEditorHistory = state;
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  originalReplace.call(history, { ...history.state, [positionKey]: state.position }, "");
  history.pushState = function (value, unused, url) {
    const next = (state.position ?? 0) + 1;
    originalPush.call(history, { ...value, [positionKey]: next }, unused, url);
    state.position = next;
  };
  history.replaceState = function (value, unused, url) {
    originalReplace.call(history, { ...value, ...(state.position === undefined ? {} : { [positionKey]: state.position }) }, unused, url);
  };
  window.addEventListener("popstate", event => {
    const previousPosition = state.position;
    state.position = eventEditorHistoryPosition(event.state);
    state.listener?.(event, previousPosition);
  }, true);
}
export function registerEventEditorHistoryCapture(listener: EditorPopListener): () => void {
  installEventEditorHistoryCapture();
  const state = globalThis.__vrdexEventEditorHistory!;
  state.listener = listener;
  return () => { if (state.listener === listener) state.listener = undefined; };
}
