import assert from "node:assert/strict";
import { test } from "node:test";
import { ForegroundPlayback } from "../../apps/web/src/lib/foreground-playback";
test("foreground handoff stops predecessor synchronously and stale release cannot clear successor", () => {
  const foreground = new ForegroundPlayback(); const a = {}, b = {}, c = {}; const stopped: string[] = [];
  foreground.acquire(a, () => { stopped.push("a"); foreground.release(a); });
  foreground.acquire(b, () => stopped.push("b")); assert.deepEqual(stopped, ["a"]);
  foreground.acquire(b, () => stopped.push("duplicate")); assert.deepEqual(stopped, ["a"]);
  foreground.acquire(c, () => {}); assert.deepEqual(stopped, ["a", "b"]);
  foreground.release(c); foreground.acquire(a, () => {}); assert.deepEqual(stopped, ["a", "b"]);
});
