import { v } from "convex/values";

import { normalizeProfileInlineText } from "./_profileSubmissions";
import { safeHttpsUrl } from "./_publicFields";
import { parseVrcdnStreamLinks } from "./_vrcdnLinks";

const CONTROL_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CONTROL_NOTE_MAX_LENGTH = 500;
const LINK_LABEL_MAX_LENGTH = 80;
const SECRET_REF_PATTERN = /^[a-z0-9][a-z0-9/_.:-]{2,191}$/;
const FORBIDDEN_SECRET_INPUT_FIELDS = new Set(["ingestUrl", "password", "secret", "secretValue", "streamKey", "token"]);
const S3_URI_PATTERN = /^s3:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\/[A-Za-z0-9!_.*'()/=+:,@-]+$/;

export const EVENT_MEDIA_WORKER_START_LEAD_MS = 5 * 60 * 1000;
export const EVENT_MEDIA_WORKER_READY_LEAD_MS = 2 * 60 * 1000;

export type EventMediaProgramState =
  | "draft"
  | "ready"
  | "starting"
  | "live"
  | "hold"
  | "fallback"
  | "stopping"
  | "ended"
  | "error"
  | "disabled";

export type EventMediaSourceType =
  | "performer_stream"
  | "vj_stream"
  | "event_camera"
  | "vrcdn_link"
  | "twitch_watch"
  | "hls_url"
  | "rtmp_source"
  | "uploaded_file"
  | "static_image"
  | "audio_loop"
  | "manual_link"
  | "other";

export type EventMediaSourcePurpose =
  | "program"
  | "visual_restream"
  | "camera"
  | "hold_visual"
  | "hold_audio"
  | "fallback"
  | "watch";

export type EventMediaSourceState = "draft" | "ready" | "live" | "offline" | "failed" | "disabled";

export type EventMediaSceneType = "source" | "hold_slate" | "intro" | "outro" | "offline_card" | "countdown";

export type EventMediaOutputType = "vrcdn" | "external_rtmp" | "aws_hls" | "ivs" | "manual";

export type EventMediaOutputAccountModel = "operator_owned";

export type EventMediaOutputState = "draft" | "ready" | "active" | "disabled" | "failed";

export type EventMediaSecretStorage = "operator_secret_store";

export type EventMediaVrcdnRegion = "europe" | "north_america" | "south_america" | "asia" | "oceania";

export type EventMediaComplianceGateState = "pending" | "accepted" | "blocked";

export type EventMediaCommandType =
  | "start_program"
  | "stop_program"
  | "switch_source"
  | "switch_hold"
  | "next_slot"
  | "previous_slot"
  | "force_direct_link_fallback"
  | "mark_source_live"
  | "mark_source_offline"
  | "publish_current_public_watch_link";

export type EventMediaCommandStatus = "queued" | "claimed" | "succeeded" | "failed" | "cancelled";

export type EventMediaActorSurface = "web" | "discord" | "worker" | "system";

export type EventMediaSessionStatus =
  | "scheduled"
  | "starting"
  | "live"
  | "hold"
  | "fallback"
  | "stopping"
  | "ended"
  | "error";

export type EventMediaPlaybackPlatform = "browser" | "pc" | "standalone";

export type EventMediaWorkerProvider = "aws_ecs";

export type EventMediaWorkerTaskStatus = "queued" | "starting" | "running" | "stopping" | "stopped" | "failed";

export type EventMediaWorkerArtifactType = "report" | "artifact" | "logs" | "other";

export type EventMediaPublicLinkInput = {
  platform: EventMediaPlaybackPlatform;
  label?: string;
  url: string;
};

export type EventMediaPublicLink = {
  platform: EventMediaPlaybackPlatform;
  label: string;
  url: string;
};

export type EventMediaWorkerScheduleInput = {
  eventStartAt: number;
  scheduledStartAt?: number;
  readyDeadlineAt?: number;
};

export type EventMediaWorkerSchedule = {
  scheduledStartAt: number;
  readyDeadlineAt: number;
};

export type EventMediaWorkerArtifactLinkInput = {
  type?: EventMediaWorkerArtifactType;
  label?: string;
  url: string;
};

export type EventMediaWorkerArtifactLink = {
  type: EventMediaWorkerArtifactType;
  label: string;
  url: string;
};

export type EventMediaOutputCredentialRef = {
  storage: EventMediaSecretStorage;
  secretRef: string;
};

export type EventMediaVrcdnSetup = {
  ingestRegion?: EventMediaVrcdnRegion;
  targetVideoBitrateKbps?: number;
  keyframeIntervalSeconds?: 1 | 2;
  audioSampleRateHz?: 48000;
  targetAudioBitrateKbps?: number;
};

export type EventMediaOutputCompliance = {
  sourceConsent: EventMediaComplianceGateState;
  destinationAuthority: EventMediaComplianceGateState;
  providerRules: EventMediaComplianceGateState;
  rightsClearedMedia: EventMediaComplianceGateState;
};

export type VrcdnOperatorOwnedOutputSetupInput = {
  key: string;
  label: string;
  credentialRef?: string;
  ingestRegion?: EventMediaVrcdnRegion;
  playbackLinks?: EventMediaPublicLinkInput[];
  targetVideoBitrateKbps?: number;
  keyframeIntervalSeconds?: 1 | 2;
  audioSampleRateHz?: 48000;
  targetAudioBitrateKbps?: number;
  sourceConsentAccepted?: boolean;
  destinationAuthorityAccepted?: boolean;
  providerRulesAccepted?: boolean;
  rightsClearedMediaAccepted?: boolean;
};

export type SanitizedVrcdnOperatorOwnedOutputSetup = {
  key: string;
  type: "vrcdn";
  accountModel: "operator_owned";
  state: "draft" | "ready";
  label: string;
  credential?: EventMediaOutputCredentialRef;
  vrcdnSetup: EventMediaVrcdnSetup;
  compliance: EventMediaOutputCompliance;
  playbackLinks: EventMediaPublicLink[];
};

export type EventMediaCommandInput = {
  type: EventMediaCommandType;
  targetSourceKey?: string;
  targetOutputKey?: string;
  publicFallbackLinks?: EventMediaPublicLinkInput[];
  note?: string;
};

export type SanitizedEventMediaCommand = {
  type: EventMediaCommandType;
  targetSourceKey?: string;
  targetOutputKey?: string;
  publicFallbackLinks: EventMediaPublicLink[];
  note?: string;
};

export type EventMediaPrivateProgramState = {
  status: EventMediaProgramState;
  currentSourceLabel?: string;
  currentOutputLabel?: string;
  publicLinks?: EventMediaPublicLinkInput[];
  directFallbackLinks?: EventMediaPublicLinkInput[];
  activeWorkerId?: string;
  workerLeaseExpiresAt?: number;
  commandQueueDepth?: number;
  credentialRefs?: string[];
  privateNotes?: string;
};

export type EventMediaPublicProgramState = {
  status: EventMediaProgramState;
  currentSourceLabel?: string;
  currentOutputLabel?: string;
  publicLinks: EventMediaPublicLink[];
  directFallbackLinks: EventMediaPublicLink[];
};

export const eventMediaProgramStateValidator = v.union(
  v.literal("draft"),
  v.literal("ready"),
  v.literal("starting"),
  v.literal("live"),
  v.literal("hold"),
  v.literal("fallback"),
  v.literal("stopping"),
  v.literal("ended"),
  v.literal("error"),
  v.literal("disabled"),
);

export const eventMediaSourceTypeValidator = v.union(
  v.literal("performer_stream"),
  v.literal("vj_stream"),
  v.literal("event_camera"),
  v.literal("vrcdn_link"),
  v.literal("twitch_watch"),
  v.literal("hls_url"),
  v.literal("rtmp_source"),
  v.literal("uploaded_file"),
  v.literal("static_image"),
  v.literal("audio_loop"),
  v.literal("manual_link"),
  v.literal("other"),
);

export const eventMediaSourcePurposeValidator = v.union(
  v.literal("program"),
  v.literal("visual_restream"),
  v.literal("camera"),
  v.literal("hold_visual"),
  v.literal("hold_audio"),
  v.literal("fallback"),
  v.literal("watch"),
);

export const eventMediaSourceStateValidator = v.union(
  v.literal("draft"),
  v.literal("ready"),
  v.literal("live"),
  v.literal("offline"),
  v.literal("failed"),
  v.literal("disabled"),
);

export const eventMediaSceneTypeValidator = v.union(
  v.literal("source"),
  v.literal("hold_slate"),
  v.literal("intro"),
  v.literal("outro"),
  v.literal("offline_card"),
  v.literal("countdown"),
);

export const eventMediaOutputTypeValidator = v.union(
  v.literal("vrcdn"),
  v.literal("external_rtmp"),
  v.literal("aws_hls"),
  v.literal("ivs"),
  v.literal("manual"),
);

export const eventMediaOutputAccountModelValidator = v.literal("operator_owned");

export const eventMediaOutputStateValidator = v.union(
  v.literal("draft"),
  v.literal("ready"),
  v.literal("active"),
  v.literal("disabled"),
  v.literal("failed"),
);

export const eventMediaSecretStorageValidator = v.literal("operator_secret_store");

export const eventMediaVrcdnRegionValidator = v.union(
  v.literal("europe"),
  v.literal("north_america"),
  v.literal("south_america"),
  v.literal("asia"),
  v.literal("oceania"),
);

export const eventMediaComplianceGateStateValidator = v.union(
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("blocked"),
);

export const eventMediaCommandTypeValidator = v.union(
  v.literal("start_program"),
  v.literal("stop_program"),
  v.literal("switch_source"),
  v.literal("switch_hold"),
  v.literal("next_slot"),
  v.literal("previous_slot"),
  v.literal("force_direct_link_fallback"),
  v.literal("mark_source_live"),
  v.literal("mark_source_offline"),
  v.literal("publish_current_public_watch_link"),
);

export const eventMediaCommandStatusValidator = v.union(
  v.literal("queued"),
  v.literal("claimed"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("cancelled"),
);

export const eventMediaActorSurfaceValidator = v.union(
  v.literal("web"),
  v.literal("discord"),
  v.literal("worker"),
  v.literal("system"),
);

export const eventMediaSessionStatusValidator = v.union(
  v.literal("scheduled"),
  v.literal("starting"),
  v.literal("live"),
  v.literal("hold"),
  v.literal("fallback"),
  v.literal("stopping"),
  v.literal("ended"),
  v.literal("error"),
);

export const eventMediaPlaybackPlatformValidator = v.union(
  v.literal("browser"),
  v.literal("pc"),
  v.literal("standalone"),
);

export const eventMediaWorkerProviderValidator = v.literal("aws_ecs");

export const eventMediaWorkerTaskStatusValidator = v.union(
  v.literal("queued"),
  v.literal("starting"),
  v.literal("running"),
  v.literal("stopping"),
  v.literal("stopped"),
  v.literal("failed"),
);

export const eventMediaWorkerArtifactTypeValidator = v.union(
  v.literal("report"),
  v.literal("artifact"),
  v.literal("logs"),
  v.literal("other"),
);

export const eventMediaPublicLinkValidator = v.object({
  platform: eventMediaPlaybackPlatformValidator,
  label: v.string(),
  url: v.string(),
});

export const eventMediaWorkerArtifactLinkValidator = v.object({
  type: eventMediaWorkerArtifactTypeValidator,
  label: v.string(),
  url: v.string(),
});

function optionalBoundedText(input: string | undefined, fieldName: string, maxLength: number): string | undefined {
  if (input === undefined) {
    return undefined;
  }

  const value = normalizeProfileInlineText(input);

  if (value.length === 0) {
    return undefined;
  }

  if (value.length > maxLength) {
    throw new Error(`${fieldName} must be ${maxLength} characters or fewer.`);
  }

  return value;
}

function sanitizeControlKey(input: string | undefined, fieldName: string): string | undefined {
  const value = optionalBoundedText(input, fieldName, 64);

  if (value === undefined) {
    return undefined;
  }

  const key = value.toLowerCase();

  if (!CONTROL_KEY_PATTERN.test(key)) {
    throw new Error(`${fieldName} must use lowercase letters, numbers, underscores, or hyphens.`);
  }

  return key;
}

function sanitizeSecretRef(input: string | undefined): string | undefined {
  const value = optionalBoundedText(input, "Credential secret reference", 192);

  if (value === undefined) {
    return undefined;
  }

  if (!SECRET_REF_PATTERN.test(value) || value.includes("://")) {
    throw new Error("Credential secret reference must be a scoped reference name, not a secret value or URL.");
  }

  return value;
}

function optionalIntegerInRange(
  input: number | undefined,
  fieldName: string,
  min: number,
  max: number,
): number | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (!Number.isInteger(input) || input < min || input > max) {
    throw new Error(`${fieldName} must be an integer between ${min} and ${max}.`);
  }

  return input;
}

function requiredTimestamp(input: number, fieldName: string): number {
  if (!Number.isInteger(input) || input <= 0) {
    throw new Error(`${fieldName} must be a positive millisecond timestamp.`);
  }

  return input;
}

function complianceGateState(accepted: boolean | undefined): EventMediaComplianceGateState {
  if (accepted === true) {
    return "accepted";
  }

  return accepted === false ? "blocked" : "pending";
}

function assertNoSecretValueFields(input: Record<string, unknown>) {
  for (const field of Object.keys(input)) {
    if (FORBIDDEN_SECRET_INPUT_FIELDS.has(field)) {
      throw new Error(`${field} must not be stored in event media output setup records.`);
    }
  }
}

function fallbackLabel(platform: EventMediaPlaybackPlatform): string {
  switch (platform) {
    case "browser":
      return "Browser watch link";
    case "pc":
      return "PC stream link";
    case "standalone":
      return "Standalone stream link";
  }
}

function artifactFallbackLabel(type: EventMediaWorkerArtifactType): string {
  switch (type) {
    case "report":
      return "Worker report";
    case "artifact":
      return "Worker artifact";
    case "logs":
      return "Worker logs";
    case "other":
      return "Worker link";
  }
}

function safeWorkerArtifactUrl(input: string): string | undefined {
  if (S3_URI_PATTERN.test(input)) {
    return input;
  }

  const url = safeHttpsUrl(input);

  if (url === undefined) {
    return undefined;
  }

  const parsed = new URL(url);

  if (parsed.username || parsed.password || parsed.search !== "") {
    return undefined;
  }

  return parsed.href;
}

export function sanitizeEventMediaPublicLink(input: EventMediaPublicLinkInput): EventMediaPublicLink {
  const label = optionalBoundedText(input.label, "Media link label", LINK_LABEL_MAX_LENGTH) ?? fallbackLabel(input.platform);
  const vrcdnLinks = parseVrcdnStreamLinks(input.url);

  if (vrcdnLinks !== null) {
    const url =
      input.platform === "pc"
        ? vrcdnLinks.pcUrl
        : input.platform === "standalone"
          ? vrcdnLinks.questUrl
          : vrcdnLinks.directVideoUrl ?? vrcdnLinks.pageUrl;

    return { platform: input.platform, label, url };
  }

  const url = safeHttpsUrl(input.url);

  if (url === undefined) {
    throw new Error("Media control public links must use HTTPS or a recognized VRCDN stream URL.");
  }

  return { platform: input.platform, label, url };
}

export function sanitizeEventMediaPublicLinks(input: EventMediaPublicLinkInput[] | undefined): EventMediaPublicLink[] {
  const links: EventMediaPublicLink[] = [];
  const seen = new Set<string>();

  for (const link of input ?? []) {
    const sanitized = sanitizeEventMediaPublicLink(link);
    const key = `${sanitized.platform}:${sanitized.url.toLowerCase()}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    links.push(sanitized);
  }

  return links;
}

export function sanitizeEventMediaWorkerSchedule(input: EventMediaWorkerScheduleInput): EventMediaWorkerSchedule {
  const eventStartAt = requiredTimestamp(input.eventStartAt, "Event start time");
  const scheduledStartAt = requiredTimestamp(
    input.scheduledStartAt ?? eventStartAt - EVENT_MEDIA_WORKER_START_LEAD_MS,
    "Worker scheduled start time",
  );
  const readyDeadlineAt = requiredTimestamp(
    input.readyDeadlineAt ?? eventStartAt - EVENT_MEDIA_WORKER_READY_LEAD_MS,
    "Worker ready deadline",
  );

  if (scheduledStartAt >= eventStartAt) {
    throw new Error("Worker scheduled start time must be before the event starts.");
  }

  if (readyDeadlineAt >= eventStartAt) {
    throw new Error("Worker ready deadline must be before the event starts.");
  }

  if (readyDeadlineAt < scheduledStartAt) {
    throw new Error("Worker ready deadline must be at or after the scheduled start time.");
  }

  return { scheduledStartAt, readyDeadlineAt };
}

export function sanitizeEventMediaWorkerArtifactLinks(
  input: EventMediaWorkerArtifactLinkInput[] | undefined,
): EventMediaWorkerArtifactLink[] {
  const links: EventMediaWorkerArtifactLink[] = [];
  const seen = new Set<string>();

  for (const link of input ?? []) {
    const type = link.type ?? "artifact";
    const label = optionalBoundedText(link.label, "Worker artifact label", LINK_LABEL_MAX_LENGTH) ?? artifactFallbackLabel(type);
    const url = safeWorkerArtifactUrl(link.url);

    if (url === undefined) {
      throw new Error("Worker artifact links must be private S3 URIs or HTTPS URLs without embedded credentials or query strings.");
    }

    const key = `${type}:${url.toLowerCase()}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    links.push({ type, label, url });
  }

  return links;
}

export function sanitizeEventMediaCommandInput(input: EventMediaCommandInput): SanitizedEventMediaCommand {
  const targetSourceKey = sanitizeControlKey(input.targetSourceKey, "Target source key");
  const targetOutputKey = sanitizeControlKey(input.targetOutputKey, "Target output key");
  const publicFallbackLinks = sanitizeEventMediaPublicLinks(input.publicFallbackLinks);
  const note = optionalBoundedText(input.note, "Media command note", CONTROL_NOTE_MAX_LENGTH);

  if (["switch_source", "mark_source_live", "mark_source_offline"].includes(input.type) && targetSourceKey === undefined) {
    throw new Error(`${input.type} requires a target source key.`);
  }

  if (input.type === "force_direct_link_fallback" && publicFallbackLinks.length === 0) {
    throw new Error("Direct-link fallback requires at least one public fallback link.");
  }

  return {
    type: input.type,
    ...(targetSourceKey === undefined ? {} : { targetSourceKey }),
    ...(targetOutputKey === undefined ? {} : { targetOutputKey }),
    publicFallbackLinks,
    ...(note === undefined ? {} : { note }),
  };
}

export function sanitizeVrcdnOperatorOwnedOutputSetup(
  input: VrcdnOperatorOwnedOutputSetupInput,
): SanitizedVrcdnOperatorOwnedOutputSetup {
  assertNoSecretValueFields(input as Record<string, unknown>);

  const key = sanitizeControlKey(input.key, "Output key");
  const label = optionalBoundedText(input.label, "Output label", LINK_LABEL_MAX_LENGTH);
  const secretRef = sanitizeSecretRef(input.credentialRef);
  const playbackLinks = sanitizeEventMediaPublicLinks(input.playbackLinks);
  const vrcdnSetup: EventMediaVrcdnSetup = {
    ...(input.ingestRegion === undefined ? {} : { ingestRegion: input.ingestRegion }),
    ...optionalNumberField(
      "targetVideoBitrateKbps",
      optionalIntegerInRange(input.targetVideoBitrateKbps, "Target video bitrate", 500, 6000),
    ),
    ...(input.keyframeIntervalSeconds === undefined ? {} : { keyframeIntervalSeconds: input.keyframeIntervalSeconds }),
    ...(input.audioSampleRateHz === undefined ? {} : { audioSampleRateHz: input.audioSampleRateHz }),
    ...optionalNumberField(
      "targetAudioBitrateKbps",
      optionalIntegerInRange(input.targetAudioBitrateKbps, "Target audio bitrate", 64, 320),
    ),
  };
  const compliance: EventMediaOutputCompliance = {
    sourceConsent: complianceGateState(input.sourceConsentAccepted),
    destinationAuthority: complianceGateState(input.destinationAuthorityAccepted),
    providerRules: complianceGateState(input.providerRulesAccepted),
    rightsClearedMedia: complianceGateState(input.rightsClearedMediaAccepted),
  };
  const hasAcceptedCompliance = Object.values(compliance).every((state) => state === "accepted");

  if (key === undefined) {
    throw new Error("Output key is required.");
  }

  if (label === undefined) {
    throw new Error("Output label is required.");
  }

  return {
    key,
    type: "vrcdn",
    accountModel: "operator_owned",
    state: secretRef !== undefined && hasAcceptedCompliance ? "ready" : "draft",
    label,
    ...(secretRef === undefined ? {} : { credential: { storage: "operator_secret_store", secretRef } }),
    vrcdnSetup,
    compliance,
    playbackLinks,
  };
}

function optionalNumberField<Key extends string>(key: Key, value: number | undefined): { [K in Key]?: number } {
  return value === undefined ? {} : ({ [key]: value } as { [K in Key]: number });
}

export function toPublicEventMediaProgramState(
  state: EventMediaPrivateProgramState,
): EventMediaPublicProgramState {
  return {
    status: state.status,
    ...(state.currentSourceLabel === undefined ? {} : { currentSourceLabel: state.currentSourceLabel }),
    ...(state.currentOutputLabel === undefined ? {} : { currentOutputLabel: state.currentOutputLabel }),
    publicLinks: sanitizeEventMediaPublicLinks(state.publicLinks),
    directFallbackLinks: sanitizeEventMediaPublicLinks(state.directFallbackLinks),
  };
}
