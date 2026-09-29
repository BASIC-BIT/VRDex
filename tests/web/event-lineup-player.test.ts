import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
test("server lineup waits for the viewer clock and opens no media", () => {
 const output = execFileSync(process.execPath,["--import","tsx","--input-type=module","-e",`
 import { createElement } from "react";
 import { renderToStaticMarkup } from "react-dom/server";
 import { EventLineupPlayer } from "./src/app/_components/event-lineup-player.tsx";
 console.log(renderToStaticMarkup(createElement(EventLineupPlayer,{event:{title:"Event",startAt:0,slots:[]}})));
 `], {cwd:path.resolve("apps/web"),encoding:"utf8",env:{...process.env,TSX_TSCONFIG_PATH:"tsconfig.json"}});
 assert.equal(output.trim(), "");
 assert.doesNotMatch(output,/<video/);
});
