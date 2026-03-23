"use client";

import { useEffect, useState } from "react";

type HealthStatusResult = {
  backend: string;
  note: string;
  project: string;
  scope: string;
  status: string;
};

function LiveBackendStatusCard({ convexUrl }: { convexUrl: string }) {
  const [result, setResult] = useState<HealthStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    async function loadStatus() {
      try {
        const response = await fetch(`${convexUrl}/api/query`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            args: {},
            format: "json",
            path: "health:status",
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = (await response.json()) as {
          status: "success" | "error";
          errorMessage?: string;
          value?: HealthStatusResult;
        };

        if (payload.status !== "success" || !payload.value) {
          throw new Error(payload.errorMessage ?? "Unknown Convex response.");
        }

        if (isActive) {
          setResult(payload.value);
          setError(null);
        }
      } catch (loadError) {
        if (isActive) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unknown Convex error.",
          );
        }
      }
    }

    void loadStatus();

    return () => {
      isActive = false;
    };
  }, [convexUrl]);

  return (
    <div className="rounded-[1.25rem] border border-border bg-surface px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
            Runtime check
          </p>
          <h3 className="mt-2 text-lg font-semibold tracking-[-0.02em]">
            Live backend status
          </h3>
        </div>

        <span className="rounded-full bg-white/70 px-3 py-1 font-mono text-xs uppercase tracking-[0.2em] text-muted">
          {error ? "error" : result?.status ?? "loading"}
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-muted">
        {error
          ? `Convex request failed: ${error}`
          : result?.note ?? "Waiting for the first Convex response from health:status."}
      </p>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface-strong px-3 py-3">
          <dt className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted">
            Backend
          </dt>
          <dd className="mt-2 font-medium">{result?.backend ?? "convex"}</dd>
        </div>
        <div className="rounded-2xl border border-border bg-surface-strong px-3 py-3">
          <dt className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted">
            Scope
          </dt>
          <dd className="mt-2 font-medium">{result?.scope ?? "bootstrap"}</dd>
        </div>
      </dl>
    </div>
  );
}

export function BackendStatusCard({ convexUrl }: { convexUrl?: string }) {
  if (!convexUrl) {
    return (
      <div className="rounded-[1.25rem] border border-dashed border-border bg-surface px-4 py-4">
        <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
          Runtime check
        </p>
        <h3 className="mt-2 text-lg font-semibold tracking-[-0.02em]">
          Convex URL not configured
        </h3>
        <p className="mt-3 text-sm leading-6 text-muted">
          Run the local Convex bootstrap so repo-root <code className="font-mono text-[0.95em]">.env.local</code>
          includes a deployment URL, or provide <code className="font-mono text-[0.95em]">NEXT_PUBLIC_CONVEX_URL</code>
          explicitly if you want the homepage to render the live <code className="font-mono text-[0.95em]">health:status</code>
          query.
        </p>
      </div>
    );
  }

  return <LiveBackendStatusCard convexUrl={convexUrl} />;
}
