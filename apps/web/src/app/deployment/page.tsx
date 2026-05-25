import Link from "next/link";

export const dynamic = "force-dynamic";

type DeploymentItem = {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "muted";
};

function displayValue(value: string | undefined, fallback = "not configured") {
  return value && value.trim().length > 0 ? value : fallback;
}

function shortSha(value: string | undefined) {
  return value ? value.slice(0, 7) : "not available";
}

function DeploymentRow({ item }: { item: DeploymentItem }) {
  const toneClass =
    item.tone === "ok"
      ? "text-emerald-700"
      : item.tone === "warn"
        ? "text-accent-strong"
        : "text-foreground";

  return (
    <div className="flex flex-col gap-2 border-b border-border py-4 last:border-0 sm:flex-row sm:items-start sm:justify-between">
      <dt className="text-sm text-muted">{item.label}</dt>
      <dd className={`break-all text-sm font-medium ${toneClass}`}>{item.value}</dd>
    </div>
  );
}

export default function DeploymentPage() {
  const deploymentUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
  const convexConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  const submissionsAuthReady = process.env.NEXT_PUBLIC_VRDEX_SUBMISSIONS_AUTH_READY === "true";

  const deploymentItems: DeploymentItem[] = [
    {
      label: "Runtime",
      value: process.env.VERCEL === "1" ? "Vercel" : "local development",
      tone: process.env.VERCEL === "1" ? "ok" : "muted",
    },
    {
      label: "Environment",
      value: displayValue(process.env.VERCEL_ENV, "local"),
    },
    {
      label: "Deployment URL",
      value: deploymentUrl ?? "not on Vercel",
      tone: deploymentUrl ? "ok" : "muted",
    },
    {
      label: "Git branch",
      value: displayValue(process.env.VERCEL_GIT_COMMIT_REF),
    },
    {
      label: "Git commit",
      value: shortSha(process.env.VERCEL_GIT_COMMIT_SHA),
    },
    {
      label: "Convex URL",
      value: convexConfigured ? "configured" : "not configured",
      tone: convexConfigured ? "ok" : "warn",
    },
    {
      label: "Submission auth gate",
      value: submissionsAuthReady ? "unlocked" : "locked until auth issue lands",
      tone: submissionsAuthReady ? "warn" : "ok",
    },
  ];

  return (
    <main className="min-h-screen px-6 py-10 text-foreground sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <nav className="flex items-center justify-between gap-4 text-sm">
          <Link className="font-mono uppercase tracking-[0.28em]" href="/">
            VRDex
          </Link>
          <Link
            className="rounded-full border border-border bg-surface px-4 py-2 font-medium"
            href="/server-status"
          >
            Server status
          </Link>
        </nav>

        <section className="rounded-[2rem] border border-border bg-surface px-6 py-8 shadow-[0_24px_80px_rgba(64,40,24,0.12)] sm:px-8 lg:px-10">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted">
            Hosted readiness
          </p>
          <div className="mt-5 max-w-3xl space-y-4">
            <h1 className="text-4xl leading-none font-semibold tracking-[-0.04em] sm:text-6xl">
              Initial Vercel deployment baseline
            </h1>
            <p className="text-base leading-7 text-muted sm:text-lg">
              This page exists so every preview has a simple live URL that reports whether it is running on Vercel, which commit is deployed, and whether the backend URL is configured.
            </p>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[1.5rem] border border-border bg-surface px-5 py-6">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
              Deployment facts
            </p>
            <dl className="mt-4">
              {deploymentItems.map((item) => (
                <DeploymentRow item={item} key={item.label} />
              ))}
            </dl>
          </div>

          <aside className="rounded-[1.5rem] border border-border bg-surface-strong px-5 py-6">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
              First-live checklist
            </p>
            <div className="mt-4 space-y-4 text-sm leading-7 text-muted">
              <p>
                A shell-only Vercel preview may run without Convex. Set <code className="font-mono text-[0.95em]">NEXT_PUBLIC_CONVEX_URL</code> to a hosted Convex deployment when you want the homepage and server baseline to read live backend data.
              </p>
              <p>
                Keep <code className="font-mono text-[0.95em]">NEXT_PUBLIC_VRDEX_SUBMISSIONS_AUTH_READY</code> false until the auth foundation lands, so <code className="font-mono text-[0.95em]">/submit</code> stays locked for public visitors.
              </p>
              <p>
                See <code className="font-mono text-[0.95em]">docs/deployment/vercel-preview.md</code> for the repository and Vercel setup contract.
              </p>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
