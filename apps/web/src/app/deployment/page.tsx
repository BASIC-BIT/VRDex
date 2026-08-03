import { Card, Eyebrow } from "@/components/ui/card";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

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

/** Host of a URL, or `unknown` when unset or unparseable. */
function hostLabel(value: string | undefined) {
  if (!value) {
    return "unknown";
  }

  try {
    return new URL(value).host;
  } catch {
    return "unknown";
  }
}

/**
 * Frontend API host the publishable key encodes. The key is base64 after its
 * prefix, so this is the only way to name the Clerk tenant from the client
 * bundle — the tier prefix alone does not distinguish one instance from another.
 */
function clerkFrontendApiHost() {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();

  if (!key) {
    return undefined;
  }

  try {
    const decoded = atob(key.replace(/^pk_(test|live)_/, ""));
    return `https://${decoded.replace(/\$+$/, "")}`;
  } catch {
    return undefined;
  }
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
  // Replaced `NEXT_PUBLIC_VRDEX_SUBMISSIONS_AUTH_READY`, which this page used to
  // report as "locked until auth issue lands". Auth has landed: `/submit` is
  // protected by `clerkMiddleware`, so the flag described a gate that no longer
  // exists and every correctly configured deployment published a false failure.
  const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  // Which backend, not merely whether one is set. "Configured" is true for a
  // production build accidentally pointed at staging, and promoting that would
  // put vrdex.net on the wrong dataset and the wrong auth configuration.
  // `production-promote.yml` reads these to refuse such a build.
  //
  // Rendered hidden rather than as visible rows: both values are already public
  // (`NEXT_PUBLIC_*` ship in the client bundle), and keeping them out of the
  // layout means the release gate does not churn this page's visual baselines.
  const backendIdentity = {
    convex: hostLabel(process.env.NEXT_PUBLIC_CONVEX_URL),
    clerk: hostLabel(clerkFrontendApiHost()),
  };

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
      label: "Clerk",
      value: clerkConfigured ? "configured" : "not configured",
      tone: clerkConfigured ? "ok" : "warn",
    },
  ];

  return (
    <PageShell className="py-10">
      <PageContainer className="gap-8" max="5xl">
        <PageNav>
          <BrandLink />
        </PageNav>

        <Card className="shadow-hero" padding="lg">
          <Eyebrow>Hosted readiness</Eyebrow>
          <div className="mt-5 max-w-3xl space-y-4">
            <h1 className="text-4xl leading-none font-semibold tracking-[-0.04em] sm:text-6xl">
              Initial Vercel deployment baseline
            </h1>
            <p className="text-base leading-7 text-muted sm:text-lg">
              This page exists so every preview has a simple live URL that reports whether it is running on Vercel, which commit is deployed, and whether the backend URL is configured.
            </p>
          </div>
        </Card>

        <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <Eyebrow>Deployment facts</Eyebrow>
            <dl className="mt-4">
              {deploymentItems.map((item) => (
                <DeploymentRow item={item} key={item.label} />
              ))}
            </dl>
          </Card>

          <Card surface="strong">
            <Eyebrow>First-live checklist</Eyebrow>
            <div className="mt-4 space-y-4 text-sm leading-7 text-muted">
              <p>
                A shell-only Vercel preview may run without Convex. Set <code className="font-mono text-[0.95em]">NEXT_PUBLIC_CONVEX_URL</code> to a hosted Convex deployment when you want the homepage and server baseline to read live backend data.
              </p>
              <p>
                Set <code className="font-mono text-[0.95em]">NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> and <code className="font-mono text-[0.95em]">CLERK_SECRET_KEY</code> for any deployment that should accept sign-in. Without them <code className="font-mono text-[0.95em]">/submit</code> and every other protected route redirect to an unavailable sign-in page.
              </p>
              <p>
                See <code className="font-mono text-[0.95em]">docs/deployment/vercel-preview.md</code> for the repository and Vercel setup contract.
              </p>
            </div>
          </Card>
        </section>

        {/* Machine-readable release gate. `production-promote.yml` requires these
            to name the production Convex deployment and Clerk tenant before it
            will move the vrdex.net alias. Hidden, so it adds no layout. */}
        <div
          hidden
          data-convex-deployment={backendIdentity.convex}
          data-clerk-frontend-api={backendIdentity.clerk}
        />
      </PageContainer>
    </PageShell>
  );
}
