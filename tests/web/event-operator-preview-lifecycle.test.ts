import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type { PreviewSource } from "../../apps/web/src/app/_components/event-operator-preview";
import { eventDjTarget } from "../../apps/web/src/lib/event-dj-target";
import { foregroundPlayback } from "../../apps/web/src/lib/foreground-playback";
import { LocalPreviewPlayer } from "../../apps/web/src/lib/local-preview-player";
import type { AdapterNotify, PlaybackAdapter, PlaybackRequest } from "../../apps/web/src/lib/event-playback-owner";

type Node = { type: unknown; props: Record<string, any> };
type Effect = { deps: unknown[]; cleanup?: () => void };
const source = {
  sourceId: "custom-preview", revision: 1, key: "custom-preview",
  input: { kind: "twitch", channel: "preview" },
  publicUrl: "https://www.twitch.tv/preview", label: "Original",
} as const;

/** Actual component + local player + foreground coordinator. Only React's commit
 * boundary, DOM geometry and the provider adapter are fake; no browser or I/O. */
function harness() {
  const slots: any[] = [], effects = new Map<number, Effect>();
  let cursor = 0, dirty = false, props: PreviewSource = source, tree: Node;
  let pending: Array<() => void> = [];
  const rect = { width: 600, height: 300, top: 0, bottom: 300, left: 0, right: 600 };
  const element = { inert: true, style: { pointerEvents: "none" }, getBoundingClientRect: () => rect };
  const listeners = new Map<string, Set<() => void>>();
  const calls: string[] = [];
  const adapters: Array<{
    muted: boolean; disposed: boolean; paused: boolean; notify: AdapterNotify;
    request: PlaybackRequest; rejectPlay: (error: Error) => void;
    inertAtCreation: boolean; pointerAtCreation: string;
  }> = [];
  const hooks = {
    useRef(value: unknown) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value: unknown) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof value === "function" ? value() : value;
      return [slots[i], (next: unknown) => {
        const updated = typeof next === "function" ? next(slots[i]) : next;
        if (!Object.is(updated, slots[i])) { slots[i] = updated; dirty = true; }
      }];
    },
    useEffect(callback: () => (() => void) | void, deps: unknown[]) {
      const i = cursor++, old = effects.get(i);
      if (old && deps.every((value, index) => Object.is(value, old.deps[index]))) return;
      pending.push(() => {
        old?.cleanup?.();
        effects.set(i, { deps, cleanup: callback() || undefined });
      });
    },
  };
  function jsx(type: unknown, props: Node["props"]): Node { return { type, props }; }
  const mocks: Record<string, unknown> = {
    react: hooks,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "@/components/ui/button": { Button: "button" },
    "@/lib/event-dj-target": { eventDjTarget },
    "@/lib/local-preview-player": { LocalPreviewPlayer },
    "@/lib/event-playback-adapters": {
      createEventPlaybackAdapter(request: PlaybackRequest, _mount: unknown, notify: AdapterNotify): PlaybackAdapter {
        const id = adapters.length;
        const row = {
          muted: false, disposed: false, paused: true, notify, request,
          rejectPlay: (_error: Error) => {},
          inertAtCreation: element.inert, pointerAtCreation: element.style.pointerEvents,
        };
        adapters.push(row);
        return {
          play: () => { row.paused = false; return new Promise<boolean>((_resolve, reject) => { row.rejectPlay = reject; }); },
          pause: () => { row.paused = true; calls.push(`${id}:pause`); },
          setMuted: value => { row.muted = value; calls.push(`${id}:muted:${value}`); },
          setVolume: () => {},
          update: request => { row.request = request; },
          dispose: () => { row.disposed = true; calls.push(`${id}:dispose`); },
        };
      },
    },
  };
  const exports: { EventOperatorPreview?: (props: object) => Node } = {};
  const code = ts.transpileModule(readFileSync("apps/web/src/app/_components/event-operator-preview.tsx", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    require: (name: string) => { assert(name in mocks, `Uninspected import: ${name}`); return mocks[name]; },
    window: {
      innerWidth: 800, innerHeight: 900,
      addEventListener(name: string, callback: () => void) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(callback); },
      removeEventListener(name: string, callback: () => void) { listeners.get(name)?.delete(callback); },
    },
    ResizeObserver: class { observe() {} disconnect() {} },
  });
  function nodes(node: unknown): Node[] {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    const value = node as Node;
    return [value, ...nodes(value.props.children)];
  }
  function flush() {
    let renders = 0;
    do {
      assert(++renders < 20, "Component did not settle");
      dirty = false; cursor = 0;
      tree = exports.EventOperatorPreview!({ source: props, onClose() {} });
      const mount = nodes(tree).find(node => node.props["aria-label"] === "Local preview player")!;
      mount.props.ref.current = element;
      element.inert = mount.props.inert;
      element.style.pointerEvents = mount.props.style.pointerEvents;
      const work = pending; pending = []; work.forEach(effect => effect());
    } while (dirty);
  }
  const program = {};
  const result = {
    adapters, calls, element,
    render(next: PreviewSource = props) { props = next; flush(); },
    monitor() { nodes(tree).find(node => node.type === "button" && node.props.children === "Monitor")!.props.onClick(); flush(); },
    foreground() { foregroundPlayback.acquire(program, () => calls.push("program:pause")); flush(); },
    geometry(width: number) { rect.width = width; rect.right = width; listeners.get("resize")?.forEach(callback => callback()); flush(); },
    notify(index: number, status: "playing" | "unavailable") { adapters[index].notify({ status }); flush(); },
    unavailable() { return nodes(tree).some(node => node.type === "span" && node.props.children === "Unavailable"); },
    heading() { return nodes(tree).find(node => node.type === "h3")!.props.children; },
    close() { for (const effect of effects.values()) effect.cleanup?.(); foregroundPlayback.release(program); },
  };
  result.render();
  return result;
}

