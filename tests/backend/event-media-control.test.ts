import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EVENT_MEDIA_WORKER_READY_LEAD_MS,
  EVENT_MEDIA_WORKER_START_LEAD_MS,
  sanitizeEventMediaCommandInput,
  sanitizeEventMediaPublicLink,
  sanitizeEventMediaWorkerArtifactLinks,
  sanitizeEventMediaWorkerSchedule,
  sanitizeVrcdnOperatorOwnedOutputSetup,
  toPublicEventMediaProgramState,
} from "../../convex/_eventMediaControl";
import { getVrcdnOutputAccount, listPublicVrcdnOutputAccounts } from "../../convex/_vrcdnOutputAccounts";

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

    assert.throws(
      () => sanitizeEventMediaCommandInput({ type: "publish_fallback_link" }),
      /Direct-link fallback requires at least one public fallback link\./,
    );
  });

  it("normalizes the canonical manual operator command vocabulary", () => {
    assert.deepEqual(sanitizeEventMediaCommandInput({ type: "switch_next" }), {
      type: "switch_next",
      publicFallbackLinks: [],
    });
    assert.deepEqual(sanitizeEventMediaCommandInput({ type: "switch_previous" }), {
      type: "switch_previous",
      publicFallbackLinks: [],
    });
    assert.deepEqual(sanitizeEventMediaCommandInput({ type: "hold_current" }), {
      type: "hold_current",
      publicFallbackLinks: [],
    });
    assert.equal(
      sanitizeEventMediaCommandInput({ type: "preview_source", targetSourceKey: " DJ_Aurora " }).targetSourceKey,
      "dj_aurora",
    );
    assert.equal(
      sanitizeEventMediaCommandInput({ type: "show_hold_scene", targetSceneKey: " Hold_Slate " }).targetSceneKey,
      "hold_slate",
    );
  });

  it("requires source or scene targets for target-specific manual commands", () => {
    assert.throws(
      () => sanitizeEventMediaCommandInput({ type: "preview_source" }),
      /preview_source requires a target source key\./,
    );

    assert.throws(
      () => sanitizeEventMediaCommandInput({ type: "show_hold_scene" }),
      /show_hold_scene requires a target scene key\./,
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

  it("prepares ready operator-owned VRCDN output setup from references and accepted gates", () => {
    const output = sanitizeVrcdnOperatorOwnedOutputSetup({
      key: " Main_VRCDN ",
      label: " Main VRCDN ",
      credentialRef: "event-media/vrcdn/main-output",
      ingestRegion: "north_america",
      playbackLinks: [
        { platform: "browser", url: "https://vrcdn.live/basicbit" },
        { platform: "pc", url: "https://stream.vrcdn.live/live/basicbit.live.ts" },
        { platform: "standalone", url: "rtspt://stream.vrcdn.live/live/basicbit" },
      ],
      targetVideoBitrateKbps: 3500,
      keyframeIntervalSeconds: 1,
      audioSampleRateHz: 48000,
      targetAudioBitrateKbps: 320,
      sourceConsentAccepted: true,
      destinationAuthorityAccepted: true,
      providerRulesAccepted: true,
      rightsClearedMediaAccepted: true,
    });

    assert.equal(output.key, "main_vrcdn");
    assert.equal(output.state, "ready");
    assert.deepEqual(output.credential, {
      storage: "operator_secret_store",
      secretRef: "event-media/vrcdn/main-output",
    });
    assert.deepEqual(output.vrcdnSetup, {
      ingestRegion: "north_america",
      targetVideoBitrateKbps: 3500,
      keyframeIntervalSeconds: 1,
      audioSampleRateHz: 48000,
      targetAudioBitrateKbps: 320,
    });
    assert.deepEqual(output.compliance, {
      sourceConsent: "accepted",
      destinationAuthority: "accepted",
      providerRules: "accepted",
      rightsClearedMedia: "accepted",
    });
    assert.deepEqual(output.playbackLinks, [
      { platform: "browser", label: "Browser watch link", url: "https://vrcdn.live/basicbit" },
      { platform: "pc", label: "PC stream link", url: "rtspt://stream.vrcdn.live/live/basicbit" },
      { platform: "standalone", label: "Standalone stream link", url: "https://stream.vrcdn.live/live/basicbit.live.ts" },
    ]);
  });

  it("keeps operator-owned VRCDN outputs in draft until references and gates are complete", () => {
    const output = sanitizeVrcdnOperatorOwnedOutputSetup({
      key: "main-vrcdn",
      label: "Main VRCDN",
      destinationAuthorityAccepted: false,
      sourceConsentAccepted: true,
    });

    assert.equal(output.state, "draft");
    assert.equal(output.credential, undefined);
    assert.deepEqual(output.compliance, {
      sourceConsent: "accepted",
      destinationAuthority: "blocked",
      providerRules: "pending",
      rightsClearedMedia: "pending",
    });
  });

  it("rejects secret values and URLs in operator-owned VRCDN output setup", () => {
    assert.throws(
      () =>
        sanitizeVrcdnOperatorOwnedOutputSetup({
          key: "main-vrcdn",
          label: "Main VRCDN",
          credentialRef: "rtmp://example.invalid/live/value",
        }),
      /Credential secret reference must be a scoped reference name, not a secret value or URL\./,
    );

    assert.throws(
      () =>
        sanitizeVrcdnOperatorOwnedOutputSetup({
          key: "main-vrcdn",
          label: "Main VRCDN",
          streamKey: "not-persisted",
        } as Parameters<typeof sanitizeVrcdnOperatorOwnedOutputSetup>[0] & { streamKey: string }),
      /streamKey must not be stored in event media output setup records\./,
    );
  });

  it("exposes output account options without credential references", () => {
    const publicAccounts = listPublicVrcdnOutputAccounts();
    const account = getVrcdnOutputAccount("basicbit");

    assert.equal(publicAccounts.length, 1);
    assert.deepEqual(publicAccounts[0], {
      key: "basicbit",
      label: "basicbit",
      playbackLinks: [
        { platform: "browser", label: "Event stream", url: "https://panel.vrcdn.live/preview/basicbit" },
        { platform: "standalone", label: "Quest stream", url: "https://stream.vrcdn.live/live/basicbit.live.ts" },
        { platform: "pc", label: "PC stream", url: "rtspt://stream.vrcdn.live/live/basicbit" },
      ],
    });
    assert.equal("credentialRef" in publicAccounts[0]!, false);
    assert.equal(account?.credentialRef, "event-media/vrcdn/basicbit-output");
  });

  it("defaults worker scheduling to start five minutes early and require readiness two minutes early", () => {
    const eventStartAt = Date.UTC(2026, 5, 14, 22, 0, 0);
    const schedule = sanitizeEventMediaWorkerSchedule({ eventStartAt });

    assert.deepEqual(schedule, {
      scheduledStartAt: eventStartAt - EVENT_MEDIA_WORKER_START_LEAD_MS,
      readyDeadlineAt: eventStartAt - EVENT_MEDIA_WORKER_READY_LEAD_MS,
    });
  });

  it("rejects worker schedules that cannot be ready before the event starts", () => {
    const eventStartAt = Date.UTC(2026, 5, 14, 22, 0, 0);

    assert.throws(
      () =>
        sanitizeEventMediaWorkerSchedule({
          eventStartAt,
          scheduledStartAt: eventStartAt - 60_000,
          readyDeadlineAt: eventStartAt - 120_000,
        }),
      /Worker ready deadline must be at or after the scheduled start time\./,
    );

    assert.throws(
      () =>
        sanitizeEventMediaWorkerSchedule({
          eventStartAt,
          readyDeadlineAt: eventStartAt,
        }),
      /Worker ready deadline must be before the event starts\./,
    );
  });

  it("keeps worker artifact links free of embedded credentials", () => {
    assert.deepEqual(
      sanitizeEventMediaWorkerArtifactLinks([
        {
          type: "report",
          label: " Report ",
          url: "s3://vrdex-restream-worker-079358094174-artifacts/synthetic-benchmarks/report.html",
        },
        {
          type: "logs",
          url: "https://console.aws.amazon.com/cloudwatch/home",
        },
      ]),
      [
        {
          type: "report",
          label: "Report",
          url: "s3://vrdex-restream-worker-079358094174-artifacts/synthetic-benchmarks/report.html",
        },
        {
          type: "logs",
          label: "Worker logs",
          url: "https://console.aws.amazon.com/cloudwatch/home",
        },
      ],
    );

    assert.throws(
      () =>
        sanitizeEventMediaWorkerArtifactLinks([
          {
            type: "report",
            url: "https://example.invalid/report.html?X-Amz-Signature=secret",
          },
        ]),
      /Worker artifact links must be private S3 URIs or HTTPS URLs without embedded credentials or query strings\./,
    );
  });
});
