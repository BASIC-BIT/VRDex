import { decideHandoff } from "./handoff-policy.mjs";
export function initialAutomaticSlot(slots, now) {
  const active = slots.filter(
    (slot, i) =>
      slot.startAt <= now &&
      (slot.endAt ?? slots[i + 1]?.startAt ?? Infinity) > now,
  );
  if (active.length === 1 && active[0].available) return active[0];
  return slots.find((slot) => slot.available && slot.startAt > now);
}
/** Synchronous control reducer. advance receives {epoch,sessionId,scheduleNow,
 * commands,state,onFence}; state is one coherent encoded/publishing snapshot.
 * RPCs have operation-local ownership and never delay applyConfiguration or tick.
 */
export function createOperatorControl({
  control,
  renderer,
  inputs,
  clock = () => performance.now(),
}) {
  let config,
    context = {},
    silenceThresholdDb,
    configured = false,
    selectedIdentity,
    intent = { kind: "automatic" },
    intentSequence = -1,
    current,
    pending,
    epoch,
    generation = 0,
    stopped = false;
  const completed = new Map(),
    lifecycle = new Map();
  const mode = () =>
    intent.kind === "slate"
      ? "hold"
      : intent.kind === "manual"
        ? "manual"
        : "automatic";
  const targetIntent = (target) =>
    target.mode === "automatic"
      ? { kind: "automatic" }
      : target.kind === "slate"
        ? { kind: "slate" }
        : {
            kind: "manual",
            sourceId: target.source.sourceId,
            revision: target.source.revision,
          };
  function slot(target) {
    if (!target) return;
    const source = config.sources.find(
      (s) => s.id === target.sourceId && s.revision === target.revision,
    );
    if (!source) return;
    const authored = config.slots.find(
      (s) => s.slotKey === target.slotKey && s.sourceId === target.sourceId,
    );
    if (authored && !authored.available) return;
    if (!authored && !target.slotKey.startsWith("manual-")) return;
    return {
      ...authored,
      ...target,
      startAt: authored?.startAt ?? context.scheduleNow,
      available: true,
    };
  }
  function manualSlot() {
    const source = config.sources.find(
      (s) => s.id === intent.sourceId && s.revision === intent.revision,
    );
    return source
      ? slot({
          sourceId: source.id,
          revision: source.revision,
          slotKey: source.eventSlotId ?? `manual-${source.id}`,
        })
      : undefined;
  }
  const evidence = (target) => {
    if (!target) return;
    const input = renderer
      .getInputs()
      .find(
        (input) =>
          input.source.slotKey === target.slotKey &&
          input.source.sourceId === target.sourceId &&
          input.source.revision === target.revision,
      );
    return input?.getObservation ? input.getObservation() : input;
  };
  const ready = (target) => {
    const e = evidence(target);
    return e?.ready && e.observedAt <= clock() && clock() - e.observedAt < 1000;
  };
  function reconcile(candidate) {
    const desired = (target) => {
      if (!target?.available) return;
      const source = config.sources.find(
        (s) => s.id === target.sourceId && s.revision === target.revision,
      );
      return source
        ? {
            slotKey: target.slotKey,
            source,
            sessionExpiresAt: config.sessionDeadline,
            ...(pending &&
            target.sourceId === pending.command.controlTarget.source?.sourceId
              ? {
                  preparationExpiresAt:
                    Date.now() + Math.max(0, pending.deadline - clock()),
                }
              : {}),
          }
        : undefined;
    };
    inputs.reconcile({
      current: desired(current),
      candidate: desired(candidate),
      intentSequence,
      epoch,
    });
    const accepted = renderer.reconcileSources(inputs.readySources());
    accepted?.catch?.(() => {
      if (!stopped) context.onFence?.("renderer-reconcile-failed");
    });
  }
  function hold() {
    selectedIdentity = undefined;
    renderer.hold();
  }
  function select(target) {
    const key = JSON.stringify([
      target.slotKey,
      target.sourceId,
      target.revision,
      renderer
        .getInputs()
        .find(
          (input) =>
            input.source.slotKey === target.slotKey &&
            input.source.sourceId === target.sourceId &&
            input.source.revision === target.revision,
        )?.source.url,
    ]);
    if (selectedIdentity === key) return true;
    if (renderer.selectSource(target.slotKey)) {
      selectedIdentity = key;
      return true;
    }
    return false;
  }
  function remember(id, receipt) {
    completed.set(id, receipt);
    if (completed.size > 64) completed.delete(completed.keys().next().value);
  }
  function abandon() {
    generation++;
    pending = undefined;
  }
  function commit(next, sequence, target) {
    if (sequence < intentSequence) return;
    intent = next;
    intentSequence = sequence;
    current = next.kind === "manual" ? manualSlot() : target;
    if (next.kind === "slate" || !current) hold();
  }
  function owns(op) {
    return (
      !stopped &&
      pending === op &&
      op.generation === generation &&
      op.epoch === epoch &&
      op.intentSequence === intentSequence
    );
  }
  function fenced(result) {
    if (result.kind === "fenced") {
      context.onFence?.("control-fenced");
      return true;
    }
    return false;
  }
  function rpc(op, name, args, done) {
    if (op.inflight) return;
    op.inflight = true;
    Promise.resolve()
      .then(() => control(name, { ...args, epoch: op.epoch }))
      .then(
        (result) => {
          if (!stopped && op.epoch === epoch && fenced(result)) return;
          if (!owns(op)) return;
          op.inflight = false;
          if (result.kind !== "ok") {
            remember(op.command._id, { settled: true });
            abandon();
            reconcile();
            return;
          }
          done(result);
        },
        () => {
          if (owns(op)) {
            op.inflight = false;
            op.retryAt = clock() + 1000;
          }
        },
      );
  }
  function begin(command) {
    if (completed.has(command._id) || pending?.command._id === command._id)
      return;
    if (
      command.sequence < intentSequence ||
      (pending && command.sequence < pending.command.sequence)
    )
      return;
    abandon();
    const received = clock();
    pending = {
      command,
      generation,
      epoch,
      intentSequence,
      deadline: received + 15000,
      begun: false,
      promoted: command.controlPhase === "promoting",
    };
    if (Number.isFinite(command.preparationExpiresAt))
      pending.deadline = Math.min(
        pending.deadline,
        received +
          Math.max(0, command.preparationExpiresAt - context.scheduleNow),
      );
    if (
      command.controlTarget.kind === "slate" &&
      command.controlTarget.mode === "slate"
    ) {
      commit({ kind: "slate" }, command.sequence);
      pending.intentSequence = intentSequence;
      hold();
      reconcile();
    }
  }
  function settle(op, args) {
    op.ack ??= Object.freeze({
      ...args,
      commandId: op.command._id,
      sequence: op.command.sequence,
    });
    rpc(op, "acknowledgeCommand", op.ack, () => {
      remember(op.command._id, { ack: op.ack });
      if (completed.size > 64) completed.delete(completed.keys().next().value);
      abandon();
      reconcile();
    });
  }
  function advanceOperation(state) {
    const op = pending;
    if (!op) return;
    const target = op.command.controlTarget;
    const desired = target.kind === "source" ? slot(target.source) : undefined;
    if (op.promoted) {
      commit(targetIntent(target), op.command.sequence, desired);
      op.intentSequence = intentSequence;
    }
    reconcile(op.promoted ? undefined : desired);
    if (op.inflight || clock() < (op.retryAt ?? 0)) return;
    if (clock() >= op.deadline || (target.kind === "source" && !desired)) {
      settle(op, {
        outcome: "failed",
        failureReason:
          clock() >= op.deadline ? "expired" : "source_unavailable",
      });
      return;
    }
    if (!op.begun) {
      const sent = clock(),
        serverAtSend = context.scheduleNow;
      rpc(
        op,
        "beginPreparation",
        { commandId: op.command._id, sequence: op.command.sequence },
        (result) => {
          op.begun = true;
          op.deadline = Math.min(
            op.deadline,
            sent + Math.max(0, result.preparationExpiresAt - serverAtSend),
          );
          advanceOperation(context.state);
        },
      );
      return;
    }
    if (!op.promoted) {
      if (desired && !ready(desired)) return;
      rpc(
        op,
        "promoteOperation",
        { commandId: op.command._id, sequence: op.command.sequence, target },
        (result) => {
          op.promoted = true;
          commit(targetIntent(target), result.intentSequence, desired);
          op.intentSequence = intentSequence;
          if (clock() < op.deadline && desired && ready(desired))
            select(desired);
          else hold();
        },
      );
      return;
    }
    if (desired && ready(desired)) select(desired);
    else hold();
    const encoded = desired
      ? state.renderedSourceId === desired.sourceId &&
        state.renderedSourceRevision === desired.revision &&
        state.renderedSlotKey === desired.slotKey
      : !state.renderedSourceId && !state.renderedSlotKey;
    if (state.publishing && encoded)
      settle(op, {
        outcome: "succeeded",
        intentSequence,
        outputMs: state.outputMs,
        observedState: desired ? "live" : "hold",
        observedSourceId: state.renderedSourceId ?? null,
        sourceRevision: state.renderedSourceRevision,
        slotKey: state.renderedSlotKey,
        observedOutputId: config.outputId,
      });
  }
  function automatic() {
    if (intent.kind === "manual") current = manualSlot();
    else if (intent.kind === "slate") current = undefined;
    else if (current) {
      const authored = config.slots.find(
        (s) => s.slotKey === current.slotKey && s.sourceId === current.sourceId,
      );
      const source = config.sources.find((s) => s.id === current.sourceId);
      current = {
        ...current,
        ...authored,
        revision: source?.revision,
        available: !!source && !!authored?.available,
      };
    }
    const index = config.slots.findIndex(
      (s) => s.slotKey === current?.slotKey && s.sourceId === current?.sourceId,
    );
    const nextRaw =
      index >= 0
        ? config.slots.slice(index + 1).find((s) => s.available)
        : initialAutomaticSlot(config.slots, context.scheduleNow);
    const next = nextRaw
      ? {
          ...nextRaw,
          revision: config.sources.find((s) => s.id === nextRaw.sourceId)
            ?.revision,
        }
      : undefined;
    const policyCurrent =
      current && index < 0 ? { ...current, endAt: undefined } : current;
    const currentEvidence = evidence(current),
      nextEvidence = evidence(next);
    const decision = decideHandoff({
      scheduleNow: context.scheduleNow,
      observationNow: clock(),
      sessionDeadline: config.sessionDeadline,
      mode: mode(),
      current: policyCurrent,
      next,
      evidence: currentEvidence,
      nextReadiness: nextEvidence,
      policy: {
        ...config.policy,
        ...(config.policy.silence?.thresholdDb !== silenceThresholdDb
          ? { silence: undefined }
          : {}),
      },
    });
    if (decision.kind === "stop") {
      context.onFence?.("session-deadline");
      return;
    }
    if (decision.kind === "hold") hold();
    const prepare =
      decision.kind === "prepare" ||
      decision.kind === "switch" ||
      decision.prepare ||
      (mode() === "automatic" &&
        next &&
        context.scheduleNow >=
          Math.max(next.startAt, policyCurrent?.endAt ?? next.startAt) -
            120000);
    reconcile(prepare ? next : undefined);
    if (decision.kind === "switch" && ready(next) && select(next))
      current = next;
    if (
      (decision.kind === "stay" || decision.kind === "prepare") &&
      current?.available &&
      ready(current)
    )
      select(current);
  }
  function lifecycleReceipt(command, state) {
    if (lifecycle.has(command._id) || completed.has(command._id)) return;
    if (command.commandType === "start_program" && !state.publishing) return;
    const capturedEpoch = epoch;
    const ack = {
      commandId: command._id,
      sequence: command.sequence,
      outcome: "succeeded",
      intentSequence,
      outputMs: state.outputMs,
      sourceRevision: state.renderedSourceRevision,
      slotKey: state.renderedSlotKey,
      observedState: state.renderedSourceId ? "live" : "hold",
      observedSourceId: state.renderedSourceId ?? null,
      observedOutputId: config.outputId,
    };
    lifecycle.set(command._id, ack);
    Promise.resolve()
      .then(() =>
        control("acknowledgeCommand", { ...ack, epoch: capturedEpoch }),
      )
      .then(
        (result) => {
          lifecycle.delete(command._id);
          if (stopped || capturedEpoch !== epoch) return;
          if (result.kind === "fenced" || (!result.kind && !result.accepted)) {
            context.onFence?.("command-fenced");
            return;
          }
          remember(command._id, { ack });
          if (completed.size > 64)
            completed.delete(completed.keys().next().value);
        },
        () => {
          lifecycle.delete(command._id);
        },
      );
  }
  return {
    applyConfiguration(configuration) {
      if (stopped) return;
      if (configuration.epoch !== undefined && configuration.epoch !== epoch) {
        if (epoch !== undefined) hold();
        epoch = configuration.epoch;
        abandon();
        completed.clear();
        lifecycle.clear();
        intentSequence = -1;
        current = undefined;
      }
      if (configuration.intentSequence < intentSequence) return;
      if (!configured) {
        silenceThresholdDb = configuration.policy.silence?.thresholdDb;
        configured = true;
      }
      config = configuration;
      if (config.stopped) {
        context.onFence?.("event-stopped");
        return;
      }
      if (config.intentSequence > intentSequence) {
        const samePromotion =
          pending &&
          config.pendingOperation?._id === pending.command._id &&
          config.pendingOperation.controlPhase === "promoting" &&
          pending.command.sequence === config.intentSequence;
        if (samePromotion) {
          commit(
            config.committedIntent,
            config.intentSequence,
            pending.command.controlTarget.kind === "source"
              ? slot(pending.command.controlTarget.source)
              : undefined,
          );
          pending.promoted = true;
          pending.intentSequence = intentSequence;
        } else {
          if (pending) remember(pending.command._id, { settled: true });
          abandon();
          commit(config.committedIntent, config.intentSequence);
        }
      }
      if (pending && config.pendingOperation?._id !== pending.command._id) {
        remember(pending.command._id, { settled: true });
        abandon();
      }
      if (intent.kind === "manual") {
        current = manualSlot();
        if (!current) hold();
      }
      if (pending || intent.kind === "manual")
        reconcile(
          !pending?.promoted && pending?.command.controlTarget.kind === "source"
            ? slot(pending.command.controlTarget.source)
            : undefined,
        );
      if (intent.kind === "slate") {
        hold();
        if (!pending) reconcile();
      }
    },
    advance(observation) {
      if (stopped || !config) return;
      context = observation;
      epoch ??= observation.epoch;
      const claims = observation.commands ?? [];
      if (claims.some((c) => c.commandType === "stop_program")) {
        context.onStop?.(claims.find((c) => c.commandType === "stop_program"));
        return;
      }
      const cut = claims.find(
        (c) =>
          c.controlTarget?.kind === "slate" && c.controlTarget.mode === "slate",
      );
      if (cut) begin(cut);
      for (const command of claims) {
        if (command.controlTarget) {
          if (!cut) begin(command);
        } else if (!cut && !pending)
          lifecycleReceipt(command, observation.state);
      }
      if (pending) advanceOperation(observation.state);
      else automatic();
    },
    getState: () => ({
      committedIntent: intent,
      intentSequence,
      current,
      mode: mode(),
      pending: pending
        ? {
            command: pending.command,
            deadline: pending.deadline,
            phase: pending.promoted ? "promoting" : "preparing",
          }
        : undefined,
    }),
    stop() {
      if (stopped) return;
      stopped = true;
      abandon();
      hold();
      inputs.reconcile({ epoch, intentSequence });
      void inputs.stop().catch(() => {});
    },
  };
}
