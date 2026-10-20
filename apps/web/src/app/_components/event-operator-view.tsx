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
import { EventHostView } from "./event-host-view";
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
  initialStatus,
  event,
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
  const current = status ?? initialStatus;
  return (
    <>
      <EventOperatorControls
        status={current}
        title={current.eventTitle}
        onTwitch={(input) => configureTwitch({ currentSlug, ...input })}
        onCommand={(type, targetSourceKey) =>
          queue({ currentSlug, type, targetSourceKey })
        }
        onStart={(outputKey) =>
          start({ currentSlug, outputKey, startImmediately: true })
        }
        onStop={(sessionId) => stop({ currentSlug, sessionId })}
        onPolicy={(maxOverrunMs) =>
          policy({ currentSlug, policy: { maxOverrunMs } })
        }
      />
      {event ? <EventHostView event={event} /> : null}
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
};
export function EventOperatorControls({
  status,
  title,
  onTwitch,
  onCommand,
  onStart,
  onStop,
  onPolicy,
}: ControlsProps) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const stopLock = useRef(false);
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
  const session =
    status.sessions.find(
      (row) => row.sessionId === status.program?.activeSessionId,
    ) ?? status.sessions[0];
  const active = session && !["ended", "error"].includes(session.status);
  const observationFresh = eventBroadcastObservationFresh({
    serverNow: status.serverNow,
    elapsedMs: elapsed,
    leaseExpiresAt: session?.leaseExpiresAt,
    observedAt: session?.programObservedAt,
    status: session?.status,
  });
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
  const disabled = busy || pending || !status.canControl;
  const sourceLabel = (id?: string) =>
    status.sources.find((row) => row.sourceId === id)?.label ?? "Hold";
  async function submit(action: () => Promise<unknown>) {
    if (lock.current || !status.canControl) return;
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
  const commanded = sessionCommands.find((row) =>
    ["queued", "claimed"].includes(row.status),
  );
  const commandedLabel = commanded?.targetSourceId
    ? sourceLabel(commanded.targetSourceId)
    : commanded?.commandType === "switch_next"
      ? "Next"
      : commanded?.commandType === "switch_hold"
        ? "Slate"
        : commanded?.commandType === "hold_current"
          ? "Hold current"
          : commanded?.commandType === "set_automatic_mode"
            ? "Automatic"
            : "None";
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
              <dt className="text-sm text-muted">Commanded source</dt>
              <dd>{commandedLabel}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Observed output</dt>
              <dd>
                {!observationFresh
                  ? "Unknown"
                  : session?.status === "hold"
                    ? "Hold"
                    : session?.currentSourceId
                      ? sourceLabel(session.currentSourceId)
                      : "Unknown"}
              </dd>
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
              disabled={disabled || !active}
              onClick={() => submit(() => onCommand("switch_hold"))}
            >
              Show slate
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
                session.status === "stopping"
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
              : busy || pending
                ? "Command pending"
                : ""}
          </p>
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Sources</h2>
            {status.sources.map((source) => (
              <div
                key={source.sourceId}
                className="flex items-center justify-between gap-4 border-b border-border py-3"
              >
                <span>{source.label}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={
                    disabled ||
                    !active ||
                    !source.hasPublicUrl ||
                    !["ready", "active"].includes(source.state)
                  }
                  onClick={() =>
                    submit(() => onCommand("switch_source", source.key))
                  }
                >
                  Select {source.label}
                </Button>
              </div>
            ))}
          </section>
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
              disabled={disabled || Boolean(active) || status.outputConfigurationLocked || !outputKey}
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
                <span>{command.status}</span>
              </div>
            ))}
          </section>
        </div>
      </PageContainer>
    </PageShell>
  );
}