function assertMutedInert(h: ReturnType<typeof harness>, index: number) {
  assert.equal(h.element.inert, true, "provider keyboard controls stay inert until this handle acquires focus");
  assert.equal(h.element.style.pointerEvents, "none");
  assert.equal(h.adapters[index].muted, true);
  assert.equal(h.adapters[index].inertAtCreation, true, "replacement starts with synchronous DOM interactivity reset");
  assert.equal(h.adapters[index].pointerAtCreation, "none");
}

it("same ID/revision/key rename retains the monitored handle and its foreground ownership", () => {
  const h = harness();
  try {
    h.foreground(); h.monitor();
    h.render({ ...source, label: "Renamed" });
    assert.equal(h.heading(), "Renamed");
    assert.equal(h.adapters.length, 1, "display metadata must not replace playback");
    assert.equal(h.adapters[0].request.title, "Renamed");
    assert.equal(h.element.inert, false);
    assert.equal(h.adapters[0].muted, false);
    h.foreground();
    assert.equal(h.adapters[0].disposed, true);
    assert.equal(h.adapters[0].muted, true);
    assert.equal(h.element.inert, true);
  } finally { h.close(); }
});

it("a source replacement cannot inherit Monitor; each handle acquires before becoming audible", async () => {
  const h = harness();
  try {
    h.foreground(); h.monitor();
    h.render({ ...source, input: { kind: "twitch", channel: "replacement" }, publicUrl: "https://www.twitch.tv/replacement" });
    assert.equal(h.adapters[0].disposed, true);
    assertMutedInert(h, 1);
    h.foreground();
    assert.equal(h.adapters[1].muted, true, "another foreground owner cannot coexist with an audible unowned preview");
    h.monitor();
    assert(h.calls.lastIndexOf("program:pause") < h.calls.lastIndexOf("1:muted:false"));
    h.adapters[0].rejectPlay(new Error("late old play failure"));
    await Promise.resolve(); h.render();
    assert.equal(h.adapters[1].disposed, false);
    assert.equal(h.element.inert, false);
    h.foreground();
    assert.equal(h.adapters[1].disposed, true);
    assert.equal(h.adapters[1].muted, true);
    assert.equal(h.element.inert, true);
  } finally { h.close(); }
});

it("geometry recreation resets interactivity and fences old adapter notifications within the same source", () => {
  const h = harness();
  try {
    h.monitor(); h.geometry(399);
    assert.equal(h.adapters[0].disposed, true);
    h.geometry(600);
    assertMutedInert(h, 1);
    h.notify(0, "unavailable");
    assert.equal(h.unavailable(), false, "a disposed geometry handle cannot mark its successor unavailable");
    h.monitor(); h.foreground();
    assert.equal(h.adapters[1].disposed, true);
    h.monitor();
    assert.equal(h.adapters.length, 3);
    h.notify(1, "unavailable");
    assert.equal(h.unavailable(), false, "callbacks from a stopped adapter cannot affect a restarted handle");
    h.foreground();
    assert.equal(h.adapters[2].muted, true);
  } finally { h.close(); }
});

it("only the current adapter can report failure or recovery, and a successful replacement clears obsolete failure", () => {
  const h = harness();
  try {
    h.notify(0, "unavailable"); assert.equal(h.unavailable(), true);
    h.notify(0, "playing"); assert.equal(h.unavailable(), false);
    h.notify(0, "unavailable"); h.geometry(399); h.geometry(600);
    assert.equal(h.unavailable(), false);
    h.notify(1, "unavailable"); h.notify(0, "playing");
    assert.equal(h.unavailable(), true, "old success cannot clear a current failure");
    h.notify(1, "playing"); assert.equal(h.unavailable(), false);
    assertMutedInert(h, 1);
  } finally { h.close(); }
});
