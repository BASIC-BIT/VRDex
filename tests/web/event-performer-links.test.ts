import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { it } from "node:test";

it("renders recordings and live copy rows in either order while deduplicating live variants", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { EventPerformerLinks } from "./src/app/_components/event-performer-links.tsx";
    const link = (label, url) => ({ label, url, type: "website", source: "owner_authored" });
    const live = link("Live", "https://stream.vrcdn.live/live/aurora.live.ts");
    const recording = link("Recording", "https://stream.vrcdn.live/live/aurora.mp4");
    const pc = link("PC variant", "rtspt://stream.vrcdn.live/live/aurora");
    const reference = link("Reference variant", "vrcdn:aurora");
    for (const links of [[live, recording, pc, reference], [recording, pc, live, reference]]) {
      const html = renderToStaticMarkup(createElement(EventPerformerLinks, { links }));
      assert.ok(html.includes('href="https://stream.vrcdn.live/live/aurora.mp4"'), "recording stays accessible");
      assert.equal(html.split('aria-label="Copy PC"').length - 1, 1, "one live PC action");
      assert.equal(html.split('aria-label="Copy Quest"').length - 1, 1, "one live Quest action");
    }
    console.log("recording and live links preserved");
  `], {
    cwd: path.resolve("apps/web"), encoding: "utf8",
    env: { ...process.env, TSX_TSCONFIG_PATH: "tsconfig.json" },
  });
  assert.match(output, /recording and live links preserved/);
});
