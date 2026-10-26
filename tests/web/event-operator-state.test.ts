import assert from "node:assert/strict";
import { it } from "node:test";
import { renderOperator } from "./helpers/render-operator";
const now = 100_000;
function fixture() {
  return {
    eventPath: "/club/events/show",
    eventTitle: "Show",
    serverNow: now,
    canControl: true,
    outputConfigurationLocked: true,
    program: {
      activeSessionId: "session",
      mediaSettings: { videoPreset: "1080p60", audioBitrateKbps: 320 },
    },
    sources: [
      {
        sourceId: "a",
        key: "a",
        label: "Aurora",
        revision: 1,
        input: { kind: "vrcdn", streamId: "aurora" },
        publicUrl: "vrcdn:aurora",
        hasPublicUrl: true,
        state: "ready",
        editable: true,
      },
      {
        sourceId: "b",
        key: "b",
        label: "Nova",
        revision: 2,
        input: { kind: "twitch", channel: "nova" },
        publicUrl: "https://www.twitch.tv/nova",
        hasPublicUrl: true,
        state: "ready",
        editable: false,
      },
    ],
    sessions: [
      {
        sessionId: "session",
        status: "live",
        controlProtocolVersion: 2,
        committedIntent: { kind: "manual", sourceId: "a", revision: 1 },
        currentSourceId: "a",
        observedSourceRevision: 1,
        observedSlotKey: "manual:a",
        observedOutputMs: 1000,
        broadcastMode: "manual",
        programObservedAt: now,
        leaseExpiresAt: now + 30_000,
        outputHealth: [],
        mediaSettings: { videoPreset: "720p30", audioBitrateKbps: 160 },
        destinationProfiles: [],
        pendingOperation: {
          commandId: "take-b",
          phase: "preparing",
          target: {
            kind: "source",
            source: { sourceId: "b", revision: 2, slotKey: "manual:b" },
            mode: "manual",
          },
        },
        resources: {
          observedAt: now,
          staleAfterMs: 30_000,
          fresh: true,
          cpuUsagePercent: 0,
          memoryUsedBytes: 1048576,
          activeFormats: [],
        },
      },
    ],
    outputs: [],
    commands: [
      {
        commandId: "take-b",
        sessionId: "session",
        status: "claimed",
        commandType: "switch_source",
        targetSourceId: "b",
      },
    ],
    twitchAccounts: [],
  };
}
function field(html: string, label: string) {
  return html.match(
    new RegExp(`<dt[^>]*>${label}</dt><dd[^>]*>(.*?)</dd>`),
  )?.[1];
}
it("actual encoded output and committed intent stay on Aurora while Nova prepares; Cut remains enabled", () => {
  const html = renderOperator(fixture());
  assert.match(html, />Preparing</);
  assert.match(field(html, "Observed output") ?? "", /Aurora/);
  assert.match(field(html, "Desired source") ?? "", /Aurora/);
  assert.match(html, /<button(?![^>]*disabled)[^>]*>Cut to slate<\/button>/);
  assert.match(html, /<button(?![^>]*disabled)[^>]*>Cancel<\/button>/);
});
it("Cancel disappears during promotion and Stop precedence disables Cut", () => {
  const status = fixture();
  status.sessions[0].pendingOperation.phase = "promoting";
  assert.doesNotMatch(renderOperator(status), />Cancel<\/button>/);
  status.sessions[0].status = "stopping";
  assert.match(
    renderOperator(status),
    /<button[^>]*disabled=""[^>]*>Cut to slate<\/button>/,
  );
});
it("failed preparation retains committed and encoded source; schedule gaps still allow Return to auto", () => {
  const status = fixture();
  Reflect.set(status.sessions[0], "pendingOperation", null);
  status.commands[0].status = "failed";
  const html = renderOperator(status);
  assert.match(field(html, "Desired source") ?? "", /Aurora/);
  assert.match(field(html, "Observed output") ?? "", /Aurora/);
  assert.match(html, /<button(?![^>]*disabled)[^>]*>Return to auto<\/button>/);
});
it("diagnostics preserve zero, age to unknown independently, and settings separate active from next start", () => {
  const status = fixture();
  let html = renderOperator(status);
  assert.match(html, />Diagnostics</);
  assert.equal(field(html, "CPU"), "0%");
  assert.match(html, />Active</);
  assert.match(html, />Next start</);
  assert.match(html, /1080p60/);
  assert.match(html, /720p30/);
  for (const value of ["480", "720", "1080", "30", "60", "160", "320"])
    assert.match(html, new RegExp(`<option value="${value}"`));
  status.serverNow += 30_000;
  html = renderOperator(status);
  assert.equal(field(html, "CPU"), "Unknown");
});
it("activeSessionId wins over newer terminal sessions and missing active ID never borrows another live session", () => {
  const status = fixture();
  status.sessions.unshift({
    ...status.sessions[0],
    sessionId: "newer",
    status: "ended",
    currentSourceId: "b",
  });
  assert.match(
    field(renderOperator(status), "Observed output") ?? "",
    /Aurora/,
  );
  status.program.activeSessionId = "missing";
  assert.equal(field(renderOperator(status), "Observed output"), "Unknown");
});

it("status windows prioritize current, next, preview and visible sources without treating custom sources as a missing next slot", async () => {
  const { operatorFixture, fixtureSource, fixtureId } =
    await import("../../apps/web/src/app/playwright/event-operator/fixture-state");
  const { operatorStatusWindow } =
    await import("../../apps/web/src/lib/event-operator-state");
  const status = operatorFixture();
  status.sources = [
    fixtureSource("current", "Current"),
    fixtureSource("next", "Next"),
    fixtureSource("preview", "Preview"),
    fixtureSource("visible", "Visible"),
    fixtureSource("hidden", "Hidden"),
  ];
  status.sessions[0].currentSourceId = status.sources[0].sourceId;
  status.sources[1].eventSlotId = fixtureId("eventSlots", "slot-next");
  status.nextSlot = {
    slotId: status.sources[1].eventSlotId,
    position: 2,
    startAt: status.serverNow + 1000,
    displayLabel: "Next",
    roleLabel: "DJ",
    reviewState: "confirmed",
  };
  assert.deepEqual(
    operatorStatusWindow(
      status,
      status.sources[2],
      status.sources.slice(3),
    ).map((source) => source.key),
    ["current", "next", "preview", "visible"],
  );
  delete status.nextSlot;
  status.sessions[0].currentSourceId = undefined;
  assert.deepEqual(
    operatorStatusWindow(status, status.sources[2], [status.sources[3]]).map(
      (source) => source.key,
    ),
    ["preview", "visible"],
  );
});

it("superseded preparation remains a distinct receipt and cannot offer Cancel", () => {
  const status = fixture();
  Reflect.set(status.sessions[0], "pendingOperation", null);
  status.commands[0].status = "cancelled";
  Reflect.set(status.commands[0], "controlOutcome", "superseded");
  const html = renderOperator(status);
  assert.match(html, />superseded<\/span>/);
  assert.doesNotMatch(html, />Cancel<\/button>/);
  assert.match(field(html, "Observed output") ?? "", /Aurora/);
});
it("a missing active session never borrows the only live session", () => {
  const status = fixture();
  status.program.activeSessionId = "missing";
  const html = renderOperator(status);
  assert.equal(field(html, "Observed output"), "Unknown");
  assert.match(html, /<button[^>]*disabled=""[^>]*>Cut to slate<\/button>/);
});
