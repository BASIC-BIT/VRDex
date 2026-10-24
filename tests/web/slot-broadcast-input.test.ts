import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
const requireWeb = createRequire(path.resolve("apps/web/package.json"));
const output = ts.transpileModule(
  readFileSync(
    "apps/web/src/app/events/slot-broadcast-input-select.tsx",
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
const exports: Record<string, any> = {};
vm.runInNewContext(output, {
  exports,
  require: (name: string) =>
    name === "@/components/ui/field"
      ? { Field: "label", Select: "select" }
      : requireWeb(name),
});
it("broadcast selector preserves unavailable explicit input and only emits null on explicit reset", () => {
  const changes: unknown[] = [];
  const input = { kind: "twitch", channel: "removed" };
  const tree = exports.SlotBroadcastInputSelect({
    value: input,
    choices: [],
    onChange: (value: unknown) => changes.push(value),
  });
  const select = tree.props.children[1];
  assert.equal(select.props.value, "twitch:removed");
  const { renderToStaticMarkup } = requireWeb("react-dom/server");
  assert.match(renderToStaticMarkup(tree), /twitch:removed \(Unavailable\)/);
  assert.deepEqual(changes, []);
  select.props.onChange({ target: { value: "" } });
  assert.deepEqual(changes, [null]);
});
it("broadcast selector uses canonical choice objects without touching the legacy Stream value", () => {
  const twitch = { kind: "twitch", channel: "aurora" },
    vrcdn = { kind: "vrcdn", streamId: "aurora" };
  const changes: unknown[] = [];
  const choices = [
    { input: twitch, key: "twitch:aurora", label: "aurora" },
    { input: vrcdn, key: "vrcdn:aurora", label: "aurora" },
  ];
  const tree = exports.SlotBroadcastInputSelect({
    value: undefined,
    choices,
    onChange: (value: unknown) => changes.push(value),
  });
  const select = tree.props.children[1];
  assert.equal(select.props.value, "");
  select.props.onChange({ target: { value: "twitch:aurora" } });
  assert.equal(changes[0], twitch);
  select.props.onChange({ target: { value: "foreign" } });
  assert.equal(changes.length, 1);
});
