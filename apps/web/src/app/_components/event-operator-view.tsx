"use client";

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useRef, useState } from "react";
import { api } from "@convex-generated-api";
import { eventBroadcastObservationFresh } from "@/lib/event-broadcast-observation";
import { Button } from "@/components/ui/button";
import { PageContainer, PageShell } from "@/components/ui/page-shell";
import { ViewerLocalEventDateTime } from "./viewer-local-event-times";
import { operatorViewState } from "@/lib/event-operator-state";
import {
  EventOperatorSources,
  type SourceAuthoring,
} from "./event-operator-sources";
import { EventOperatorDiagnostics } from "./event-operator-diagnostics";
import {
  EventStreamSettings,
  type StreamSettings,
} from "./event-stream-settings";
import { NEW_PROGRAM_MEDIA_SETTINGS } from "../../../../../workers/restream/broadcast-profiles.mjs";
import type { PublicEvent } from "./event-public-page";

export type OperatorStatus = FunctionReturnType<
  typeof api.events.getEventMediaControlStatus
>;
type Command =
  | "switch_next"
  | "switch_source"
  | "switch_hold"
  | "hold_current"
  | "set_automatic_mode";
export function EventOperatorView({
  currentSlug,
}: {
  currentSlug: string;
  initialStatus: OperatorStatus;
  event?: PublicEvent;
}) {
  const status = useQuery(api.events.getEventMediaControlStatus, {
    currentSlug,
  });
  const queue = useMutation(api.events.queueEventMediaCommand);
  const start = useMutation(api.events.scheduleEventMediaWorker);
  const stop = useMutation(api.events.stopEventMediaWorker);
  const policy = useMutation(api.events.configureEventBroadcastPolicy);
  const configureTwitch = useMutation(api.events.configureTwitchOutput);
  const cancel = useMutation(api.events.cancelEventMediaOperation);
  const create = useMutation(api.eventMediaSources.create);
  const replace = useMutation(api.eventMediaSources.replace);
  const remove = useMutation(api.eventMediaSources.remove);
  const settings = useMutation(api.eventMediaSettings.configure);
  // A loading/rejected replacement subscription must never restore old authority.
  const current = status;
  if (!current) return null;
  return (
    <>
      <EventOperatorControls
        key={current.eventId}
        status={current}
        onCancel={(commandId) =>
          cancel({
            currentSlug,
            commandId,
            idempotencyKey: crypto.randomUUID(),
          })
        }
        onCreate={(input) => create({ currentSlug, ...input })}
        onReplace={(source, input) =>
          replace({ currentSlug, sourceId: source.sourceId, ...input })
        }
        onRemove={(source) =>
          remove({ currentSlug, sourceId: source.sourceId })
        }
        onSaveSettings={(input) => settings({ currentSlug, ...input })}
        title={current.eventTitle}
        onTwitch={(input) => configureTwitch({ currentSlug, ...input })}
        onCommand={(type, targetSourceKey) =>
          queue({
            currentSlug,
            type,
            targetSourceKey,
            idempotencyKey: crypto.randomUUID(),
          })
        }
        onStart={(outputKey) =>
          start({ currentSlug, outputKey, startImmediately: true })
        }
        onStop={(sessionId) => stop({ currentSlug, sessionId })}
        onPolicy={(maxOverrunMs) =>
          policy({ currentSlug, policy: { maxOverrunMs } })
        }
      />
    </>
  );
}

