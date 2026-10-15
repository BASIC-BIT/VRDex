/** Installed before router hydration. No editor closure survives its unmount. */
type EditorPopListener = (event: PopStateEvent) => void;
declare global {
  var __vrdexEventEditorHistory: { listener?: EditorPopListener } | undefined;
}
export function installEventEditorHistoryCapture(): void {
  if (globalThis.__vrdexEventEditorHistory) return;
  const state: { listener?: EditorPopListener } = {};
  globalThis.__vrdexEventEditorHistory = state;
  window.addEventListener("popstate", event => state.listener?.(event), true);
}
export function registerEventEditorHistoryCapture(listener: EditorPopListener): () => void {
  installEventEditorHistoryCapture();
  const state = globalThis.__vrdexEventEditorHistory!;
  state.listener = listener;
  return () => { if (state.listener === listener) state.listener = undefined; };
}
