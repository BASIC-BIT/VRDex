"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

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

function ConnectedSignInForm({ returnTo }: { returnTo: string }) {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [showPasswordForm, setShowPasswordForm] = useState(false);
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
        const result = await signIn("password", {
          email,
          code: stringField(formData.get("code")),
          flow: "email-verification",
        });

        if (!result.signingIn) {
          startTransition(() => setStatus({ kind: "error", message: "Verification code did not match or expired." }));
          return;
        }

        router.replace(returnTo);
        return;
      }

      const result = await signIn("password", {
        email,
        password: stringField(formData.get("password")),
        flow: mode,
      });

      if (result.signingIn) {
        router.replace(returnTo);
        return;
      }

      startTransition(() => setStatus({ kind: "verify-email", email }));
      setMode("email-verification");
    } catch (error) {
      startTransition(() => setStatus({ kind: "error", message: authErrorMessage(error) }));
    }
  }

  const isSubmitting = status.kind === "submitting";

  return (
    <div className="grid gap-6">
      <div aria-label="Sign in providers" className="grid gap-3" role="group">
        <button
          className="w-full rounded-control bg-[#5865f2] px-5 py-3 text-sm font-medium text-white transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5865f2]/35"
          type="button"
          onClick={() => void signIn("discord", { redirectTo: returnTo })}
        >
          Continue with Discord
        </button>
        <Button className="w-full" size="lg" type="button" onClick={() => void signIn("google", { redirectTo: returnTo })}>
          Continue with Google
        </Button>
      </div>

      {showPasswordForm ? (
        <form className="grid gap-4 border-t border-border pt-6" id="email-password-form" onSubmit={submitPassword}>
          <input name="flow" type="hidden" value={mode} />
          <Field>
            Email
            <Input
              name="email"
              placeholder="you@example.com"
              required
              type="email"
              defaultValue={status.kind === "verify-email" ? status.email : undefined}
            />
          </Field>

          {mode === "email-verification" ? (
            <Field>
              Verification code
              <Input name="code" placeholder="12345678" required />
            </Field>
          ) : (
            <Field>
              Password
              <Input name="password" minLength={12} required type="password" />
            </Field>
          )}

          <div className="grid gap-2">
            <Button className="w-full" disabled={isSubmitting} size="lg" type="submit" variant="primary">
              {isSubmitting
                ? "Working..."
                : mode === "signUp"
                  ? "Create account"
                  : mode === "email-verification"
                    ? "Verify email"
                    : "Sign in"}
            </Button>
            <Button
              className="w-full"
              size="lg"
              type="button"
              variant="ghost"
              onClick={() => {
                setStatus({ kind: "idle" });
                setMode(mode === "signIn" ? "signUp" : "signIn");
              }}
            >
              {mode === "signIn" ? "Create account" : "Use existing account"}
            </Button>
          </div>

          {status.kind === "verify-email" ? (
            // Replay records every route and `maskAllInputs` covers input
            // values only, so an address rendered as text needs the masking
            // marker explicitly.
            <Notice>
              Check <span data-ph-no-capture>{status.email}</span> for a verification code.
            </Notice>
          ) : null}

          {status.kind === "error" ? <Notice variant="error">{status.message}</Notice> : null}
        </form>
      ) : (
        <Button
          aria-controls="email-password-form"
          aria-expanded="false"
          className="w-full"
          size="lg"
          type="button"
          variant="ghost"
          onClick={() => setShowPasswordForm(true)}
        >
          Use email and password
        </Button>
      )}
    </div>
  );
}

export function SignInForm({ returnTo }: { returnTo: string }) {
  if (!convexUrl) {
    return (
      <Notice className="py-5 leading-7" variant="dashed">
        Convex is not configured in this environment, so sign-in is disabled.
      </Notice>
    );
  }

  return <ConnectedSignInForm returnTo={returnTo} />;
}
