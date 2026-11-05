import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readPlaybackMode,
  writePlaybackMode,
} from "../../apps/web/src/lib/playback-mode";
test("defaults to video, persists audio across readers and survives denied storage", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  assert.equal(readPlaybackMode(storage), "video");
  writePlaybackMode(storage, "audio");
  assert.equal(readPlaybackMode(storage), "audio");
  const denied = {
    getItem(): string | null {
      throw Error("denied");
    },
    setItem() {
      throw Error("denied");
    },
  };
  writePlaybackMode(denied, "audio");
  assert.equal(readPlaybackMode(denied), "audio");
  writePlaybackMode(denied, "video");
  assert.equal(readPlaybackMode(denied), "video");
});
test("readable stale storage cannot overwrite a denied-write session preference", () => {
  const storage = { getItem: () => "video", setItem() { throw Error("quota"); } };
  writePlaybackMode(storage, "audio");
  assert.equal(readPlaybackMode(storage), "audio");
  writePlaybackMode({ getItem: () => "video", setItem() {} }, "video");
});
