import Link from "next/link";

import { AccountPanel } from "./account-panel";

export default function AccountPage() {
  return (
    <main className="min-h-screen px-6 py-10 text-foreground sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <nav className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <Link className="font-mono uppercase tracking-[0.28em] text-muted" href="/">
            VRDex
          </Link>
          <Link className="rounded-full border border-border bg-surface px-4 py-2 font-medium" href="/sign-in">
            Sign in
          </Link>
        </nav>

        <section className="rounded-[2rem] border border-border bg-surface px-6 py-8 shadow-[0_24px_80px_rgba(64,40,24,0.12)] sm:px-8 lg:px-10">
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
            Account
          </p>
          <h1 className="mt-5 text-4xl leading-none font-semibold tracking-[-0.04em] sm:text-6xl">
            Your VRDex account and claim readiness.
          </h1>
          <div className="mt-8">
            <AccountPanel />
          </div>
        </section>
      </div>
    </main>
  );
}
