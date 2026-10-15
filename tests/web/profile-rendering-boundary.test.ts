import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

it("keeps server-only media-kit configuration out of the client-compatible profile renderer", () => {
  const renderer = readFileSync(new URL("../../apps/web/src/app/_components/profile-public-page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(renderer, /process\.env\.(VRDEX_PROFILE_MEDIA_KIT_ENABLED|VRDEX_ENABLE_PLAYWRIGHT_FIXTURES)/);
  assert.match(renderer, /mediaKitGalleryEnabled: boolean/);
  for (const route of ["page.tsx", "edit/page.tsx"]) {
    const source = readFileSync(new URL(`../../apps/web/src/app/[slug]/${route}`, import.meta.url), "utf8");
    assert.match(source, /mediaKitGalleryEnabled=\{process\.env\.VRDEX_PROFILE_MEDIA_KIT_ENABLED/);
  }
});

it("renders a neutral source and collapsed disclosure without exposing freeform credit", async () => {
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import React from "./apps/web/node_modules/react/index.js";
    import { renderToStaticMarkup } from "./apps/web/node_modules/react-dom/server.node.js";
    import { PublicMediaAssetCardView } from "./apps/web/src/app/_components/public-media-asset-card.tsx";
    const asset = { assetId: "asset", detailsUrl: "/profile#media-asset", imageUrl: "/image.png", downloadUrl: "/file", mimeType: "image/png", byteSize: 1024, credit: "Shared by Karly", creditUrl: "https://example.test/source" };
    const render = (a) => renderToStaticMarkup(React.createElement(PublicMediaAssetCardView, { asset: a, label: "Image", state: { kind: "closed" }, open: false }));
    const html = render(asset);
    assert.match(html, /View source/);
    assert.match(html, /Details &amp; history/);
    assert.doesNotMatch(html, /Karly|Uploaded by/);
    assert.doesNotMatch(render({ ...asset, detailsUrl: undefined }), /Details &amp; history/);
    for (const creditUrl of [undefined, "javascript:alert(1)", "https://user:pass@example.test", "//example.test"]) assert.doesNotMatch(render({ ...asset, creditUrl }), /View source/);
  `], { cwd: process.cwd(), env: { ...process.env, TSX_TSCONFIG_PATH: "apps/web/tsconfig.json" }, stdio: "pipe" });
});

for (const scenario of ["null history actors", "out-of-range history timestamp"]) {
  it(`renders public media details with ${scenario}`, async () => {
    const { execFileSync } = await import("node:child_process");
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import React from "./apps/web/node_modules/react/index.js";
      import { renderToStaticMarkup } from "./apps/web/node_modules/react-dom/server.node.js";
      import { PublicMediaAssetCardView } from "./apps/web/src/app/_components/public-media-asset-card.tsx";
      const actor = { displayName: "Uploader", profileUrl: "/uploader" };
      const asset = { assetId: "asset", detailsUrl: "/profile#media-asset", imageUrl: "/image.png", downloadUrl: "/file" };
      const scenario = "${scenario}";
      const details = { asset, profileSlug: "profile", uploadedBy: actor, credit: null,
        history: [
          { kind: "uploaded", actor, at: 0 },
          { kind: "approved", actor: null, at: null },
          { kind: "published", actor: null, at: scenario === "out-of-range history timestamp" ? 1e20 : null },
        ] };
      const html = renderToStaticMarkup(React.createElement(PublicMediaAssetCardView, {
        asset, label: "Image", state: { kind: "ready", details }, open: true,
      }));
      if (scenario === "null history actors") {
        const rows = html.split("</li>").filter(row => row.includes("<li "));
        assert.equal(rows.length, 3);
        for (const row of rows.slice(1)) {
          assert.match(row, /Unavailable/);
          assert.doesNotMatch(row, /<a /);
        }
      } else {
        assert.equal((html.match(/<time /g) ?? []).length, 1);
        assert.match(html, /1970-01-01T00:00:00.000Z/);
        assert.doesNotMatch(html, /Invalid Date/);
      }
    `], { cwd: process.cwd(), env: { ...process.env, TSX_TSCONFIG_PATH: "apps/web/tsconfig.json" }, stdio: "pipe" });
  });
}
