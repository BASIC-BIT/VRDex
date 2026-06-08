import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  sanitizeEventMediaCommandInput,
  sanitizeEventMediaPublicLink,
  toPublicEventMediaProgramState,
} from "../../convex/_eventMediaControl";

describe("event media control helpers", () => {
  it("normalizes direct fallback links into platform-safe playback URLs", () => {
    const command = sanitizeEventMediaCommandInput({
      type: "force_direct_link_fallback",
      publicFallbackLinks: [
        {
          platform: "browser",
          label: " Browser ",
          url: "https://vrcdn.live/basicbit",
        },
        {
          platform: "pc",
          url: "https://stream.vrcdn.live/live/basicbit.live.ts",
        },
        {
          platform: "standalone",
          url: "rtspt://stream.vrcdn.live/live/basicbit",
        },
      ],
    });

    assert.deepEqual(command.publicFallbackLinks, [
      {
        platform: "browser",
        label: "Browser",
        url: "https://vrcdn.live/basicbit",
      },
      {
        platform: "pc",
        label: "PC stream link",
        url: "rtspt://stream.vrcdn.live/live/basicbit",
      },
      {
        platform: "standalone",
        label: "Standalone stream link",
        url: "https://stream.vrcdn.live/live/basicbit.live.ts",
      },
    ]);
  });

  it("requires target source keys for source-specific commands", () => {
    assert.throws(
      () => sanitizeEventMediaCommandInput({ type: "switch_source" }),
      /switch_source requires a target source key\./,
    );

    assert.equal(
      sanitizeEventMediaCommandInput({
        type: "switch_source",
        targetSourceKey: " Main_Source ",
      }).targetSourceKey,
      "main_source",
    );
  });

  it("rejects fallback commands without public fallback links", () => {
    assert.throws(
      () => sanitizeEventMediaCommandInput({ type: "force_direct_link_fallback" }),
      /Direct-link fallback requires at least one public fallback link\./,
    );
  });

  it("keeps non-VRCDN public links HTTPS-only", () => {
    assert.deepEqual(sanitizeEventMediaPublicLink({ platform: "browser", url: "https://example.invalid/watch" }), {
      platform: "browser",
      label: "Browser watch link",
      url: "https://example.invalid/watch",
    });

    assert.throws(
      () => sanitizeEventMediaPublicLink({ platform: "browser", url: "http://example.invalid/watch" }),
      /Media control public links must use HTTPS or a recognized VRCDN stream URL\./,
    );
  });

  it("projects only safe media program state for public surfaces", () => {
    const publicState = toPublicEventMediaProgramState({
      status: "live",
      currentSourceLabel: "DJ Aurora",
      currentOutputLabel: "VRCDN main",
      publicLinks: [{ platform: "browser", url: "https://example.invalid/watch" }],
      directFallbackLinks: [{ platform: "pc", url: "https://vrcdn.live/basicbit" }],
      activeWorkerId: "worker-123",
      workerLeaseExpiresAt: Date.UTC(2026, 5, 14, 23, 0, 0),
      commandQueueDepth: 4,
      credentialRefs: ["secret/event-output-key"],
      privateNotes: "Do not show operator notes.",
    });
    const raw = publicState as Record<string, unknown>;

    assert.equal(publicState.status, "live");
    assert.deepEqual(publicState.publicLinks, [
      {
        platform: "browser",
        label: "Browser watch link",
        url: "https://example.invalid/watch",
      },
    ]);
    assert.deepEqual(publicState.directFallbackLinks, [
      {
        platform: "pc",
        label: "PC stream link",
        url: "rtspt://stream.vrcdn.live/live/basicbit",
      },
    ]);
    assert.equal("activeWorkerId" in raw, false);
    assert.equal("workerLeaseExpiresAt" in raw, false);
    assert.equal("credentialRefs" in raw, false);
    assert.equal("privateNotes" in raw, false);
  });
});
