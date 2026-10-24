import assert from "node:assert/strict";
import { it } from "node:test";
import { LocalPreviewPlayer } from "../../apps/web/src/lib/local-preview-player";
import { ForegroundPlayback } from "../../apps/web/src/lib/foreground-playback";
it("muted local preview leaves program audible; Monitor acquires before unmute; close never resumes program", () => {
  const focus = new ForegroundPlayback(),
    calls: string[] = [];
  const program = {};
  focus.acquire(program, () => calls.push("program:pause"));
  const preview = new LocalPreviewPlayer(
    () => ({
      play: async () => {
        calls.push("preview:play");
        return true;
      },
      pause: () => calls.push("preview:pause"),
      setMuted: (value) => calls.push(`preview:muted:${value}`),
      setVolume: () => {},
      update: () => {},
      dispose: () => calls.push("preview:dispose"),
    }),
    () => {},
    focus,
  );
  preview.start();
  assert.deepEqual(calls, ["preview:muted:true", "preview:play"]);
  preview.monitor();
  assert(calls.indexOf("program:pause") < calls.indexOf("preview:muted:false"));
  preview.close();
  assert.equal(calls.at(-1), "preview:dispose");
  assert.equal(calls.filter((call) => call === "program:pause").length, 1);
  preview.monitor();
  assert.equal(calls.at(-1), "preview:dispose");
});
it("foreground loss synchronously disposes the local handle and stale release cannot free successor", () => {
  const focus = new ForegroundPlayback(),
    calls: string[] = [];
  let creations = 0;
  const preview = new LocalPreviewPlayer(
    () => {
      creations++;
      return {
        play: async () => true,
        pause: () => calls.push("pause"),
        setMuted: () => {},
        setVolume: () => {},
        update: () => {},
        dispose: () => calls.push("dispose"),
      };
    },
    () => {},
    focus,
  );
  preview.start();
  preview.monitor();
  const successor = {};
  focus.acquire(successor, () => calls.push("successor"));
  assert.deepEqual(calls, ["pause", "dispose"]);
  preview.close();
  focus.acquire({}, () => {});
  assert.equal(calls.at(-1), "successor");
  assert.equal(creations, 1);
});

it("unavailable local adapter creation never acquires program audio", () => {
  const focus = new ForegroundPlayback();
  let pauses = 0;
  focus.acquire({}, () => {
    pauses++;
  });
  const preview = new LocalPreviewPlayer(
    () => {
      throw Error("too narrow");
    },
    () => {},
    focus,
  );
  assert.equal(preview.start(), false);
  assert.equal(preview.monitor(), false);
  assert.equal(pauses, 0);
  preview.close();
});
