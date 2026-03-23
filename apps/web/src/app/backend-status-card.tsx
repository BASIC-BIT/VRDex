"use client";

import { Component, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

function StatusCardShell({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[1.25rem] border border-border bg-surface px-4 py-4">
      {children}
    </div>
  );
}

class StatusCardErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null };

  reset = () => {
    this.setState({ error: null });
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <StatusCardShell>
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
            Runtime check
          </p>
          <h3 className="mt-2 text-lg font-semibold tracking-[-0.02em]">
            Backend unreachable
          </h3>
          <p className="mt-3 text-sm leading-6 text-muted">
            Start <code className="font-mono text-[0.95em]">pnpm dev:backend:local</code>
            to restore the live status card.
          </p>
          <button
            type="button"
            className="mt-3 font-mono text-xs uppercase tracking-[0.18em] text-muted underline-offset-4 hover:underline"
            onClick={this.reset}
          >
            Retry
          </button>
        </StatusCardShell>
      );
    }

    return this.props.children;
  }
}

function LiveBackendStatusCard() {
  const result = useQuery(api.health.status, {});

  return (
    <StatusCardShell>
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
          {result?.status ?? "loading"}
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-muted">
        {result?.note ?? "Waiting for the first Convex response from health:status."}
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
    </StatusCardShell>
  );
}

export function BackendStatusCard() {
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
          includes <code className="font-mono text-[0.95em]">NEXT_PUBLIC_CONVEX_URL</code>, or provide that value
          explicitly if you want the homepage to render the live <code className="font-mono text-[0.95em]">health:status</code>
          query.
        </p>
      </div>
    );
  }

  return (
    <StatusCardErrorBoundary>
      <LiveBackendStatusCard />
    </StatusCardErrorBoundary>
  );
}
