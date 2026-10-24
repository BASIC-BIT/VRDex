import { createEventWorker } from "../workers/restream/event-worker.mjs";
import { createInputManager } from "../workers/restream/input-manager.mjs";
import { initialAutomaticSlot } from "../workers/restream/operator-control.mjs";
/** Test transport, with the same immediate-handle lifecycle as production. */
export function syntheticInputs(resolve = (source) => source.publicUrl, relay) {
  const create = ({ source }) =>
    relay
      ? relay.createInput({ source: { ...source, type: "vrcdn_link" } })
      : {
          transportReady: Promise.resolve()
            .then(() => resolve(source))
            .then((url) => ({ url })),
          dispose: async () => {},
        };
  return createInputManager({
    createVrcdnInput: create,
    createTwitchInput: create,
  });
}
/** In-memory v2 authority for local media proofs. Real v2 backend responses pass
 * through unchanged. Fixture commands are pinned once, Begin preserves expiry,
 * promotion commits before encoded acknowledgement, and Cut supersedes eagerly.
 */
export function createProofControl(base) {
  let configuration,
    serverNow = 0,
    intent,
    intentSequence = 0,
    pending,
    real = false,
    observed;
  const commands = new Map(),
    versions = new Map();
  function project(value) {
    const sources = value.sources.map((s) => {
      const prior = versions.get(s.id),
        revision =
          s.revision ??
          (prior && prior.url !== s.publicUrl
            ? prior.revision + 1
            : (prior?.revision ?? 1));
      versions.set(s.id, { url: s.publicUrl, revision });
      return {
        ...s,
        revision,
        eventSlotId: value.slots.find((slot) => slot.sourceId === s.id)
          ?.slotKey,
      };
    });
    if (!intent) intentSequence = value.intentSequence ?? 0;
    intent ??=
      value.committedIntent ??
      (value.mode === "manual" && value.currentSourceId
        ? {
            kind: "manual",
            sourceId: value.currentSourceId,
            revision:
              sources.find((s) => s.id === value.currentSourceId)?.revision ??
              1,
          }
        : value.mode === "hold"
          ? { kind: "slate" }
          : { kind: "automatic" });
    configuration = {
      ...value,
      sources,
      controlProtocolVersion: 2,
      mediaSettings: value.mediaSettings ?? {
        videoPreset: "720p30",
        audioBitrateKbps: 160,
      },
      committedIntent: intent,
      intentSequence,
      pendingOperation: pending,
    };
    return structuredClone(configuration);
  }
  function pin(command) {
    if (commands.has(command._id)) return commands.get(command._id);
    const type =
      command.commandType === "switch_hold"
        ? "cut_to_slate"
        : command.commandType;
    if (
      ["start_program", "stop_program"].includes(type) ||
      ![
        "switch_source",
        "take_source",
        "hold_current",
        "cut_to_slate",
        "set_automatic_mode",
        "next_slot",
        "switch_next",
        "previous_slot",
        "switch_previous",
      ].includes(type)
    )
      return command;
    let chosen;
    if (type === "hold_current")
      chosen = configuration.sources.find(
        (s) => s.id === observed?.sourceId || s.id === intent.sourceId,
      );
    else if (type === "switch_source" || type === "take_source")
      chosen = configuration.sources.find(
        (s) => s.id === command.targetSourceId,
      );
    else if (type === "set_automatic_mode") {
      const slot = initialAutomaticSlot(configuration.slots, serverNow);
      if (slot?.startAt <= serverNow)
        chosen = configuration.sources.find((s) => s.id === slot.sourceId);
    } else if (type !== "cut_to_slate") {
      const index = configuration.slots.findIndex(
        (s) => s.sourceId === (observed?.sourceId ?? intent.sourceId),
      );
      const next = type.includes("previous")
        ? configuration.slots[index - 1]
        : index >= 0
          ? configuration.slots[index + 1]
          : initialAutomaticSlot(configuration.slots, serverNow);
      if (next?.available)
        chosen = configuration.sources.find((s) => s.id === next.sourceId);
    }
    const target = chosen
      ? {
          kind: "source",
          mode: type === "set_automatic_mode" ? "automatic" : "manual",
          source: {
            sourceId: chosen.id,
            revision: chosen.revision,
            slotKey: chosen.eventSlotId ?? `manual-${chosen.id}`,
          },
        }
      : {
          kind: "slate",
          mode: type === "set_automatic_mode" ? "automatic" : "slate",
        };
    const operation = {
      ...command,
      commandType: type,
      controlTarget: target,
      controlPhase: type === "cut_to_slate" ? "promoting" : "preparing",
      unavailable:
        !chosen && !["set_automatic_mode", "cut_to_slate"].includes(type),
    };
    commands.set(command._id, operation);
    pending = operation;
    if (type === "cut_to_slate") {
      intent = { kind: "slate" };
      intentSequence = command.sequence;
    }
    return operation;
  }
  return async (name, args, signal) => {
    if (!real && ["beginPreparation", "promoteOperation"].includes(name)) {
      const command = commands.get(args.commandId);
      if (!command || command !== pending) return { kind: "superseded" };
      if (name === "beginPreparation") {
        command.preparationExpiresAt ??= serverNow + 15000;
        return {
          kind: "ok",
          preparationExpiresAt: command.preparationExpiresAt,
        };
      }
      if (command.unavailable) {
        await base("acknowledgeCommand", {
          commandId: command._id,
          sequence: command.sequence,
          outcome: "failed",
          failureReason: "source_unavailable",
        });
        pending = undefined;
        return { kind: "failed", reason: "source_unavailable" };
      }
      if (JSON.stringify(args.target) !== JSON.stringify(command.controlTarget))
        throw Error("Unpinned promotion");
      command.controlPhase = "promoting";
      intentSequence = command.sequence;
      const target = command.controlTarget;
      intent =
        target.mode === "automatic"
          ? { kind: "automatic" }
          : target.kind === "slate"
            ? { kind: "slate" }
            : {
                kind: "manual",
                sourceId: target.source.sourceId,
                revision: target.source.revision,
              };
      return { kind: "ok", intentSequence };
    }
    const result = await base(name, args, signal);
    if (result.configuration) {
      real = result.configuration.controlProtocolVersion === 2;
      if (real) return result;
      serverNow = result.serverNow;
      return { ...result, configuration: project(result.configuration) };
    }
    if (real) return result;
    if (name === "claimCommands")
      return { ...result, commands: result.commands.map(pin) };
    if (name === "observeProgram") {
      observed = args;
      return result.accepted === false ? { kind: "fenced" } : { kind: "ok" };
    }
    if (name === "acknowledgeCommand") {
      if (pending?._id === args.commandId) pending = undefined;
      if (args.observedSourceId) observed = { sourceId: args.observedSourceId };
      return result.accepted === false ? { kind: "fenced" } : { kind: "ok" };
    }
    return result;
  };
}
/** Convenience for proof-only authority; production has no legacy interpreter. */
export function createProofWorker(options) {
  return createEventWorker({
    ...options,
    control: createProofControl(options.control),
  });
}
