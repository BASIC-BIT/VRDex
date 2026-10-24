import type { OperatorSession } from "@/lib/event-operator-state";
import { resourceFresh } from "@/lib/event-operator-state";
export function EventOperatorDiagnostics({
  session,
  now,
}: {
  session: OperatorSession | undefined;
  now: number;
}) {
  const resource = session?.resources,
    fresh = resourceFresh(session, now);
  const estimate = resource?.computeEstimate;
  return (
    <details className="border-t border-border pt-4">
      <summary className="cursor-pointer text-sm">Diagnostics</summary>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-sm text-muted">CPU</dt>
          <dd>
            {fresh && resource?.cpuUsagePercent !== undefined
              ? `${resource.cpuUsagePercent.toFixed(0)}%`
              : "Unknown"}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Memory</dt>
          <dd>
            {fresh && resource?.memoryUsedBytes !== undefined
              ? `${(resource.memoryUsedBytes / 1048576).toFixed(0)} MiB`
              : "Unknown"}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Allocation</dt>
          <dd>
            {resource?.allocation
              ? `${resource.allocation.cpuUnits / 1024} vCPU · ${resource.allocation.memoryMiB} MiB`
              : "Unknown"}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Provider</dt>
          <dd>{resource?.provider ?? "Unknown"}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Region</dt>
          <dd>{resource?.region ?? "Unknown"}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Freshness</dt>
          <dd>
            {fresh
              ? "Current"
              : resource?.observedAt === undefined
                ? "Unknown"
                : "Stale"}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Sample age</dt>
          <dd>
            {resource?.observedAt === undefined
              ? "Unknown"
              : `${Math.max(0, Math.floor((now - resource.observedAt) / 1000))} s`}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Compute estimate</dt>
          <dd>
            {estimate ? `$${estimate.usdPerHour.toFixed(5)}/h` : "Unknown"}
            {estimate ? (
              <span className="block text-xs text-muted">
                CPU + memory · USD · {estimate.rateDate}
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
      <dl className="mt-4 space-y-2">
        {resource?.activeFormats.map((format) => (
          <div key={format.outputId}>
            <dt className="text-sm text-muted">{format.destination}</dt>
            <dd>
              {format.profile.videoPreset} · {format.profile.audioBitrateKbps}{" "}
              kbps · Stereo · 48 kHz
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
