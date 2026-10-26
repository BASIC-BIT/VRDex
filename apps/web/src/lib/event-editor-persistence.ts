export type AuthoredSnapshot = string;
/** JSON command semantics: omitted/undefined properties are absent; null is an edit. */
export function authoredSnapshot(value: unknown): AuthoredSnapshot {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item) ?? "undefined";
}
export function hasUnsavedEventChanges({ current, persisted, pendingInput }: { current: AuthoredSnapshot; persisted: AuthoredSnapshot; pendingInput: boolean }): boolean {
  return pendingInput || current !== persisted;
}
/** Source results replace only branches untouched since that request was submitted. */
export function mergeSavedEventFields<T extends object>(current: T, submitted: T, saved: T): T {
  const next = { ...current };
  for (const key of Object.keys(saved) as Array<keyof T>) {
    if (authoredSnapshot(current[key]) === authoredSnapshot(submitted[key])) next[key] = saved[key];
  }
  // Questions and suggestions belong to the submitted source, even when a newer
  // source edit cleared an already-empty suggestion list.
  const sourceChanged = ["sourceText", "posterSourceId"].some(key =>
    authoredSnapshot(Reflect.get(current, key)) !== authoredSnapshot(Reflect.get(submitted, key)));
  if (sourceChanged) for (const key of ["tentative", "questions", "evidence"]) {
    if (Object.hasOwn(current, key)) Reflect.set(next, key, Reflect.get(current, key));
    else Reflect.deleteProperty(next, key);
  }
  return next;
}
