import assert from "node:assert/strict";
import { test } from "node:test";
import type { Admission } from "../../packages/media-relay/src";
import { createNativeHlsAdapter } from "../../apps/web/src/lib/native-hls-adapter";
const grant: Extract<Admission, { kind: "ready" }> = {
  kind: "ready",
  grant: {
    id: "grant",
    streamKey: "vrcdn/DJ/1",
    context: { kind: "profile", profileId: "profile", linkId: "DJ" },
    contextRevision: 1,
    issuedAt: 1,
    expiresAt: 9999999999999,
    renditions: ["video", "audio"],
  },
  videoPlaylist: "https://media/video.m3u8",
  audioPlaylist: "https://media/audio.m3u8",
  metadata: { displayName: "DJ", artworkAssetId: null, artworkRevision: null },
};
class Media extends EventTarget {
  src = "";
  paused = true;
  muted = false;
  volume = 1;
  hidden = false;
  removed = false;
  plays = 0;
  canPlayType() {
    return "probably";
  }
  async play() {
    this.plays++;
    this.paused = false;
    this.dispatchEvent(new Event("playing"));
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
  removeAttribute() {
    this.src = "";
  }
  load() {}
  remove() {
    this.removed = true;
  }
}
function dom() {
  const before = globalThis.document;
  const nodes: Media[] = [];
  let exits = 0;
  const doc = {
    pictureInPictureElement: null as Media | null,
    async exitPictureInPicture() {
      exits++;
      doc.pictureInPictureElement = null;
    },
    createElement() {
      const node = new Media();
      nodes.push(node);
      return node;
    },
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: doc,
  });
  return {
    nodes,
    doc,
    get exits() {
      return exits;
    },
    mount: { append() {} } as unknown as HTMLElement,
    restore() {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: before,
      });
    },
  };
}
test("native mode switch pauses old source, retains nodes and grant, and paused stays paused", async () => {
  const f = dom();
  try {
    const adapter = createNativeHlsAdapter({
      grant,
      mode: "video",
      mount: f.mount,
      notify() {},
    });
    assert.equal(f.nodes.filter((n) => n.src).length, 0);
    await adapter.play();
    assert.equal(f.nodes[0].src, grant.videoPlaylist);
    await adapter.setMode!("audio");
    assert.equal(f.nodes[0].paused, true);
    assert.equal(f.nodes[1].src, grant.audioPlaylist);
    assert.equal(f.nodes[1].paused, false);
    adapter.pause();
    await adapter.setMode!("video");
    assert.equal(
      f.nodes.every((n) => n.paused),
      true,
    );
    assert.equal(f.nodes.length, 2);
    adapter.dispose();
    assert.equal(
      f.nodes.every((n) => n.removed),
      true,
    );
  } finally {
    f.restore();
  }
});
test("audio closes PiP and returning video never opens PiP", async () => {
  const f = dom();
  try {
    const adapter = createNativeHlsAdapter({
      grant,
      mode: "video",
      mount: f.mount,
      notify() {},
    });
    await adapter.play();
    f.doc.pictureInPictureElement = f.nodes[0];
    await adapter.setMode!("audio");
    await adapter.setMode!("video");
    assert.equal(f.exits, 1);
    adapter.dispose();
  } finally {
    f.restore();
  }
});
test("late play completion cannot override pause or mode selection", async () => {
  const f = dom();
  try {
    const adapter = createNativeHlsAdapter({
      grant,
      mode: "video",
      mount: f.mount,
      notify() {},
    });
    let settle = () => {};
    f.nodes[0].play = () =>
      new Promise<void>((resolve) => {
        settle = () => {
          f.nodes[0].paused = false;
          f.nodes[0].dispatchEvent(new Event("playing"));
          resolve();
        };
      });
    const pending = adapter.play();
    await Promise.resolve();
    adapter.pause();
    settle();
    assert.equal(await pending, false);
    assert.equal(f.nodes[0].paused, true);
    adapter.dispose();
  } finally {
    f.restore();
  }
});
test("hardware-only volume is never written and rejected startup remains blocked", async () => {
  const f = dom();
  try {
    const adapter = createNativeHlsAdapter({
      grant,
      mode: "video",
      mount: f.mount,
      notify() {},
      hardwareVolume: true,
    });
    for (const node of f.nodes)
      Object.defineProperty(node, "volume", {
        get: () => 1,
        set: () => {
          throw Error("hardware volume");
        },
      });
    adapter.setVolume(0.2);
    f.nodes[0].play = async () => {
      throw Error("NotAllowedError");
    };
    assert.equal(await adapter.play(), false);
    adapter.dispose();
  } finally {
    f.restore();
  }
});
test("selecting audio unloads the old video playlist instead of fetching both renditions", async () => {
  const f = dom();
  try {
    const adapter = createNativeHlsAdapter({
      grant,
      mode: "video",
      mount: f.mount,
      notify() {},
    });
    await adapter.play();
    await adapter.setMode!("audio");
    assert.equal(f.nodes[0].src, "");
    assert.equal(f.nodes.filter((node) => node.src).length, 1);
    adapter.dispose();
  } finally {
    f.restore();
  }
});
test("native controls pause stays paused when selecting a new mode", async () => {
  const f = dom();
  try {
    const adapter = createNativeHlsAdapter({
      grant,
      mode: "video",
      mount: f.mount,
      notify() {},
    });
    await adapter.play();
    f.nodes[0].pause();
    await adapter.setMode!("audio");
    assert.equal(f.nodes[1].plays, 0);
    adapter.dispose();
  } finally {
    f.restore();
  }
});
test("desktop MSE attaches HLS only when native capability is absent and destroys inactive rendition", async () => {
  const f = dom();
  const sources: string[] = [];
  let destroyed = 0,
    starts = 0;
  const configs: Array<{playlistLoadPolicy:{default:{errorRetry:{maxNumRetry:number;retryDelayMs:number}}}}> = [];
  class Hls {
    static DefaultConfig = {playlistLoadPolicy:{default:{}}};
    constructor(config: typeof configs[number]) { configs.push(config); }
    static Events = { ERROR: "error" };
    static isSupported() {
      return true;
    }
    on() {}
    loadSource(src: string) {
      sources.push(src);
    }
    attachMedia() {}
    startLoad() {
      starts++;
    }
    stopLoad() {}
    destroy() {
      destroyed++;
    }
  }
  try {
    const adapter = createNativeHlsAdapter({
      grant,
      mode: "video",
      mount: f.mount,
      notify() {},
      loadHls: async () =>
        ({ default: Hls }) as unknown as typeof import("hls.js"),
    });
    for (const node of f.nodes) node.canPlayType = () => "";
    await adapter.play();
    await adapter.setMode!("audio");
    assert.deepEqual(sources, [grant.videoPlaylist, grant.audioPlaylist]);
    assert.equal(starts, 2);
    const retry = configs[0].playlistLoadPolicy.default.errorRetry;
    assert.equal(retry.maxNumRetry * retry.retryDelayMs, 30000);
    assert.equal(destroyed, 1);
    adapter.dispose();
    assert.equal(destroyed, 2);
  } finally {
    f.restore();
  }
});
test("rapid toggle rejects a late old-mode play event while the new mode remains audible", async () => {
  const f = dom();
  try {
    const adapter = createNativeHlsAdapter({
      grant,
      mode: "video",
      mount: f.mount,
      notify() {},
    });
    let settle = () => {};
    f.nodes[0].play = () =>
      new Promise<void>((resolve) => {
        settle = () => {
          f.nodes[0].paused = false;
          f.nodes[0].dispatchEvent(new Event("playing"));
          resolve();
        };
      });
    const first = adapter.play();
    await adapter.setMode!("audio");
    settle();
    assert.equal(await first, false);
    assert.equal(f.nodes[0].paused, true);
    assert.equal(f.nodes[1].paused, false);
    adapter.dispose();
  } finally {
    f.restore();
  }
});

