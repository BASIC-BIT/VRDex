import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMediaControlCustomId,
  eventMediaCommandTypeForDiscordAction,
  parseMediaControlCustomId,
  routeMediaInteraction,
} from "./mediaControlRouting";

describe("Discord media control routing", () => {
  it("maps Discord control actions to the shared event media command model", () => {
    assert.equal(eventMediaCommandTypeForDiscordAction("start"), "start_program");
    assert.equal(eventMediaCommandTypeForDiscordAction("stop"), "stop_program");
    assert.equal(eventMediaCommandTypeForDiscordAction("hold"), "switch_hold");
    assert.equal(eventMediaCommandTypeForDiscordAction("next"), "next_slot");
    assert.equal(eventMediaCommandTypeForDiscordAction("previous"), "previous_slot");
    assert.equal(eventMediaCommandTypeForDiscordAction("source"), "switch_source");
    assert.equal(eventMediaCommandTypeForDiscordAction("fallback"), "force_direct_link_fallback");
    assert.equal(eventMediaCommandTypeForDiscordAction("publish_watch_link"), "publish_current_public_watch_link");
    assert.equal(eventMediaCommandTypeForDiscordAction("refresh"), undefined);
  });

  it("builds compact custom IDs and parses event and revision routing hints", () => {
    const customId = buildMediaControlCustomId({ action: "next", eventId: "event_123", panelRevision: 7 });

    assert.equal(customId, "vrdex:mc:next:event_123:r7");
    assert.deepEqual(parseMediaControlCustomId(customId), {
      action: "next",
      eventId: "event_123",
      panelRevision: 7,
    });
  });

  it("defers active button commands and returns an enqueueable command payload", () => {
    const route = routeMediaInteraction({
      kind: "button",
      customId: "vrdex:mc:hold:event_123:r4",
      currentPanelRevision: 4,
    });

    assert.equal(route.route, "command");
    assert.equal(route.ack, "defer_message_update");
    assert.equal(route.eventId, "event_123");
    assert.equal(route.requiresConfirmation, false);
    assert.deepEqual(route.command, { type: "switch_hold" });
  });

  it("routes stale panel component clicks to ephemeral warnings without commands", () => {
    const route = routeMediaInteraction({
      kind: "button",
      customId: "vrdex:mc:next:event_123:r3",
      currentPanelRevision: 4,
    });

    assert.equal(route.route, "stale_panel");
    assert.equal(route.ack, "reply_ephemeral");
    assert.equal(route.stale, true);
    assert.equal(route.command, undefined);
  });

  it("maps source select controls to switch_source commands", () => {
    const route = routeMediaInteraction({
      kind: "select",
      customId: "vrdex:mc:source:event_123:r4",
      currentPanelRevision: 4,
      targetSourceKey: "main_dj",
    });

    assert.equal(route.route, "command");
    assert.deepEqual(route.command, { type: "switch_source", targetSourceKey: "main_dj" });
  });

  it("marks fallback as confirmation-gated and requires fallback links", () => {
    const missingLinks = routeMediaInteraction({
      kind: "modal",
      action: "fallback",
      eventId: "event_123",
    });
    const withLinks = routeMediaInteraction({
      kind: "modal",
      action: "fallback",
      eventId: "event_123",
      publicFallbackLinks: [{ platform: "browser", url: "https://example.invalid/watch" }],
    });

    assert.equal(missingLinks.route, "unknown");
    assert.equal(missingLinks.ack, "reply_ephemeral");
    assert.equal(withLinks.requiresConfirmation, true);
    assert.deepEqual(withLinks.command, {
      type: "force_direct_link_fallback",
      publicFallbackLinks: [{ platform: "browser", url: "https://example.invalid/watch" }],
    });
  });
});
