"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { FormEvent, MouseEvent, useEffect, useRef, useState, useTransition } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@convex-generated-api";
import { buttonVariants, Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/cn";
import { ProfileFields } from "../_components/profile-fields";
import {
  profileFieldsPayload,
  type ProfileFieldsPayload,
} from "../_components/profile-fields-model";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

type ProfileType = "person" | "community";

type SubmissionStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | {
      kind: "success";
      result: ProfileSubmissionResult;
    }
  | { kind: "error"; message: string };

type ProfileSubmissionResult = {
  profilePath: string;
  slug: string;
};

type ProfileSubmissionPayload = ProfileFieldsPayload;

const userSafeErrorPatterns = [
  /Profile submissions require a signed-in user\./,
  /Display name must be at least \d+ characters\./,
  /Display name must be \d+ characters or fewer\./,
  /(?:Aliases|Tags|Role tags|Category tags) items must be \d+ characters or fewer\./,
  /(?:Aliases|Tags|Role tags|Category tags) can include at most \d+ entries\./,
  /Community subtype must be \d+ characters or fewer\./,
  /Community fields cannot be submitted for a person profile\./,
  /Person fields cannot be submitted for a community profile\./,
  // Retrying cannot succeed while the suppression stands, so the generic
  // "backend unreachable, try again" fallback would be actively misleading.
  /This profile cannot be submitted\./,
];

function submissionErrorMessage(error: unknown): string {
  // Structured data first: Convex redacts plain error messages on production
  // deployments, so pattern-matching the message alone never sees this case there.
  const data = (error as { data?: { code?: string; message?: string } } | null)?.data;

  if (data?.code === "IDENTITY_SUPPRESSED") {
    return data.message ?? "This profile cannot be submitted.";
  }

  // Link problems are always fixable in the form, and the structured payload is
  // what survives production redaction.
  if (data?.code === "INVALID_PROFILE_LINK" && data.message) {
    return data.message;
  }

  // Field validation now arrives structured too, for the same reason. The
  // pattern list below still catches anything that does not, but it only ever
  // worked on a development deployment -- production redacts the message it
  // matches against, so every one of those was reaching the person as "try again
  // once the backend is reachable" for a name they could have simply lengthened.
  if (data?.code === "PROFILE_INPUT_INVALID" && data.message) {
    return data.message;
  }

  const message = error instanceof Error ? error.message : String(error);

  for (const pattern of userSafeErrorPatterns) {
    const match = message.match(pattern);

    if (match) {
      return match[0];
    }
  }

  return "Profile submission failed. Please try again once the backend is reachable.";
}

function DisabledSubmissionPanel() {
  return (
    <div className="border-t border-border py-6">
      <h2 className="text-lg font-semibold">Profile submission is unavailable</h2>
      <p className="mt-2 text-sm text-muted">Try again later.</p>
    </div>
  );
}

function SignInRequiredSubmissionPanel() {
  return (
    <div className="border-t border-border py-6">
      <h2 className="text-lg font-semibold">Sign-in required</h2>
      <Link className={cn(buttonVariants({ size: "lg", variant: "primary" }), "mt-5")} href="/sign-in">
        Sign in
      </Link>
    </div>
  );
}

function SubmissionFormFields({ submitProfile }: {
  submitProfile: (payload: ProfileSubmissionPayload) => Promise<ProfileSubmissionResult>;
}) {
  const [profileType, setProfileType] = useState<ProfileType>("person");
  const [status, setStatus] = useState<SubmissionStatus>({ kind: "idle" });
  // Remounts the field set on a successful submit. form.reset() restores each
  // input's default, but the role checkboxes and link rows are React state, so
  // they would survive into the next submission.
  const [formGeneration, setFormGeneration] = useState(0);
  const successDialogRef = useRef<HTMLDialogElement>(null);
  const [, startTransition] = useTransition();
  const successResult = status.kind === "success" ? status.result : null;

  useEffect(() => {
    const dialog = successDialogRef.current;

    if (successResult && dialog && !dialog.open) {
      dialog.showModal();
    }
  }, [successResult]);

  function closeSuccessDialog() {
    successDialogRef.current?.close();
    setStatus({ kind: "idle" });
  }

  function closeOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) {
      closeSuccessDialog();
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);

    setStatus({ kind: "submitting" });

    try {
      const result = await submitProfile(profileFieldsPayload(formData, profileType));

      form.reset();
      setProfileType("person");
      setFormGeneration((generation) => generation + 1);
      startTransition(() => setStatus({ kind: "success", result }));
    } catch (error) {
      startTransition(() => setStatus({ kind: "error", message: submissionErrorMessage(error) }));
    }
  }

  const isSubmitting = status.kind === "submitting";

  return (
    <form className="grid gap-5" onSubmit={onSubmit}>
      <Field className="sm:max-w-xs">
        Profile type
        <Select
          name="profileType"
          value={profileType}
          onChange={(event) => setProfileType(event.target.value as ProfileType)}
        >
          <option value="person">Person</option>
          <option value="community">Community</option>
        </Select>
      </Field>

      <ProfileFields key={formGeneration} profileType={profileType} />

      <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center">
        <Button className="sm:min-w-40" disabled={isSubmitting} size="lg" type="submit" variant="primary">
          {isSubmitting ? "Submitting..." : "Submit profile"}
        </Button>
      </div>

      {status.kind === "error" ? (
        <Notice variant="error">
          {status.message}
        </Notice>
      ) : null}

      <dialog
        aria-labelledby="profile-submission-success-title"
        className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-card border border-border bg-surface p-0 text-foreground shadow-hero backdrop:bg-black/70"
        ref={successDialogRef}
        onCancel={() => setStatus({ kind: "idle" })}
        onClick={closeOnBackdrop}
      >
        <div className="relative p-6 sm:p-8">
          <Button
            aria-label="Close"
            className="absolute top-4 right-4 size-9 p-0"
            size="sm"
            type="button"
            variant="ghost"
            onClick={closeSuccessDialog}
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
          <h2 className="pr-10 text-2xl font-semibold" id="profile-submission-success-title">
            Profile added
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted">
            The profile is ready to view.
          </p>
          {successResult ? (
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                className={buttonVariants({ size: "lg", variant: "primary" })}
                href={successResult.profilePath}
              >
                View profile
              </Link>
              <Button size="lg" type="button" variant="secondary" onClick={closeSuccessDialog}>
                Add another
              </Button>
            </div>
          ) : null}
        </div>
      </dialog>
    </form>
  );
}

