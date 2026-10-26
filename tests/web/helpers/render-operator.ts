import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
const root = path.resolve("apps/web/src");
const requireWeb = createRequire(path.resolve("apps/web/package.json"));
const React = requireWeb("react");
const { renderToStaticMarkup } = requireWeb("react-dom/server");
/** Execute real components with framework/network boundaries replaced; no services. */
export function renderOperator(status: unknown) {
  const mocks: Record<string, unknown> = {
    "next/link": {
      default: (props: object) => React.createElement("a", props),
    },
    "convex/react": { useQuery: () => undefined },
    "@convex-generated-api": { api: {} },
    "@/components/ui/button": {
      buttonVariants: () => "",
      Button: ({ variant: _v, size: _s, ...props }: Record<string, unknown>) =>
        React.createElement("button", props),
    },
    "@/components/ui/page-shell": {
      PageContainer: ({ max: _m, ...props }: Record<string, unknown>) =>
        React.createElement("div", props),
      PageShell: (props: object) => React.createElement("div", props),
    },
    "./viewer-local-event-times": { ViewerLocalEventDateTime: () => null },
    "./event-host-view": { EventHostView: () => null },
  };
  function load(file: string): Record<string, any> {
    const resolved = [".tsx", ".ts", ".mjs", ""]
      .map((ext) => file + ext)
      .find((candidate) => {
        try {
          readFileSync(candidate);
          return true;
        } catch {
          return false;
        }
      });
    if (!resolved) throw Error(`Missing ${file}`);
    if (resolved.endsWith(".mjs")) return requireWeb(resolved);
    const output = ts.transpileModule(readFileSync(resolved, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    const exports = {};
    vm.runInNewContext(output, {
      exports,
      require: (name: string) =>
        name in mocks
          ? mocks[name]
          : name.startsWith("@/")
            ? load(path.join(root, name.slice(2)))
            : name.startsWith(".")
              ? load(path.resolve(path.dirname(resolved), name))
              : requireWeb(name),
      Date,
      performance,
      setInterval,
      clearInterval,
    });
    return exports;
  }
  const { EventOperatorControls } = load(
    path.join(root, "app/_components/event-operator-view"),
  );
  return renderToStaticMarkup(
    React.createElement(EventOperatorControls, {
      status,
      onCancel: async () => {},
      onSaveSettings: async () => {},
      onCreate: async () => {},
      onReplace: async () => {},
      onRemove: async () => {},
    }),
  );
}
