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
