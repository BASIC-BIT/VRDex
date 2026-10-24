import assert from "node:assert/strict";
import { it } from "node:test";
import {
  createTwitchAdapter,
  type TwitchSDK,
} from "../../apps/web/src/lib/twitch-player-adapter";
class Element {
  style: Record<string, string> = {};
  children: Element[] = [];
  parent?: Element;
  append(child: Element) {
    child.parent = this;
    this.children.push(child);
  }
  remove() {
    if (this.parent)
      this.parent.children = this.parent.children.filter((row) => row !== this);
  }
}
const request = {
  kind: "twitch",
  channel: "fixture",
  sourceId: "fixture",
  eventId: "preview",
  eventSlug: "preview",
  href: "https://www.twitch.tv/fixture",
  title: "Preview",
  startAt: 0,
} as const;
it("muted state is passed at SDK construction; disposal fences late SDK and READY callbacks", async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window"),
    priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { innerWidth: 800, location: { hostname: "example.test" } },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => new Element() },
  });
  try {
    const calls: string[] = [],
      options: Record<string, unknown>[] = [],
      listeners = new Map<string, () => void>();
    class Player {
      static READY = "ready";
      static PLAYING = "playing";
      static PAUSE = "pause";
      static OFFLINE = "offline";
      static PLAYBACK_BLOCKED = "blocked";
      constructor(_mount: HTMLElement, config: Record<string, unknown>) {
        options.push(config);
      }
      play() {
        calls.push("play");
        listeners.get("playing")?.();
      }
      pause() {
        calls.push("pause");
      }
      setVolume() {}
      setMuted(value: boolean) {
        calls.push(`muted:${value}`);
      }
      addEventListener(key: string, callback: () => void) {
        listeners.set(key, callback);
      }
      removeEventListener(key: string) {
        listeners.delete(key);
      }
    }
    const sdk: TwitchSDK = { Player };
    const mount = new Element();
    const adapter = createTwitchAdapter(
      request,
      mount as unknown as HTMLElement,
      () => {},
      async () => sdk,
    );
    adapter.setMuted(true);
    const playing = adapter.play();
    await Promise.resolve();
    assert.equal(options[0].muted, true);
    assert.equal(options[0].autoplay, false);
    const ready = listeners.get("ready")!;
    ready();
    assert.equal(await playing, true);
    assert.deepEqual(calls.slice(0, 2), ["muted:true", "play"]);
    adapter.dispose();
    const count = calls.length;
    ready();
    assert.equal(calls.length, count);
    assert.equal(listeners.size, 0);
    assert.equal(mount.children.length, 0);
    let release: (sdk: TwitchSDK) => void = () => {};
    const late = new Promise<TwitchSDK>((resolve) => {
      release = resolve;
    });
    const disposed = createTwitchAdapter(
      request,
      mount as unknown as HTMLElement,
      () => {},
      () => late,
    );
    disposed.setMuted(true);
    const pending = disposed.play();
    disposed.dispose();
    release(sdk);
    assert.equal(await pending, false);
    assert.equal(options.length, 1);
    assert.equal(mount.children.length, 0);
  } finally {
    if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (priorDocument)
      Object.defineProperty(globalThis, "document", priorDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
