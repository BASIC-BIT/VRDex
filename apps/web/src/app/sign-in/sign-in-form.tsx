"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useAction } from "convex/react";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { FormEvent, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import {
  reauthenticationCancellationPath,
  reauthenticationFailurePath,
  recentAuthProviderAllowed,
  type RecentAuthActionClass,
} from "@/lib/recent-auth";
import { captureProductEvent } from "@/lib/posthog";
import { api } from "@convex-generated-api";

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

async function serializeReauthentication<T>(
  reauthenticate: boolean,
  operation: () => Promise<T>,
) {
  if (!reauthenticate || !navigator.locks) {
    return operation();
  }
  return navigator.locks.request(
    "vrdex-reauthentication",
    { mode: "exclusive" },
    operation,
  );
}

function ConnectedSignInForm({
  actionClass,
  challengeId,
  reauthenticate,
  returnTo,
}: {
  actionClass: RecentAuthActionClass;
  challengeId: string | null;
  reauthenticate: boolean;
  returnTo: string;
}) {
  const { signIn } = useAuthActions();
  const verifyRecentAuthPassword = useAction(
    api.recentAuthPassword.verify,
  );
  const posthog = usePostHog();
  const router = useRouter();
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [mode, setMode] = useState<PasswordMode>("signIn");
  const [status, setStatus] = useState<AuthStatus>({ kind: "idle" });
  const [, startTransition] = useTransition();

  function cancelReauthentication() {
    captureProductEvent(
      posthog,
      "recent_auth_challenge_completed",
      {
        action_class: actionClass,
        outcome: "cancelled",
      },
    );
    window.location.assign(
      reauthenticationCancellationPath(
        returnTo,
        challengeId ?? "",
      ),
    );
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = stringField(formData.get("email")).toLowerCase();

    setStatus({ kind: "submitting" });

    try {
      if (mode === "email-verification") {
        const result = await serializeReauthentication(
          reauthenticate,
          () =>
            signIn("password", {
              email,
              code: stringField(formData.get("code")),
              flow: "email-verification",
            }),
        );

        if (!result.signingIn) {
          startTransition(() => setStatus({ kind: "error", message: "Verification code did not match or expired." }));
          return;
        }

        router.replace(returnTo);
        return;
      }

      const result = await serializeReauthentication(
        reauthenticate,
        async () => {
          if (reauthenticate) {
            const verification = await verifyRecentAuthPassword({
              challengeId: challengeId ?? "",
              email,
              password: stringField(formData.get("password")),
            });
            const signInResult = await signIn("password-reauth", {
              challengeId: challengeId ?? "",
              proof: verification.proof,
            });
            if (signInResult.signingIn) {
              try {
                const response = await fetch("/auth/reauth/complete", {
                  body: JSON.stringify({
                    challenge: challengeId,
                    returnTo,
                  }),
                  credentials: "same-origin",
                  headers: {
                    "content-type": "application/json",
                  },
                  method: "POST",
                });
                if (!response.ok) {
                  throw new Error("Reauthentication completion failed.");
                }
                const completion = (await response.json()) as {
                  destination?: unknown;
                };
                if (typeof completion.destination !== "string") {
                  throw new Error("Reauthentication completion was invalid.");
                }
                window.location.assign(completion.destination);
              } catch {
                window.location.assign(
                  reauthenticationFailurePath(
                    returnTo,
                    challengeId ?? "",
                  ),
                );
              }
            }
            return signInResult;
          }
          return signIn("password", {
            email,
            password: stringField(formData.get("password")),
            flow: mode,
          });
        },
      );

      if (result.signingIn) {
        if (reauthenticate) {
          return;
        }
        router.replace(returnTo);
        return;
      }

      if (reauthenticate) {
        startTransition(() => setStatus({ kind: "error", message: "Sign-in failed. Check your details and try again." }));
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
        {!reauthenticate || recentAuthProviderAllowed("discord") ? (
          <button
            className="w-full rounded-control bg-[#5865f2] px-5 py-3 text-sm font-medium text-white transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5865f2]/35"
            type="button"
            onClick={() => {
              void serializeReauthentication(reauthenticate, () =>
                signIn("discord", {
                  redirectTo: returnTo,
                }),
              );
            }}
          >
            Continue with Discord
          </button>
        ) : null}
        {!reauthenticate || recentAuthProviderAllowed("google") ? (
          <Button
            className="w-full"
            size="lg"
            type="button"
            onClick={() => {
              void serializeReauthentication(reauthenticate, () =>
                signIn("google", {
                  redirectTo: returnTo,
                }),
              );
            }}
          >
            Continue with Google
          </Button>
        ) : null}
      </div>

      {reauthenticate && !showPasswordForm ? (
        <Button
          className="w-full"
          size="lg"
          type="button"
          variant="ghost"
          onClick={cancelReauthentication}
        >
          Cancel
        </Button>
      ) : null}

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
            {!reauthenticate ? (
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
            ) : (
              <Button
                className="w-full"
                size="lg"
                type="button"
                variant="ghost"
                onClick={cancelReauthentication}
              >
                Cancel
              </Button>
            )}
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

export function SignInForm({
  actionClass,
  challengeId = null,
  reauthenticate = false,
  returnTo,
}: {
  actionClass: RecentAuthActionClass;
  challengeId?: string | null;
  reauthenticate?: boolean;
  returnTo: string;
}) {
  if (!convexUrl) {
    return (
      <Notice className="py-5 leading-7" variant="dashed">
        Convex is not configured in this environment, so sign-in is disabled.
      </Notice>
    );
  }

  return (
    <ConnectedSignInForm
      actionClass={actionClass}
      challengeId={challengeId}
      reauthenticate={reauthenticate}
      returnTo={returnTo}
    />
  );
}
