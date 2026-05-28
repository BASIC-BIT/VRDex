import Link from "next/link";

import { SignInForm } from "./sign-in-form";

export default function SignInPage() {
  return (
    <main className="min-h-screen px-6 py-10 text-foreground sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <nav className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <Link className="font-mono uppercase tracking-[0.28em] text-muted" href="/">
            VRDex
          </Link>
          <Link className="rounded-full border border-border bg-surface px-4 py-2 font-medium" href="/account">
            Account
          </Link>
        </nav>

        <section className="overflow-hidden rounded-[2rem] border border-border bg-surface shadow-[0_24px_80px_rgba(64,40,24,0.12)] backdrop-blur">
          <div className="grid gap-8 px-6 py-8 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:px-10 lg:py-10">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
                Account access
              </p>
              <h1 className="mt-5 text-4xl leading-none font-semibold tracking-[-0.04em] sm:text-6xl">
                Sign in to claim and manage profiles.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-muted sm:text-lg">
                Use Discord, Google, or verified email/password. Claims and owner controls stay separate from the login provider so VRDex can accept multiple proof sources over time.
              </p>
            </div>

            <div className="rounded-[1.5rem] border border-border bg-white/45 px-5 py-6 sm:px-6">
              <SignInForm />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
