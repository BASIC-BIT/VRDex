"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";

function ConvexRuntimeStatus({ convexUrl }: { convexUrl: string }) {
  const status = useQuery(api.health.status);

  return (
    <div className="space-y-4">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted">
          Live Convex status
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
          The first runtime path is active.
        </h2>
      </div>

      <p className="text-sm leading-7 text-muted">
        This panel reads the placeholder <code className="font-mono">health:status</code>{" "}
        query from the real backend bootstrap under <code className="font-mono">convex/</code>.
      </p>

      <div className="rounded-[1.25rem] border border-border bg-surface p-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
          Backend endpoint
        </p>
        <p className="mt-2 break-all font-mono text-sm text-foreground">{convexUrl}</p>
      </div>

      {status ? (
        <dl className="space-y-3 text-sm">
          <div className="flex items-start justify-between gap-4 border-b border-border pb-3">
            <dt className="text-muted">Status</dt>
            <dd className="text-right font-medium text-emerald-700">{status.status}</dd>
          </div>
          <div className="flex items-start justify-between gap-4 border-b border-border pb-3">
            <dt className="text-muted">Backend</dt>
            <dd className="text-right font-medium">{status.backend}</dd>
          </div>
          <div className="flex items-start justify-between gap-4 border-b border-border pb-3">
            <dt className="text-muted">Project</dt>
            <dd className="text-right font-medium">{status.project}</dd>
          </div>
          <div className="flex items-start justify-between gap-4 border-b border-border pb-3">
            <dt className="text-muted">Scope</dt>
            <dd className="text-right font-medium">{status.scope}</dd>
          </div>
          <div className="space-y-2 pt-1">
            <dt className="text-muted">Backend note</dt>
            <dd className="text-sm leading-7 text-foreground">{status.note}</dd>
          </div>
        </dl>
      ) : (
        <div className="rounded-[1.25rem] border border-dashed border-border bg-surface px-4 py-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
            Query state
          </p>
          <p className="mt-2 text-sm leading-7 text-foreground">
            Connecting to Convex and waiting for the first placeholder payload.
          </p>
        </div>
      )}
    </div>
  );
}

export function ConvexRuntimePanel() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

  if (!convexUrl) {
    return (
      <div className="space-y-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted">
            Convex runtime path
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
            Waiting for local backend wiring.
          </h2>
        </div>

        <p className="text-sm leading-7 text-muted">
          The app can render without a backend URL, but the live Convex read path only
          turns on when the repo-root <code className="font-mono">.env.local</code>{" "}
          file exists.
        </p>

        <div className="rounded-[1.25rem] border border-dashed border-border bg-surface px-4 py-5 text-sm leading-7 text-foreground">
          Run <code className="font-mono">pnpm bootstrap:backend:local</code> once, keep{" "}
          <code className="font-mono">pnpm dev:backend:local</code> running, and start the web
          app with <code className="font-mono">pnpm dev:web</code> from the repo root.
        </div>
      </div>
    );
  }

  return <ConvexRuntimeStatus convexUrl={convexUrl} />;
}