test("queued playing event cannot report playback while the selected element is already paused", async () => {
  const f = dom();
  const states: string[] = [];
  try {
    const adapter = createNativeHlsAdapter({
      grant,
      mode: "video",
      mount: f.mount,
      notify: (state) => {
        if (state.status) states.push(state.status);
      },
    });
    await adapter.play();
    states.length = 0;
    f.nodes[0].paused = true;
    f.nodes[0].dispatchEvent(new Event("playing"));
    assert.equal(states.includes("playing"), false);
    adapter.dispose();
  } finally {
    f.restore();
  }
});
test("genuine native play event resumes after native pause while a late playing event alone stays fenced", async () => {
  const f = dom();
  const states: string[] = [];
  try {
    const adapter = createNativeHlsAdapter({
      grant,
      mode: "video",
      mount: f.mount,
      notify: (state) => {
        if (state.status) states.push(state.status);
      },
    });
    await adapter.play();
    adapter.pause();
    f.nodes[0].paused = false;
    f.nodes[0].dispatchEvent(new Event("playing"));
    assert.equal(f.nodes[0].paused, true);
    states.length = 0;
    f.nodes[0].paused = false;
    f.nodes[0].dispatchEvent(new Event("play"));
    f.nodes[0].dispatchEvent(new Event("playing"));
    assert.equal(f.nodes[0].paused, false);
    assert.deepEqual(states, ["playing"]);
    adapter.dispose();
  } finally {
    f.restore();
  }
});
