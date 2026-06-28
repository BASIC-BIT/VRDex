import type {
  EventMediaCommandInput,
  EventMediaCommandType,
  EventMediaPublicLinkInput,
} from "../../../convex/_eventMediaControl";

const CUSTOM_ID_PREFIX = "vrdex:mc";
const CONTROL_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type DiscordMediaControlAction =
  | "start"
  | "stop"
  | "hold"
  | "next"
  | "previous"
  | "source"
  | "fallback"
  | "publish_watch_link"
  | "refresh";

export type DiscordInteractionKind = "slash" | "button" | "select" | "modal";

export type DiscordAckMode = "defer_ephemeral_reply" | "defer_message_update" | "reply_ephemeral";

export type DiscordPanelRoute = "command" | "status" | "refresh" | "stale_panel" | "confirmation_required" | "unknown";

export type DiscordMediaControlCustomId = {
  action: DiscordMediaControlAction;
  eventId: string;
  panelRevision: number;
};

export type DiscordMediaInteractionInput = {
  kind: DiscordInteractionKind;
  action?: DiscordMediaControlAction;
  customId?: string;
  eventId?: string;
  panelRevision?: number;
  currentPanelRevision?: number;
  targetSourceKey?: string;
  publicFallbackLinks?: EventMediaPublicLinkInput[];
};

export type DiscordMediaInteractionRoute = {
  route: DiscordPanelRoute;
  ack: DiscordAckMode;
  eventId?: string;
  action?: DiscordMediaControlAction;
  command?: EventMediaCommandInput;
  requiresConfirmation: boolean;
  stale: boolean;
  reason?: string;
};

type CommandAction = Exclude<DiscordMediaControlAction, "refresh">;

const ACTION_TO_COMMAND_TYPE = {
  start: "start_program",
  stop: "stop_program",
  hold: "hold_current",
  next: "switch_next",
  previous: "switch_previous",
  source: "switch_source",
  fallback: "publish_fallback_link",
  publish_watch_link: "publish_current_public_watch_link",
} as const satisfies Record<CommandAction, EventMediaCommandType>;

const CONFIRMATION_ACTIONS = new Set<DiscordMediaControlAction>(["stop", "fallback"]);

export function eventMediaCommandTypeForDiscordAction(
  action: DiscordMediaControlAction,
): EventMediaCommandType | undefined {
  if (action === "refresh") {
    return undefined;
  }

  return ACTION_TO_COMMAND_TYPE[action];
}

export function buildMediaControlCustomId(input: DiscordMediaControlCustomId): string {
  const customId = `${CUSTOM_ID_PREFIX}:${input.action}:${input.eventId}:r${input.panelRevision}`;

  if (customId.length > 100) {
    throw new Error("Discord media control custom_id must be 100 characters or fewer.");
  }

  return customId;
}

export function parseMediaControlCustomId(customId: string): DiscordMediaControlCustomId | undefined {
  const parts = customId.split(":");

  if (parts.length !== 5) {
    return undefined;
  }

  const [prefix, namespace, action, eventId, revision] = parts;

  if (prefix !== "vrdex" || namespace !== "mc" || revision?.startsWith("r") !== true) {
    return undefined;
  }

  if (!isDiscordMediaControlAction(action) || !CONTROL_KEY_PATTERN.test(eventId)) {
    return undefined;
  }

  const panelRevision = Number.parseInt(revision.slice(1), 10);

  if (!Number.isSafeInteger(panelRevision) || panelRevision < 0) {
    return undefined;
  }

  return { action, eventId, panelRevision };
}

export function routeMediaInteraction(input: DiscordMediaInteractionInput): DiscordMediaInteractionRoute {
  const customIdRoute = input.customId === undefined ? undefined : parseMediaControlCustomId(input.customId);
  const action = input.action ?? customIdRoute?.action;
  const eventId = input.eventId ?? customIdRoute?.eventId;
  const panelRevision = input.panelRevision ?? customIdRoute?.panelRevision;
  const requiresFreshPanel =
    customIdRoute !== undefined && (input.kind === "button" || input.kind === "select" || input.kind === "modal");

  if (customIdRoute === undefined && input.customId !== undefined) {
    return unknownRoute("Unrecognized VRDex media control route.");
  }

  if (requiresFreshPanel && input.currentPanelRevision === undefined) {
    return {
      route: "stale_panel",
      ack: "reply_ephemeral",
      eventId,
      action,
      requiresConfirmation: false,
      stale: true,
      reason: "The Discord control panel freshness could not be verified. Refresh before sending live media commands.",
    };
  }

  const stale =
    panelRevision !== undefined &&
    input.currentPanelRevision !== undefined &&
    panelRevision !== input.currentPanelRevision;

  if (stale) {
    return {
      route: "stale_panel",
      ack: "reply_ephemeral",
      eventId,
      action,
      requiresConfirmation: false,
      stale: true,
      reason: "The Discord control panel is stale. Refresh before sending live media commands.",
    };
  }

  if (action === undefined) {
    return {
      route: "status",
      ack: input.kind === "button" || input.kind === "select" ? "defer_message_update" : "defer_ephemeral_reply",
      eventId,
      requiresConfirmation: false,
      stale: false,
    };
  }

  if (action === "refresh") {
    return {
      route: "refresh",
      ack: input.kind === "button" || input.kind === "select" ? "defer_message_update" : "defer_ephemeral_reply",
      eventId,
      action,
      requiresConfirmation: false,
      stale: false,
    };
  }

  if (eventId === undefined) {
    return unknownRoute("Discord media commands require an event route.");
  }

  const command = buildEventMediaCommand(action, input);

  if (command === undefined) {
    return unknownRoute(`Discord media action ${action} is missing required command details.`);
  }

  if (CONFIRMATION_ACTIONS.has(action)) {
    return {
      route: "confirmation_required",
      ack: "reply_ephemeral",
      eventId,
      action,
      requiresConfirmation: true,
      stale: false,
      reason: "Confirm this Discord media action before enqueueing a live command.",
    };
  }

  return {
    route: "command",
    ack: input.kind === "button" || input.kind === "select" ? "defer_message_update" : "defer_ephemeral_reply",
    eventId,
    action,
    command,
    requiresConfirmation: false,
    stale: false,
  };
}

function buildEventMediaCommand(
  action: Exclude<DiscordMediaControlAction, "refresh">,
  input: DiscordMediaInteractionInput,
): EventMediaCommandInput | undefined {
  const type = ACTION_TO_COMMAND_TYPE[action];

  if (action === "source") {
    if (input.targetSourceKey === undefined) {
      return undefined;
    }

    return { type, targetSourceKey: input.targetSourceKey };
  }

  if (action === "fallback") {
    if (input.publicFallbackLinks === undefined || input.publicFallbackLinks.length === 0) {
      return undefined;
    }

    return { type, publicFallbackLinks: input.publicFallbackLinks };
  }

  return { type };
}

function isDiscordMediaControlAction(action: string): action is DiscordMediaControlAction {
  return [
    "start",
    "stop",
    "hold",
    "next",
    "previous",
    "source",
    "fallback",
    "publish_watch_link",
    "refresh",
  ].includes(action);
}

function unknownRoute(reason: string): DiscordMediaInteractionRoute {
  return {
    route: "unknown",
    ack: "reply_ephemeral",
    requiresConfirmation: false,
    stale: false,
    reason,
  };
}