type TwitchInput = {
  key: string;
  label: string;
  channel: string;
  outputAccountKey: string;
  simulcastEnabled: boolean;
  sourceConsentAccepted: boolean;
  destinationAuthorityAccepted: boolean;
  providerRulesAccepted: boolean;
  rightsClearedMediaAccepted: boolean;
};
type ControlsProps = {
  title?: string;
  onTwitch: (input: TwitchInput) => Promise<unknown>;
  status: OperatorStatus;
  onCommand: (type: Command, key?: string) => Promise<unknown>;
  onStart: (key: string) => Promise<unknown>;
  onStop: (
    id: OperatorStatus["sessions"][number]["sessionId"],
  ) => Promise<unknown>;
  onPolicy: (maxOverrunMs?: number) => Promise<unknown>;
  onCancel: (
    id: OperatorStatus["commands"][number]["commandId"],
  ) => Promise<unknown>;
  onCreate: (input: SourceAuthoring) => Promise<unknown>;
  onReplace: (
    source: OperatorStatus["sources"][number],
    input: SourceAuthoring,
  ) => Promise<unknown>;
  onRemove: (source: OperatorStatus["sources"][number]) => Promise<unknown>;
  onSaveSettings: (input: StreamSettings) => Promise<unknown>;
};
export function EventOperatorControls({
  status,
  title,
  onTwitch,
  onCommand,
  onStart,
  onStop,
  onPolicy,
  onCancel,
  onCreate,
  onReplace,
  onRemove,
  onSaveSettings,
}: ControlsProps) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const stopLock = useRef(false);
  const cutLock = useRef(false);
  const cancelLock = useRef(false);
  const [cutBusy, setCutBusy] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);
  const [twitchAccount, setTwitchAccount] = useState("");
  const [twitchLabel, setTwitchLabel] = useState("Twitch");
  const [twitchChannel, setTwitchChannel] = useState("");
  const [simulcast, setSimulcast] = useState(false);
  const [consent, setConsent] = useState(false);
  const [failure, setFailure] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [outputKey, setOutputKey] = useState("");
  const [overrun, setOverrun] = useState(
    status.program?.broadcastPolicy?.maxOverrunMs === undefined
      ? ""
      : String(status.program.broadcastPolicy.maxOverrunMs / 60000),
  );
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    const receivedAt = performance.now();
    const timer = setInterval(
      () => setElapsed(performance.now() - receivedAt),
      1000,
    );
    return () => clearInterval(timer);
  }, [status.serverNow]);
  const view = operatorViewState(status, elapsed, busy, stopBusy);
  const { session, active, observationFresh } = view;
  const workerStatus = !session
    ? "Stopped"
    : ["ended", "error"].includes(session.status)
      ? session.status
      : observationFresh
        ? session.status
        : "Unknown";

  const sessionCommands = status.commands.filter(
    (row) =>
      row.sessionId === undefined || row.sessionId === session?.sessionId,
  );
  const pending = sessionCommands.some((row) =>
    ["queued", "claimed"].includes(row.status),
  );
  const sessionPending = sessionCommands.some(
    (row) =>
      row.sessionId !== undefined &&
      row.sessionId === session?.sessionId &&
      ["queued", "claimed"].includes(row.status),
  );
  const disabled =
    busy ||
    Boolean(view.pending) ||
    !status.canControl ||
    stopBusy ||
    session?.status === "stopping";
  async function submit(action: () => Promise<unknown>) {
    if (
      lock.current ||
      stopLock.current ||
      !status.canControl ||
      session?.status === "stopping"
    )
      return;
    lock.current = true;
    setBusy(true);
    setFailure(false);
    try {
      await action();
    } catch {
      setFailure(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function confirmAndStop() {
    if (stopLock.current || !status.canControl || !session) return;
    stopLock.current = true;
    setStopBusy(true);
    setFailure(false);
    try {
      await onStop(session.sessionId);
    } catch {
      setFailure(true);
    } finally {
      stopLock.current = false;
      setStopBusy(false);
      setConfirmStop(false);
    }
  }
  async function cut() {
    if (cutLock.current || stopLock.current || !view.canCut) return;
    cutLock.current = true;
    setCutBusy(true);
    setFailure(false);
    try {
      await onCommand("switch_hold");
    } catch {
      setFailure(true);
    } finally {
      cutLock.current = false;
      setCutBusy(false);
    }
  }
  async function cancel() {
    if (
      cancelLock.current ||
      stopLock.current ||
      !view.canCancel ||
      !view.pending
    )
      return;
    cancelLock.current = true;
    setFailure(false);
    try {
      await onCancel(view.pending.commandId);
    } catch {
      setFailure(true);
    } finally {
      cancelLock.current = false;
    }
  }
  return (
    <PageShell className="py-10">
      <PageContainer max="6xl">
        <div
          className="ph-no-capture space-y-8"
          data-ph-no-capture
          data-testid="event-operator-controls"
        >
          <nav className="flex flex-wrap gap-5 text-sm">
            <Link href={status.eventPath}>Event</Link>
            <Link href={`${status.eventPath}/host`}>Host view</Link>
            <Link href={`${status.eventPath}/edit`}>Edit event</Link>
          </nav>
          <header>
            <p className="text-sm text-muted">Broadcast controls</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              {title ?? "Broadcast controls"}
            </h1>
          </header>
          <dl className="grid grid-cols-2 gap-6 border-y border-border py-6 sm:grid-cols-4">
            <div>
              <dt className="text-sm text-muted">Scheduled now</dt>
              <dd>{status.currentSlot?.displayLabel ?? "None"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Scheduled next</dt>
              <dd>{status.nextSlot?.displayLabel ?? "None"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Desired source</dt>
              <dd>{view.desired}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Observed output</dt>
              <dd>{view.actual}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Pending source</dt>
              <dd>{view.pendingLabel}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Worker</dt>
              <dd className="capitalize">{workerStatus}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Observed mode</dt>
              <dd>
                {observationFresh
                  ? (session?.broadcastMode ?? "Unknown")
                  : "Unknown"}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Session deadline</dt>
              <dd>
                {session?.runtimeDeadlineAt ? (
                  <ViewerLocalEventDateTime
                    timestamp={session.runtimeDeadlineAt}
                  />
                ) : (
                  "None"
                )}
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={disabled || !active}
              onClick={() => submit(() => onCommand("switch_next"))}
            >
              Next
            </Button>
            <Button
              variant="secondary"
              disabled={disabled || !active}
              onClick={() => submit(() => onCommand("hold_current"))}
            >
              Hold current
            </Button>
            <Button
              variant="secondary"
              disabled={!view.canCut || cutBusy}
              onClick={() => void cut()}
            >
              Cut to slate
            </Button>
            <Button
              variant="secondary"
              disabled={disabled || !active}
              onClick={() => submit(() => onCommand("set_automatic_mode"))}
            >
              Return to auto
            </Button>
            <Button
              variant="secondary"
              disabled={
                stopBusy ||
                !status.canControl ||
                !active ||
                session?.status === "stopping"
              }
              onClick={() => setConfirmStop(true)}
            >
              Stop
            </Button>
          </div>
          {confirmStop ? (
            <div
              role="group"
              aria-label="Confirm stop"
              className="flex flex-wrap gap-3"
            >
              <Button
                disabled={stopBusy || !status.canControl}
                onClick={() => void confirmAndStop()}
              >
                Confirm stop
              </Button>
              <Button variant="secondary" onClick={() => setConfirmStop(false)}>
                Cancel
              </Button>
            </div>
          ) : null}
          <p role="status">
            {failure
              ? "Command failed"
              : stopBusy || session?.status === "stopping"
                ? "Stopping"
                : view.pending?.phase === "preparing"
                  ? "Preparing"
                  : view.pending?.phase === "promoting"
                    ? "Promoting"
                    : busy || pending
                      ? "Command pending"
                      : ""}
          </p>
          <EventOperatorSources
            sources={status.sources}
            control={{
              status,
              canTake: view.canTake,
              canCancel: view.canCancel,
              pending: view.pending ?? null,
              now: status.serverNow + elapsed,
            }}
            canControl={
              status.canControl && !stopBusy && session?.status !== "stopping"
            }
            onTake={(source) =>
              void submit(() => onCommand("switch_source", source.key))
            }
            onCancel={() => void cancel()}
            onCreate={onCreate}
            onReplace={onReplace}
            onRemove={onRemove}
          />
          <EventStreamSettings
            settings={
              status.program?.mediaSettings ?? NEW_PROGRAM_MEDIA_SETTINGS
            }
            activeSettings={active ? session?.mediaSettings : undefined}
            canControl={status.canControl}
            onSave={onSaveSettings}
          />
          <EventOperatorDiagnostics
            session={session}
            now={status.serverNow + elapsed}
          />
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Destinations</h2>
            {status.outputs.map((output) => {
              const health = session?.outputHealth.find(
                (row) => row.outputId === output.outputId,
              );
              const fresh =
                observationFresh &&
                output.authorized !== false &&
                eventBroadcastObservationFresh({
                  serverNow: status.serverNow,
                  elapsedMs: elapsed,
                  leaseExpiresAt: session?.leaseExpiresAt,
                  observedAt: session?.outputHealthObservedAt,
                  status: session?.status,
                });
              return (
                <div
                  key={output.outputId}
                  className="flex flex-wrap justify-between gap-3 border-b border-border py-3"
                >
                  <span>
                    {output.label}
                    {output.simulcastEnabled ? " · Simulcast" : ""}
                  </span>
                  <span
                    title={
                      session?.outputHealthObservedAt
                        ? new Date(session.outputHealthObservedAt).toISOString()
                        : undefined
                    }
                  >
                    {health && fresh ? health.status : "Unknown"}
                  </span>
                </div>
              );
            })}
            <label className="block text-sm">
              Primary output
              <select
                className="ml-3 max-w-full rounded border border-border bg-surface p-2"
                aria-label="Primary output"
                value={outputKey}
                onChange={(e) => setOutputKey(e.target.value)}
              >
                <option value="">Select output</option>
                {status.outputs
                  .filter(
                    (row) =>
                      row.authorized !== false &&
                      ["ready", "active"].includes(row.state),
                  )
                  .map((row) => (
                    <option key={row.outputId} value={row.key}>
                      {row.label}
                    </option>
                  ))}
              </select>
            </label>
            <Button
              disabled={
                busy ||
                sessionPending ||
                !status.canControl ||
                Boolean(active) ||
                status.outputConfigurationLocked ||
                !outputKey
              }
              onClick={() => submit(() => onStart(outputKey))}
            >
              Start
            </Button>
          </section>
          <details className="space-y-4">
            <summary className="cursor-pointer text-sm">Twitch setup</summary>
            <fieldset
              disabled={disabled || status.outputConfigurationLocked}
              className="grid gap-4 sm:max-w-md"
            >
              <label className="grid gap-2 text-sm">
                Output account
                <select
                  className="rounded border border-border bg-surface p-2"
                  aria-label="Output account"
                  value={twitchAccount}
                  onChange={(e) => {
                    setTwitchAccount(e.target.value);
                    setTwitchChannel(
                      status.twitchAccounts.find(
                        (account) => account.key === e.target.value,
                      )?.channel ?? "",
                    );
                  }}
                >
                  <option value="">
                    {status.twitchAccounts.length
                      ? "Select account"
                      : "Unavailable"}
                  </option>
                  {status.twitchAccounts.map((account) => (
                    <option key={account.key} value={account.key}>
                      {account.channel}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2 text-sm">
                Output label
                <input
                  className="rounded border border-border bg-surface p-2"
                  value={twitchLabel}
                  onChange={(e) => setTwitchLabel(e.target.value)}
                />
              </label>
              <label className="grid gap-2 text-sm">
                Channel
                <input
                  className="rounded border border-border bg-surface p-2"
                  value={twitchChannel}
                  readOnly
                />
              </label>
              <label className="flex gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={simulcast}
                  onChange={(e) => setSimulcast(e.target.checked)}
                />
                Simulcast
              </label>
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                I confirm I am authorized to publish this event through the
                selected output account.
              </label>
              <Button
                variant="secondary"
                disabled={
                  status.outputConfigurationLocked ||
                  !consent ||
                  !twitchAccount.trim() ||
                  !twitchLabel.trim() ||
                  !twitchChannel.trim()
                }
                onClick={() =>
                  submit(() =>
                    onTwitch({
                      key:
                        status.outputs.find((output) => output.twitchSetup)
                          ?.key ?? "twitch",
                      label: twitchLabel,
                      channel: twitchChannel,
                      outputAccountKey: twitchAccount,
                      simulcastEnabled: simulcast,
                      sourceConsentAccepted: consent,
                      destinationAuthorityAccepted: consent,
                      providerRulesAccepted: consent,
                      rightsClearedMediaAccepted: consent,
                    }),
                  )
                }
              >
                Save Twitch
              </Button>
            </fieldset>
          </details>
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Handoff policy</h2>
            <label className="block text-sm">
              Maximum overrun (minutes)
              <input
                className="ml-3 w-24 rounded border border-border bg-surface p-2"
                type="number"
                min="0"
                max="1440"
                value={overrun}
                placeholder="Off"
                onChange={(e) => setOverrun(e.target.value)}
              />
            </label>
            <Button
              variant="secondary"
              disabled={disabled || Boolean(active)}
              onClick={() =>
                submit(() =>
                  onPolicy(
                    overrun === "" ? undefined : Number(overrun) * 60000,
                  ),
                )
              }
            >
              Save policy
            </Button>
          </section>
          <details>
            <summary className="cursor-pointer text-sm">Details</summary>
            <dl className="mt-4 grid grid-cols-2 gap-4">
              {" "}
              <div>
                <dt className="text-sm text-muted">Acknowledged sequence</dt>
                <dd>{session?.lastAcknowledgedSequence ?? "None"}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Lease</dt>
                <dd>
                  {session?.leaseExpiresAt &&
                  session.leaseExpiresAt > status.serverNow + elapsed
                    ? "Active"
                    : "Expired"}
                </dd>
              </div>
            </dl>
          </details>
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Commands</h2>
            {status.commands.slice(0, 10).map((command) => (
              <div
                className="flex flex-wrap justify-between gap-3 border-b border-border py-2 text-sm"
                key={command.commandId}
              >
                <span>{command.commandType.replaceAll("_", " ")}</span>
                <span>
                  {command.controlOutcome === "superseded"
                    ? "superseded"
                    : command.status}
                </span>
              </div>
            ))}
          </section>
        </div>
      </PageContainer>
    </PageShell>
  );
}
