import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { it } from "node:test";

it("groups only VRCDN and Twitch targets across repeated sets in a collapsed accordion", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import * as module from "./src/app/_components/event-dj-links.tsx";
    const { EventDjLinks } = module;
    assert.equal(typeof EventDjLinks, "function");
    const link = (url) => ({ label: "Source", url, type: "website", source: "owner_authored" });
    const person = { slug: "aurora", displayName: "Aurora", outboundLinks: [
      link("vrcdn:aurora"), link("rtspt://stream.vrcdn.live/live/aurora"),
      link("https://stream.vrcdn.live/live/aurora.live.ts"),
      link("https://twitch.tv/Aurora?ref=event"), link("https://www.twitch.tv/aurora/"),
      link("https://soundcloud.com/aurora"), link("https://twitch.tv.evil.example/aurora"),
    ] };
    const lineup = [0, 1].map(position => ({ key: String(position), position, displayLabel: "Aurora", performer: person }));
    const html = renderToStaticMarkup(createElement(EventDjLinks, { lineup }));
    assert.match(html, /<details/);
    assert.doesNotMatch(html, /<details[^>]*open/);
    assert.match(html, />DJ links</);
    assert.equal(html.split('aria-label="Copy PC"').length - 1, 1);
    assert.equal(html.split('aria-label="Copy Quest"').length - 1, 1);
    assert.equal(html.split('href="https:\/\/www.twitch.tv\/aurora"').length - 1, 1);
    assert.doesNotMatch(html, /soundcloud|evil\.example/);
    assert.equal(renderToStaticMarkup(createElement(EventDjLinks, { lineup: [] })), "");
    assert.equal(renderToStaticMarkup(createElement(EventDjLinks, { lineup: [{ ...lineup[0], performer: { ...person, outboundLinks: [link("https://soundcloud.com/aurora")] } }] })), "");
    console.log("DJ links pass");
  `], { cwd: path.resolve("apps/web"), encoding: "utf8", env: { ...process.env, TSX_TSCONFIG_PATH: "tsconfig.json" } });
  assert.match(output, /DJ links pass/);
});
