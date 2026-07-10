import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeHandoffPreview,
  normalizeOwnerDestination,
  safeExternalHttpUrl,
} from "../../apps/web/src/app/handoff/[token]/handoff-contract";

describe("handoff preview contract", () => {
  it("normalizes a prepared identity and only usable fields", () => {
    const preview = normalizeHandoffPreview(
      {
        state: "ready",
        sourceName: "NWinn",
        invitation: { expiresAt: 2_000 },
        preparedIdentity: {
          profileType: "person",
          displayName: "DJ Aurora",
          fields: [
            { id: "name", label: "Display name", value: "DJ Aurora" },
            { id: "empty", label: "Empty" },
          ],
          safeLinks: [
            {
              fieldId: "soundcloud",
              label: "SoundCloud",
              value: "https://soundcloud.com/dj-aurora",
              selectedByDefault: false,
            },
          ],
        },
      },
      1_000,
    );

    assert.deepEqual(preview, {
      state: "ready",
      displayName: "DJ Aurora",
      profileType: "person",
      sourceName: "NWinn",
      expiresAt: 2_000,
      fields: [
        {
          id: "name",
          label: "Display name",
          value: "DJ Aurora",
          kind: "text",
          selectedByDefault: true,
        },
        {
          id: "soundcloud",
          label: "SoundCloud",
          value: "https://soundcloud.com/dj-aurora",
          kind: "link",
          url: "https://soundcloud.com/dj-aurora",
          selectedByDefault: false,
        },
      ],
    });
  });

  it("covers invalid, expired, revoked, and accepted invitation states", () => {
    assert.deepEqual(normalizeHandoffPreview(null), { state: "invalid" });
    assert.deepEqual(normalizeHandoffPreview({ status: "not_found" }), { state: "invalid" });
    assert.deepEqual(normalizeHandoffPreview({ state: "expired" }), { state: "expired" });
    assert.deepEqual(normalizeHandoffPreview({ state: "revoked" }), { state: "revoked" });
    assert.deepEqual(
      normalizeHandoffPreview({ state: "accepted", ownerDestination: "/account" }),
      { state: "accepted", ownerDestination: "/account" },
    );
  });

  it("treats a ready invitation past its expiry as expired", () => {
    assert.deepEqual(
      normalizeHandoffPreview(
        {
          state: "ready",
          expiresAt: 999,
          displayName: "DJ Aurora",
          fields: [],
        },
        1_000,
      ),
      { state: "expired" },
    );
  });

  it("renders only HTTP links and same-origin owner destinations", () => {
    assert.equal(safeExternalHttpUrl("https://vrdex.example/profile"), "https://vrdex.example/profile");
    assert.equal(safeExternalHttpUrl("http://vrdex.example/profile"), "http://vrdex.example/profile");
    assert.equal(safeExternalHttpUrl("javascript:alert(1)"), undefined);
    assert.equal(safeExternalHttpUrl("not a url"), undefined);

    assert.deepEqual(normalizeOwnerDestination({ ownerDestination: "/p/dj-aurora" }), {
      ownerDestination: "/p/dj-aurora",
    });
    assert.deepEqual(normalizeOwnerDestination({ ownerDestination: "https://attacker.invalid" }), {});
    assert.deepEqual(normalizeOwnerDestination({ destination: "//attacker.invalid" }), {});
  });

  it("normalizes grouped outbound links without accepting unsafe URLs", () => {
    const preview = normalizeHandoffPreview({
      state: "ready",
      displayName: "DJ Aurora",
      fields: [
        {
          id: "links",
          label: "Links",
          kind: "link_list",
          links: [
            { label: "Twitch", url: "https://twitch.tv/dj-aurora" },
            { label: "Unsafe", url: "javascript:alert(1)" },
          ],
        },
      ],
    });

    assert.equal(preview.state, "ready");
    assert.deepEqual(preview.state === "ready" ? preview.fields[0]?.links : undefined, [
      { label: "Twitch", url: "https://twitch.tv/dj-aurora" },
    ]);
  });
});
