"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { FormEvent, useState, useTransition } from "react";

type PasswordMode = "signIn" | "signUp" | "email-verification";

type AuthStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "verify-email"; email: string }
  | { kind: "error"; message: string };

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

function authErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (/Password must be at least \d+ characters\./.test(message)) {
    return message.match(/Password must be at least \d+ characters\./)?.[0] ?? message;
  }

  if (/Invalid credentials/.test(message)) {
    return "Email or password did not match.";
  }

  if (/Email is required\./.test(message)) {
    return "Email is required.";
  }

  return "Sign-in failed. Check your details and try again.";
}

function stringField(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function ConnectedSignInForm() {
  const { signIn } = useAuthActions();
  const [mode, setMode] = useState<PasswordMode>("signIn");
  const [status, setStatus] = useState<AuthStatus>({ kind: "idle" });
  const [, startTransition] = useTransition();

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = stringField(formData.get("email")).toLowerCase();

    setStatus({ kind: "submitting" });

    try {
      if (mode === "email-verification") {
        await signIn("password", {
          email,
          code: stringField(formData.get("code")),
          flow: "email-verification",
        });
        return;
      }

      await signIn("password", {
        email,
        password: stringField(formData.get("password")),
        flow: mode,
      });

      startTransition(() => setStatus({ kind: "verify-email", email }));
      setMode("email-verification");
    } catch (error) {
      startTransition(() => setStatus({ kind: "error", message: authErrorMessage(error) }));
    }
  }

  const isSubmitting = status.kind === "submitting";

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          className="rounded-full bg-[#5865f2] px-5 py-3 text-sm font-medium text-white transition hover:brightness-95"
          type="button"
          onClick={() => void signIn("discord", { redirectTo: "/account" })}
        >
          Continue with Discord
        </button>
        <button
          className="rounded-full border border-border bg-surface-strong px-5 py-3 text-sm font-medium transition hover:border-accent"
          type="button"
          onClick={() => void signIn("google", { redirectTo: "/account" })}
        >
          Continue with Google
        </button>
      </div>

      <div className="flex items-center gap-3 text-xs font-mono uppercase tracking-[0.22em] text-muted">
        <span className="h-px flex-1 bg-border" />
        Email password
        <span className="h-px flex-1 bg-border" />
      </div>

      <form className="grid gap-4" onSubmit={submitPassword}>
        <input name="flow" type="hidden" value={mode} />
        <label className="grid gap-2 text-sm font-medium">
          Email
          <input
            className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition placeholder:text-muted/65 focus:border-accent"
            name="email"
            placeholder="you@example.com"
            required
            type="email"
            defaultValue={status.kind === "verify-email" ? status.email : undefined}
          />
        </label>

        {mode === "email-verification" ? (
          <label className="grid gap-2 text-sm font-medium">
            Verification code
            <input
              className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition placeholder:text-muted/65 focus:border-accent"
              name="code"
              placeholder="12345678"
              required
            />
          </label>
        ) : (
          <label className="grid gap-2 text-sm font-medium">
            Password
            <input
              className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition placeholder:text-muted/65 focus:border-accent"
              name="password"
              minLength={12}
              required
              type="password"
            />
          </label>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            className="inline-flex items-center justify-center rounded-full bg-accent px-5 py-3 text-sm font-medium text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting
              ? "Working..."
              : mode === "signUp"
                ? "Create account"
                : mode === "email-verification"
                  ? "Verify email"
                  : "Sign in"}
          </button>
          <button
            className="rounded-full border border-border bg-surface-strong px-5 py-3 text-sm font-medium"
            type="button"
            onClick={() => {
              setStatus({ kind: "idle" });
              setMode(mode === "signIn" ? "signUp" : "signIn");
            }}
          >
            {mode === "signIn" ? "Create account" : "Use existing account"}
          </button>
        </div>

        {status.kind === "verify-email" ? (
          <p className="rounded-[1rem] border border-border bg-surface-strong px-4 py-3 text-sm leading-6 text-muted">
            Check {status.email} for a verification code before claim-level actions.
          </p>
        ) : null}

        {status.kind === "error" ? (
          <p className="rounded-[1rem] border border-accent/35 bg-accent/10 px-4 py-3 text-sm leading-6 text-accent-strong">
            {status.message}
          </p>
        ) : null}
      </form>
    </div>
  );
}

export function SignInForm() {
  if (!convexUrl) {
    return (
      <div className="rounded-[1.25rem] border border-dashed border-border bg-surface px-4 py-5 text-sm leading-7 text-muted">
        Convex is not configured in this environment, so sign-in is disabled.
      </div>
    );
  }

  return <ConnectedSignInForm />;
}