function ConnectedSubmissionForm() {
  const submitProfile = useMutation(api.profiles.submitCommunityProfile);

  return <SubmissionFormFields submitProfile={submitProfile} />;
}

function E2eSubmissionForm() {
  const [runId] = useState(() => {
    if (typeof document === "undefined") {
      return `playwright-${crypto.randomUUID()}`;
    }

    const cookieName = "vrdex_e2e_run_id=";
    const cookieRunId = document.cookie
      .split(";")
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith(cookieName))
      ?.slice(cookieName.length);

    return cookieRunId ? decodeURIComponent(cookieRunId) : `playwright-${crypto.randomUUID()}`;
  });

  return (
    <SubmissionFormFields
      submitProfile={async (payload) => {
        const response = await fetch("/api/e2e/profile-submissions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            runId,
            profileType: payload.profileType,
            displayName: payload.displayName,
            aliases: payload.aliases,
            tags: payload.tags,
            outboundLinks: payload.outboundLinks,
            // Optional in the payload because the editor renders only the fields
            // its writer may change. This form renders all of them, so the
            // fallbacks are for the type rather than for a case that happens.
            ...(payload.profileType === "person"
              ? { roleTags: payload.person?.roleTags ?? [] }
              : {
                  subtype: payload.community?.subtype ?? "",
                  categoryTags: payload.community?.categoryTags ?? [],
                }),
          }),
        });

        if (!response.ok) {
          const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(errorBody?.error ?? "E2E profile submission failed.");
        }

        return (await response.json()) as ProfileSubmissionResult;
      }}
    />
  );
}

function AuthenticatedProfileSubmissionForm() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) {
    return <p className="text-sm text-muted">Loading sign-in state...</p>;
  }

  if (!isAuthenticated) {
    return <SignInRequiredSubmissionPanel />;
  }

  return <ConnectedSubmissionForm />;
}

export function ProfileSubmissionForm({ e2eMode = false }: { e2eMode?: boolean }) {
  if (e2eMode) {
    return <E2eSubmissionForm />;
  }

  if (!convexUrl) {
    return <DisabledSubmissionPanel />;
  }

  return <AuthenticatedProfileSubmissionForm />;
}
